// Small JSON-file store: devices, chats and runs. Saved atomically a moment after each change.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { errorMessage, log } from './util.js';
import type { Chat, Device, Run, Settings, Upload, UsageSnapshot } from './types.js';

const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'state.json');
export const UPLOAD_DIR = path.join(DIR, 'uploads');
export const DIFF_DIR = path.join(DIR, 'diffs');
export const BRANCH_DIR = path.join(DIR, 'branches');
export const IMAGE_DIR = path.join(DIR, 'run-images');

// Deletes the files a run keeps on disk (saved diff, images it looked at).
export function removeRunFiles(r: Run): void {
  if (r.changes?.patchFile) fs.rm(r.changes.patchFile, { force: true }, () => {});
  for (const img of r.images || []) fs.rm(img.path, { force: true }, () => {});
}
const KEEP_RUNS = 2000;
const UNUSED_UPLOAD_MS = 24 * 60 * 60 * 1000; // uploads never sent in a message are removed after a day

export interface Db {
  nextChatId: number; nextRunId: number; devices: Device[]; chats: Chat[]; runs: Run[]; uploads: Upload[];
  usage: Record<string, UsageSnapshot>; // agentId -> last reported plan usage limits
  settings: Settings;
}
export const db: Db = { nextChatId: 1, nextRunId: 1, devices: [], chats: [], runs: [], uploads: [], usage: {}, settings: {} };

// Deletes uploaded files: those of one chat (chat deleted), or unused ones older than a day.
export function removeUploads(filter: (u: Upload) => boolean): void {
  const gone = db.uploads.filter(filter);
  if (!gone.length) return;
  for (const u of gone) fs.rm(u.path, { force: true }, () => {});
  const ids = new Set(gone.map(u => u.id));
  db.uploads = db.uploads.filter(u => !ids.has(u.id));
  changed();
}

export function pruneUploads(): void {
  const old = Date.now() - UNUSED_UPLOAD_MS;
  removeUploads(u => (u.chatId === null && u.createdAt < old) || !fs.existsSync(u.path));
}

export function loadStore(): void {
  fs.mkdirSync(DIR, { recursive: true });
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<Db>;
    if (typeof saved.nextChatId === 'number') db.nextChatId = saved.nextChatId;
    if (typeof saved.nextRunId === 'number') db.nextRunId = saved.nextRunId;
    if (Array.isArray(saved.devices)) db.devices = saved.devices;
    if (Array.isArray(saved.chats)) db.chats = saved.chats;
    if (Array.isArray(saved.runs)) db.runs = saved.runs;
    if (Array.isArray(saved.uploads)) db.uploads = saved.uploads;
    if (saved.usage && typeof saved.usage === 'object') db.usage = saved.usage;
    if (saved.settings && typeof saved.settings === 'object') db.settings = saved.settings;
    migrate();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Keep the unreadable file instead of overwriting it with an empty store.
      const aside = path.join(DIR, `state.unreadable-${Date.now()}.json`);
      try { fs.copyFileSync(FILE, aside); } catch {}
      log(`data/state.json could not be read (${errorMessage(e)}); kept a copy at ${aside} and started empty`);
    }
  }
}

// Data saved before workflows existed: one session per chat, runs without agentId.
function migrate(): void {
  const agentOfChat = new Map<number, string | null>();
  for (const c of db.chats) {
    c.workflowId ??= null;
    c.agentId ??= null;
    c.branch ??= null;
    if (!c.sessions || typeof c.sessions !== 'object') c.sessions = {};
    if (c.sessionId && c.agentId) c.sessions[c.agentId] ??= c.sessionId;
    delete c.sessionId;
    agentOfChat.set(c.id, c.agentId);
  }
  for (const r of db.runs) if (!r.agentId) r.agentId = agentOfChat.get(r.chatId) || '';
}

const listeners = new Set<() => void>();
let saveTimer: NodeJS.Timeout | undefined;
export const onChange = (fn: () => void): void => { listeners.add(fn); };

export function changed(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
  for (const fn of listeners) { try { fn(); } catch {} }
}

function prune(): void {
  const chatIds = new Set(db.chats.map(c => c.id));
  db.runs = db.runs.filter(r => {
    if (chatIds.has(r.chatId)) return true;
    removeRunFiles(r);
    return false;
  });
  let extra = db.runs.length - KEEP_RUNS;
  if (extra > 0) {
    db.runs = db.runs.filter(r => {
      const keep = r.status === 'running' || r.status === 'queued' || r.status === 'awaiting';
      if (extra > 0 && !keep) {
        extra--;
        removeRunFiles(r);
        return false;
      }
      return true;
    });
  }
}

export function saveNow(): void {
  clearTimeout(saveTimer);
  prune();
  const body = JSON.stringify(db);
  const tmp = FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, FILE);
  } catch {
    try { fs.writeFileSync(FILE, body); } catch (e) { log('save failed:', errorMessage(e)); }
  }
}
