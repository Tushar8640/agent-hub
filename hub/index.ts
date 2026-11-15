// Agent Hub: one local server for any number of coding agents, used from a phone (PWA) or this PC.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { ROOT, loadConfig } from './config.js';
import crypto from 'node:crypto';
import { db, loadStore, changed, onChange, saveNow, UPLOAD_DIR, BRANCH_DIR, pruneUploads, removeUploads } from './store.js';
import { DEVICE_COOKIE, deviceForRequest, isLocalRequest, newPairingCode, publicDevice, redeemPairing, revokeDevice } from './auth.js';
import { buildAgents } from './adapters/index.js';
import { createRunner, isActive } from './runner.js';
import { createWorktree, isRepo, mergeBranch, pendingChanges, removeWorktree, reverseApply, revertCommit } from './git.js';
import { clip, errorMessage, lanAddresses, log } from './util.js';
import { discover, insideRoots, mergeProjects } from './projects.js';
import { ensureAutostart } from './autostart.js';
import type { Agent, AntigravityGroup, Attachment, Chat, Project, Run, SystemStats, UsageWindow, Workflow } from './types.js';

const supervised = process.env.AGENT_HUB_SUPERVISED === '1';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

const config = loadConfig();
loadStore();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
pruneUploads();
const agents = new Map<string, Agent>(buildAgents(config.agents).map(a => [a.id, a]));
const projects = new Map<string, Project>();

async function refreshProjects(): Promise<Project[]> {
  const discovered = discover(config.projectRoots);
  const added = Array.isArray(db.settings.addedProjects) ? db.settings.addedProjects : [];
  const merged = mergeProjects(config.projects, discovered, added, config.projectRoots);
  await Promise.all(merged.map(async p => {
    p.git = !p.missing && await isRepo(p.path);
  }));
  projects.clear();
  for (const p of merged) {
    projects.set(p.id, p);
  }
  return [...projects.values()];
}

await refreshProjects();
for (const p of projects.values()) {
  log(`project "${p.id}" (${p.source}): ${p.missing ? 'folder not found' : p.git ? 'git repository' : 'not a git repository (no branches/undo)'}`);
}
const workflows = new Map<string, Workflow>(config.workflows.map(w => [w.id, w]));
// Settings saved from the app override config.yaml.
const limits = () => ({
  maxParallel: db.settings.maxParallel ?? config.maxParallel,
  timeoutMs: (db.settings.runTimeoutMinutes ?? config.runTimeoutMs / 60000) * 60000,
});

// Plan usage limits, as reported by the agent (Claude Code: rate_limit_info with unifiedWindows).
// Stored as-is per window; the app only shows what the agent actually reported.
const WINDOW_LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: '7-day', seven_day_opus: '7-day (Opus)', seven_day_sonnet: '7-day (Sonnet)' };
function saveUsage(agentId: string, raw: Record<string, unknown>) {
  // Antigravity structured quota groups
  if (Array.isArray(raw.groups) && raw.groups.length) {
    db.usage[agentId] = {
      updatedAt: Date.now(),
      status: typeof raw.status === 'string' ? raw.status : null,
      windows: [],
      groups: raw.groups as AntigravityGroup[],
      text: typeof raw.text === 'string' ? raw.text : undefined,
      source: typeof raw.source === 'string' ? raw.source : undefined,
    };
    changed();
    return;
  }
  // A plain-text report (e.g. Antigravity's /usage without structured groups) is kept exactly as the agent wrote it.
  if (typeof raw.text === 'string') {
    db.usage[agentId] = {
      updatedAt: Date.now(), status: null, windows: [], text: raw.text,
      source: typeof raw.source === 'string' ? raw.source : undefined,
    };
    changed();
    return;
  }
  const windowsRaw = raw.unifiedWindows && typeof raw.unifiedWindows === 'object' ? raw.unifiedWindows as Record<string, unknown> : {};
  const windows: UsageWindow[] = Object.entries(windowsRaw).map(([key, v]) => {
    const w = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const resets = typeof w.resetsAt === 'number' ? w.resetsAt : null;
    return {
      key,
      label: WINDOW_LABELS[key] || key.replace(/_/g, ' '),
      utilization: typeof w.utilization === 'number' ? w.utilization : null,
      resetsAt: resets === null ? null : resets < 1e12 ? resets * 1000 : resets, // seconds or milliseconds
    };
  });
  db.usage[agentId] = { updatedAt: Date.now(), status: typeof raw.status === 'string' ? raw.status : null, windows };
  changed();
}

const runner = createRunner({
  agents,
  projects,
  workflows,
  uploadDir: UPLOAD_DIR,
  limits,
  onUsage: saveUsage,
  projectRoots: () => config.projectRoots,
});

// Usage probes cost a tiny request, so at most one per agent at a time, and on demand (plus once at start).
const probing = new Set<string>();
const probingModels = new Set<string>();
async function refreshUsage(agent: Agent): Promise<boolean> {
  if (!agent.probeUsage || !agent.available || probing.has(agent.id)) return false;
  probing.add(agent.id);
  changed();
  try {
    const raw = await agent.probeUsage();
    if (raw) saveUsage(agent.id, raw);
    return !!raw;
  } finally { probing.delete(agent.id); changed(); }
}
setTimeout(() => {
  for (const a of agents.values()) {
    const u = db.usage[a.id];
    // Probe Claude and Antigravity automatically on start if stale (> 20 mins)
    if ((a.type === 'claude-code' || a.type === 'antigravity') && a.probeUsage && (!u || Date.now() - u.updatedAt > 20 * 60 * 1000)) {
      refreshUsage(a).catch(() => {});
    }
  }
}, 3000);
setInterval(() => {
  for (const a of agents.values()) {
    const u = db.usage[a.id];
    if ((a.type === 'claude-code' || a.type === 'antigravity') && a.probeUsage && (!u || Date.now() - u.updatedAt > 20 * 60 * 1000)) {
      refreshUsage(a).catch(() => {});
    }
  }
}, 20 * 60 * 1000);
saveNow(); // persist the "interrupted" marks from the runner

for (const a of agents.values()) {
  log(`agent "${a.id}" (${a.type}): ${a.available ? 'ready' : 'NOT available - ' + a.problem}${a.fullAccess ? ' [FULL ACCESS: no permission checks]' : ''}`);
}
for (const w of workflows.values()) log(`workflow "${w.id}": ${w.steps.map(s => `${s.label} (${s.agentId})`).join(' -> ')}`);
if (!agents.size) log('no agents configured - add some to config.yaml');
if (!projects.size) log('no projects found - check projectRoots and projects in config.yaml');

// ---------- helpers ----------
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// The React app (web/, built with Vite into web/dist). Falls back to the old app until the first build exists.
const WEB_DIST = path.join(ROOT, 'web', 'dist');
const WEB_DIR = fs.existsSync(path.join(WEB_DIST, 'index.html')) ? WEB_DIST : path.join(ROOT, 'web-legacy', 'public');
log(`serving the app from ${path.relative(ROOT, WEB_DIR)}`);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp',
};
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

function send(res: http.ServerResponse, code: number, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
const json = (res: http.ServerResponse, code: number, obj: unknown) =>
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (size > limit) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const v: unknown = text ? JSON.parse(text) : {};
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
      } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// Streams an upload straight to disk, stopping at `limit` bytes.
function saveUpload(req: http.IncomingMessage, file: string, limit: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const out = fs.createWriteStream(file, { flags: 'wx' });
    const cleanup = () => { out.destroy(); fs.rm(file, { force: true }, () => {}); };
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit && !tooBig) { tooBig = true; req.unpipe(out); cleanup(); req.resume(); }
    });
    req.on('end', () => { if (tooBig) reject(new HttpError(413, `File is larger than ${limit / 1024 / 1024} MB.`)); });
    req.on('error', e => { cleanup(); reject(e); });
    out.on('error', e => { cleanup(); reject(e); });
    out.on('finish', () => { if (!tooBig) resolve(size); });
    req.pipe(out);
  });
}

// Display name: keep the original (Unicode is fine) minus path separators and control characters.
const displayName = (s: string) => s.replace(/[\\/\u0000-\u001f\u007f]+/g, '_').trim().slice(-120) || 'file';
// Disk name: ASCII only, so no agent or shell ever sees odd characters in the path.
const diskName = (s: string) => s.replace(/[^\w.\-()]+/g, '_').replace(/^[._]+/, '').slice(-80) || 'file';

// Message attachments: upload ids from this device's session, not yet used by another chat.
function takeAttachments(raw: unknown, chat: Chat): Attachment[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return `Attach up to ${MAX_ATTACHMENTS} files.`;
  const out: Attachment[] = [];
  for (const id of raw) {
    const u = db.uploads.find(x => x.id === id && (x.chatId === null || x.chatId === chat.id));
    if (!u) return 'An attached file was not found. Attach it again.';
    out.push({ id: u.id, name: u.name, size: u.size, type: u.type, path: u.path });
  }
  for (const a of out) { const u = db.uploads.find(x => x.id === a.id); if (u) u.chatId = chat.id; }
  return out;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const titleFrom = (text: string) => clip(text.replace(/\s+/g, ' ').trim(), 60) || 'New chat';

function serveStatic(res: http.ServerResponse, pathname: string) {
  let rel: string;
  try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); }
  catch { return send(res, 400, 'Bad path'); }
  const file = path.resolve(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(file, (e, buf) => {
    if (e) return send(res, 404, 'Not found');
    // Vite's /assets/* file names contain a content hash, so they can be cached for good.
    const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    send(res, 200, buf, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
  });
}

// ---------- views ----------
const chatRuns = (id: number) => db.runs.filter(r => r.chatId === id);
const findChat = (id: number) => db.chats.find(c => c.id === id) || null;

function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/```\w*/g, '')
    .replace(/(?:^|\n)\s*#{1,6}\s+/g, ' ')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:^|\n)\s*>\s*/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[-*+]\s+\[[ xX]\]\s+/g, '')
    .replace(/(?:^|\n)\s*[-*+]\s+/g, ' ')
    .replace(/(?:^|\n)\s*\d+\.\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chatSummary(c: Chat) {
  const runs = chatRuns(c.id);
  const last = runs[runs.length - 1];
  const status = runs.some(r => r.status === 'running') ? 'running'
    : runs.some(r => r.status === 'awaiting') ? 'awaiting'
    : runs.some(r => r.status === 'queued') ? 'queued' : (last ? last.status : 'new');
  let preview: { who: string; text: string } | null = null;
  if (last) {
    if (last.status === 'awaiting') preview = { who: 'activity', text: `Waiting for your approval: ${last.workflow?.label || 'next step'}` };
    else if (last.status === 'done') preview = { who: 'agent', text: last.result || '(no text reply)' };
    else if (last.status === 'running') { const a = last.activity[last.activity.length - 1]; preview = { who: 'activity', text: a ? a.text : 'Working…' }; }
    else if (last.status === 'queued') preview = { who: 'you', text: last.prompt };
    else preview = { who: 'error', text: last.status === 'aborted' ? 'Stopped' : (last.error || last.status) };
    preview.text = clip(stripMarkdown(preview.text), 140);
  }
  const wf = c.workflowId ? workflows.get(c.workflowId) : undefined;
  // For the list/header: a workflow chat is shown under the workflow's name and id (used for its avatar colour).
  const agentKey = c.workflowId ? `wf:${c.workflowId}` : (c.agentId || '');
  const agentName = c.workflowId ? (wf?.name || c.workflowId) : (agents.get(c.agentId || '')?.name || c.agentId || '?');
  return {
    id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, status, preview,
    kind: c.workflowId ? 'workflow' : 'agent',
    workflowId: c.workflowId,
    agentId: agentKey, agentName,
    projectId: c.projectId, projectName: projects.get(c.projectId)?.name || c.projectId,
    branch: c.branch ? { name: c.branch.name, mergedAt: c.branch.mergedAt } : null,
    skipPermissions: c.skipPermissions === true,
    autoApprove: c.autoApprove === true,
    model: c.model || null,
    runCount: runs.length, costUsd: runs.reduce((s, r) => s + (r.costUsd || 0), 0),
    lastAt: last ? (last.endedAt || last.startedAt || last.createdAt) : c.createdAt,
  };
}

const publicAgent = (a: Agent) => ({
  id: a.id, name: a.name, type: a.type, available: a.available, problem: a.problem, resumable: a.resumable, fullAccess: a.fullAccess,
  models: a.models || [],
});
const publicWorkflow = (w: Workflow) => {
  const missing = w.steps.map(s => agents.get(s.agentId)).filter(a => !a || !a.available);
  return {
    id: w.id, name: w.name, description: w.description,
    steps: w.steps.map(s => ({ agentId: s.agentId, agentName: agents.get(s.agentId)?.name || s.agentId, label: s.label })),
    hasApproval: w.steps.some(s => s.approve),
    available: missing.length === 0,
    problem: missing.length ? `Not available: ${missing.map(a => a?.name || 'unknown agent').join(', ')}` : null,
  };
};
// The app never needs PC file paths: attachments go out as name/size/type only.
const publicRun = ({ aborted, timedOut, attachments, changes, ...r }: Run) => ({
  ...r,
  attachments: (attachments || []).map(a => ({ id: a.id, name: a.name, size: a.size, type: a.type })),
  changes: changes ? {
    mode: changes.mode, files: changes.files, commit: changes.commit || null, truncated: !!changes.truncated,
    undone: !!changes.undone, error: changes.error || null, hasDiff: !!changes.patchFile,
  } : null,
});

function snapshot() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todays = db.runs.filter(r => r.createdAt >= today.getTime());
  return {
    now: Date.now(),
    name: config.name,
    publicUrl: config.publicUrl,
    maxParallel: limits().maxParallel,
    branchByDefault: db.settings.branchByDefault ?? true,
    agents: [...agents.values()].map(a => {
      const u = db.usage[a.id];
      // Short usage line for the sidebar: Antigravity/Claude's windows in %, or the first line of a text report.
      const summary = !u ? null
        : u.groups && u.groups.length
          ? u.groups.map(g => {
              const b = g.buckets.find(b => /5h|5-hour/i.test(b.window || b.id || b.name)) || g.buckets[0];
              const name = /gemini/i.test(g.name) ? 'Gemini' : 'Claude/GPT';
              return b ? `${name} ${Math.round((b.remaining_fraction || 0) * 100)}%` : null;
            }).filter(Boolean).join(' · ')
        : u.windows.length ? u.windows.slice(0, 2).map(w => `${w.label} ${w.utilization == null ? '–' : Math.round(w.utilization * 100) + '%'}`).join(' · ')
        : u.text ? clip(u.text.split(/\r?\n/).find(l => l.trim()) || '', 60) : null;
      return { ...publicAgent(a), usageSummary: summary };
    }),
    workflows: [...workflows.values()].map(publicWorkflow),
    projects: [...projects.values()].map(p => ({ id: p.id, name: p.name, path: p.path, missing: p.missing, git: p.git, source: p.source })),
    roots: config.projectRoots,
    stats: {
      running: db.runs.filter(r => r.status === 'running').length,
      queued: db.runs.filter(r => r.status === 'queued').length,
      costToday: todays.some(r => r.costUsd != null) ? todays.reduce((s, r) => s + (r.costUsd || 0), 0) : null,
    },
    chats: db.chats.map(chatSummary).sort((a, b) => b.lastAt - a.lastAt),
  };
}

const limitsAsSettings = () => ({ maxParallel: limits().maxParallel, runTimeoutMinutes: Math.round(limits().timeoutMs / 60000) });

function getSystemStats(): SystemStats {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = totalBytes > 0 ? Math.round(((usedBytes / totalBytes) * 100) * 10) / 10 : 0;

  const disks = [];
  if (process.platform === 'win32') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const l of letters) {
      const drive = l + ':\\';
      try {
        const s = fs.statfsSync(drive);
        if (s.blocks > 0) {
          const total = s.blocks * s.bsize;
          const free = s.bavail * s.bsize;
          const used = total - free;
          const percent = total > 0 ? Math.round(((used / total) * 100) * 10) / 10 : 0;
          disks.push({ drive: l + ':', totalBytes: total, freeBytes: free, usedBytes: used, usedPercent: percent });
        }
      } catch {}
    }
  } else {
    try {
      const s = fs.statfsSync('/');
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = total - free;
      const percent = total > 0 ? Math.round(((used / total) * 100) * 10) / 10 : 0;
      disks.push({ drive: '/', totalBytes: total, freeBytes: free, usedBytes: used, usedPercent: percent });
    } catch {}
  }

  return {
    ram: { totalBytes, freeBytes, usedBytes, usedPercent },
    disks,
    uptimeSeconds: Math.floor(os.uptime()),
    cpuCount: os.cpus().length,
  };
}

// Dashboard: per-agent activity from the hub's own records, plus plan usage limits where the agent reports them.
function dashboard() {
  const now = Date.now();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 864e5;
  const sum = (runs: Run[]) => {
    const finished = runs.filter(r => r.startedAt && r.endedAt);
    return {
      messages: runs.length,
      done: runs.filter(r => r.status === 'done').length,
      errors: runs.filter(r => r.status === 'error' || r.status === 'interrupted').length,
      tokensIn: runs.reduce((s, r) => s + (r.tokensIn || 0), 0),
      tokensOut: runs.reduce((s, r) => s + (r.tokensOut || 0), 0),
      costUsd: runs.some(r => r.costUsd != null) ? runs.reduce((s, r) => s + (r.costUsd || 0), 0) : null,
      avgSeconds: finished.length ? Math.round(finished.reduce((s, r) => s + ((r.endedAt as number) - (r.startedAt as number)), 0) / finished.length / 1000) : null,
    };
  };
  const agentStats = [...agents.values()].map(a => {
    const mine = db.runs.filter(r => r.agentId === a.id);
    const lastRun = mine[mine.length - 1];
    return {
      ...publicAgent(a),
      canProbe: !!a.probeUsage && a.available,
      probing: probing.has(a.id),
      usage: db.usage[a.id] || null,
      running: mine.filter(r => r.status === 'running').length,
      chats: db.chats.filter(c => c.sessions[a.id]).length, // chats where this agent has a saved session
      lastUsedAt: lastRun ? (lastRun.endedAt || lastRun.startedAt || lastRun.createdAt) : null,
      today: sum(mine.filter(r => r.createdAt >= dayStart.getTime())),
      week: sum(mine.filter(r => r.createdAt >= weekAgo)),
    };
  });
  const active = db.runs.filter(isActive).map(r => {
    const chat = findChat(r.chatId);
    return {
      runId: r.id, chatId: r.chatId, chatTitle: chat?.title || `Chat ${r.chatId}`, status: r.status,
      agentName: agents.get(r.agentId)?.name || r.agentId, startedAt: r.startedAt, createdAt: r.createdAt,
      step: r.workflow ? `${r.workflow.label} (${r.workflow.step + 1}/${r.workflow.steps})` : null,
    };
  });
  return { now, agents: agentStats, active, limits: { maxParallel: limits().maxParallel }, system: getSystemStats() };
}

// ---------- live updates (Server-Sent Events) ----------
const sseClients = new Set<http.ServerResponse>();
let notifyTimer: NodeJS.Timeout | undefined;
onChange(() => {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => { for (const res of sseClients) res.write('event: changed\ndata: 1\n\n'); }, 200);
});

// ---------- routes ----------
async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', 'http://hub.local');
  const p = url.pathname;

  if (!p.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(res, p);
  }

  const local = isLocalRequest(req, config.port);
  const device = local ? null : deviceForRequest(req);
  const authed = local || !!device;
  // Every POST needs this header. A cross-site form or fetch cannot send it without a CORS preflight, which we never allow.
  if (req.method === 'POST' && req.headers['x-hub'] !== '1') return json(res, 403, { error: 'Missing X-Hub header' });

  if (p === '/api/me' && req.method === 'GET') {
    return json(res, 200, { authed, local, device: device ? { id: device.id, name: device.name } : null, name: config.name, port: config.port });
  }

  if (p === '/api/pair' && req.method === 'POST') {
    const body = await readBody(req, 4096);
    const r = redeemPairing(str(body.code, 100), str(body.name, 80));
    if (!r) return json(res, 400, { error: 'This pairing code is invalid or has expired. Create a new one on the PC.' });
    log(`paired device "${r.device.name}"`);
    res.setHeader('Set-Cookie', `${DEVICE_COOKIE}=${r.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`);
    return json(res, 200, { ok: true, device: { id: r.device.id, name: r.device.name } });
  }

  if (!authed) return json(res, 401, { error: 'This device is not paired.' });

  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  if (p === '/api/state' && req.method === 'GET') return json(res, 200, snapshot());
  if (p === '/api/dashboard' && req.method === 'GET') return json(res, 200, dashboard());
  if (p === '/api/settings' && req.method === 'GET') {
    return json(res, 200, {
      local,
      settings: { ...limitsAsSettings(), branchByDefault: db.settings.branchByDefault ?? true },
      defaults: { maxParallel: config.maxParallel, runTimeoutMinutes: config.runTimeoutMs / 60000, branchByDefault: true },
      hub: { name: config.name, port: config.port, host: config.host, publicUrl: config.publicUrl },
      agents: [...agents.values()].map(a => {
        const cfg = config.agents.find(c => c.id === a.id);
        return {
          ...publicAgent(a),
          permissionMode: typeof cfg?.permissionMode === 'string' ? cfg.permissionMode : null,
          allowedTools: Array.isArray(cfg?.allowedTools) ? cfg.allowedTools.map(String) : null,
        };
      }),
      workflows: [...workflows.values()].map(w => ({ ...publicWorkflow(w), approvals: w.steps.filter(s => s.approve).map(s => s.label) })),
      projects: [...projects.values()].map(p => ({ id: p.id, name: p.name, path: p.path, missing: p.missing, git: p.git, source: p.source })),
      roots: config.projectRoots,
    });
  }

  const chatGet = p.match(/^\/api\/chats\/(\d+)$/);
  if (chatGet && req.method === 'GET') {
    const chat = findChat(Number(chatGet[1]));
    if (!chat) return json(res, 404, { error: 'Chat not found' });
    const runs = chatRuns(chat.id).map(r => ({ ...publicRun(r), agentName: agents.get(r.agentId)?.name || r.agentId }));
    return json(res, 200, { chat: chatSummary(chat), runs });
  }

  // The saved diff of one run, as plain text.
  const diffGet = p.match(/^\/api\/runs\/(\d+)\/diff$/);
  if (diffGet && req.method === 'GET') {
    const run = db.runs.find(r => r.id === Number(diffGet[1]));
    const file = run?.changes?.patchFile;
    if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'No saved changes for this message.' });
    return send(res, 200, fs.readFileSync(file), { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  }

  // ---- PC-only: pairing and devices ----
  if (p === '/api/pairing' && req.method === 'POST') {
    if (!local) return json(res, 403, { error: 'Pairing can only be started on the PC.' });
    const { code, expiresAt } = newPairingCode();
    const targets: { label: string; url: string }[] = [];
    if (config.publicUrl) targets.push({ label: `HTTPS · ${config.publicUrl}`, url: `${config.publicUrl}/#pair=${code}` });
    if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
      for (const a of lanAddresses()) {
        targets.push({ label: `${a.kind === 'tailscale' ? 'Tailscale' : 'Wi-Fi / LAN'} · ${a.address}`, url: `http://${a.address}:${config.port}/#pair=${code}` });
      }
    }
    const links = await Promise.all(targets.map(async t => ({ ...t, qr: await QRCode.toDataURL(t.url, { margin: 1, width: 280 }) })));
    return json(res, 200, { expiresAt, links });
  }
  if (p === '/api/devices' && req.method === 'GET') {
    if (!local) return json(res, 403, { error: 'Devices can only be managed on the PC.' });
    return json(res, 200, { devices: db.devices.map(publicDevice) });
  }
  const revoke = p.match(/^\/api\/devices\/([\w-]+)\/revoke$/);
  if (revoke && req.method === 'POST') {
    if (!local) return json(res, 403, { error: 'Devices can only be managed on the PC.' });
    const ok = revokeDevice(revoke[1]);
    return json(res, ok ? 200 : 404, { ok });
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'Not found' });

  if (p === '/api/settings') {
    // Only harmless operational settings can be changed from the app. Agent permissions stay in config.yaml.
    const body = await readBody(req);
    const n = (v: unknown, min: number, max: number) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Math.round(Number(v)))) : undefined);
    if (body.maxParallel !== undefined) db.settings.maxParallel = n(body.maxParallel, 1, 10);
    if (body.runTimeoutMinutes !== undefined) db.settings.runTimeoutMinutes = n(body.runTimeoutMinutes, 1, 240);
    if (typeof body.branchByDefault === 'boolean') db.settings.branchByDefault = body.branchByDefault;
    if (body.reset === true) db.settings = { addedProjects: db.settings.addedProjects };
    changed();
    runner.pump(); // a higher limit can start queued work right away
    return json(res, 200, { ok: true });
  }
  if (p === '/api/stop-all') return json(res, 200, { stopped: runner.abortAll() });
  const usageRefresh = p.match(/^\/api\/usage\/([\w-]+)\/refresh$/);
  if (usageRefresh) {
    const agent = agents.get(usageRefresh[1]);
    if (!agent || !agent.probeUsage) return json(res, 404, { error: 'This agent does not report usage limits.' });
    const ok = await refreshUsage(agent);
    return json(res, ok ? 200 : 502, ok ? { ok } : { error: 'No usage data came back (or a check is already running).' });
  }
  const modelsRefresh = p.match(/^\/api\/agents\/([\w-]+)\/models\/refresh$/);
  if (modelsRefresh) {
    const agent = agents.get(modelsRefresh[1]);
    if (!agent) return json(res, 404, { error: 'Agent not found.' });
    if (!agent.available) return json(res, 400, { error: agent.problem || 'This agent is not available.' });
    if (!agent.refreshModels) return json(res, 400, { error: 'This agent does not support refreshing models.' });
    if (probingModels.has(agent.id)) return json(res, 409, { error: 'Model refresh is already in progress.' });
    probingModels.add(agent.id);
    try {
      const models = await agent.refreshModels();
      changed();
      return json(res, 200, { ok: true, models });
    } catch (e) {
      return json(res, 500, { error: errorMessage(e) });
    } finally {
      probingModels.delete(agent.id);
    }
  }
  if (p === '/api/projects/refresh' && req.method === 'POST') {
    const list = await refreshProjects();
    changed();
    return json(res, 200, { ok: true, projects: list.map(p => ({ id: p.id, name: p.name, path: p.path, missing: p.missing, git: p.git, source: p.source })) });
  }
  if (p === '/api/projects/add' && req.method === 'POST') {
    const body = await readBody(req);
    const rawPath = str(body.path, 500);
    if (!rawPath) return json(res, 400, { error: 'Folder path is required.' });
    const full = path.resolve(rawPath);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      return json(res, 400, { error: 'Folder does not exist or is not a directory.' });
    }
    if (!insideRoots(full, config.projectRoots)) {
      return json(res, 403, { error: 'Folder is outside the allowed project roots in config.yaml' });
    }
    let real = full;
    try { real = fs.realpathSync(full); } catch {}
    if (!Array.isArray(db.settings.addedProjects)) db.settings.addedProjects = [];
    if (!db.settings.addedProjects.includes(real)) {
      db.settings.addedProjects.push(real);
      changed();
    }
    const list = await refreshProjects();
    return json(res, 200, { ok: true, projects: list.map(p => ({ id: p.id, name: p.name, path: p.path, missing: p.missing, git: p.git, source: p.source })) });
  }
  const projRemove = p.match(/^\/api\/projects\/([\w-]+)\/remove$/);
  if (projRemove && req.method === 'POST') {
    const proj = projects.get(projRemove[1]);
    if (!proj) return json(res, 404, { error: 'Project not found.' });
    if (proj.source !== 'added') return json(res, 400, { error: 'Only added projects can be removed.' });
    const runningInProject = db.runs.some(r => r.status === 'running' && findChat(r.chatId)?.projectId === proj.id);
    if (runningInProject) return json(res, 409, { error: 'A chat is currently running in this project. Stop it first.' });
    db.settings.addedProjects = (db.settings.addedProjects || []).filter(item => {
      try { return fs.realpathSync(item) !== fs.realpathSync(proj.path); }
      catch { return item !== proj.path; }
    });
    changed();
    await refreshProjects();
    return json(res, 200, { ok: true });
  }
  if (p === '/api/hub/restart') {
    // Supervised: exits and the supervisor starts the hub again. Otherwise spawns a background copy before exiting.
    if (db.runs.some(r => r.status === 'running')) return json(res, 409, { error: 'Agents are working. Stop them first, or wait.' });
    saveNow();
    json(res, 200, { ok: true, supervised });
    log('restart requested from the app');
    setTimeout(restartHub, 300);
    return;
  }
  const source = device ? 'app' as const : 'pc' as const;

  // Upload one file (raw body). The app sends the files first, then the message with their ids.
  if (p === '/api/uploads') {
    const name = displayName(url.searchParams.get('name') || 'file');
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD_BYTES) return json(res, 413, { error: `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });
    const id = crypto.randomUUID();
    const file = path.join(UPLOAD_DIR, `${id.slice(0, 8)}-${diskName(name)}`);
    const size = await saveUpload(req, file, MAX_UPLOAD_BYTES);
    const type = str(req.headers['content-type'], 100) || 'application/octet-stream';
    db.uploads.push({ id, name, size, type, path: file, createdAt: Date.now(), chatId: null });
    changed();
    return json(res, 200, { id, name, size, type });
  }

  if (p === '/api/chats') {
    const body = await readBody(req);
    const workflow = workflows.get(str(body.workflowId, 60));
    const agent = workflow ? undefined : agents.get(str(body.agentId, 60));
    const project = projects.get(str(body.projectId, 60));
    const prompt = str(body.prompt, 20000);
    if (workflow) {
      const pw = publicWorkflow(workflow);
      if (!pw.available) return json(res, 400, { error: pw.problem || 'This workflow is not available.' });
    } else {
      if (!agent) return json(res, 400, { error: 'Pick an agent or a workflow.' });
      if (!agent.available) return json(res, 400, { error: agent.problem || 'This agent is not available.' });
    }
    if (!project || project.missing) return json(res, 400, { error: 'Pick a project.' });
    const chat: Chat = {
      id: db.nextChatId++, title: 'New chat', agentId: agent ? agent.id : null, workflowId: workflow ? workflow.id : null,
      projectId: project.id, sessions: {}, branch: null, model: str(body.model, 80) || null, createdAt: Date.now(), updatedAt: Date.now(),
      autoApprove: workflow && body.autoApprove === true ? true : undefined,
    };
    const files = takeAttachments(body.attachments, chat);
    if (typeof files === 'string') return json(res, 400, { error: files });
    // Own branch: a git worktree outside the project, so parallel chats never edit the same files.
    if (body.branch === true && project.git) {
      const pending = await pendingChanges(project.path).catch(() => 0);
      if (pending > 0) {
        for (const f of files) { const u = db.uploads.find(x => x.id === f.id); if (u) u.chatId = null; }
        return json(res, 409, {
          error: `The project has ${pending} uncommitted file${pending === 1 ? '' : 's'}. A new branch starts from the last commit and would not include them. Commit your work first, or untick "Work on its own branch".`,
        });
      }
      const name = `agent-hub/chat-${chat.id}`;
      const dir = path.join(BRANCH_DIR, `${project.id}-chat-${chat.id}`);
      try {
        const base = await createWorktree(project.path, dir, name, project.branchCopy);
        chat.branch = { name, path: dir, base, mergedAt: null };
      } catch (e) {
        for (const f of files) { const u = db.uploads.find(x => x.id === f.id); if (u) u.chatId = null; }
        return json(res, 500, { error: `Could not create the branch: ${errorMessage(e)}` });
      }
    }
    chat.title = titleFrom(prompt || files.map(f => f.name).join(', '));
    db.chats.push(chat);
    changed();
    if (prompt || files.length) runner.queue(chat, prompt, source, files);
    return json(res, 200, { id: chat.id });
  }

  const runPost = p.match(/^\/api\/runs\/(\d+)\/(abort|approve|undo)$/);
  if (runPost) {
    const run = db.runs.find(r => r.id === Number(runPost[1]));
    if (!run) return json(res, 404, { error: 'Message not found' });
    if (runPost[2] === 'abort') return json(res, 200, { ok: runner.abortRun(run) });

    if (runPost[2] === 'approve') {
      const handoff = str((await readBody(req, 200_000)).handoff, 60_000);
      if (!runner.approve(run, handoff || undefined)) return json(res, 409, { error: 'This step is no longer waiting for approval.' });
      return json(res, 200, { ok: true });
    }

    // Undo the files this message changed.
    const chat = findChat(run.chatId);
    const project = chat ? projects.get(chat.projectId) : undefined;
    const ch = run.changes;
    if (!chat || !project || !ch || ch.error || !ch.files.length) return json(res, 400, { error: 'There are no changes to undo for this message.' });
    if (ch.undone) return json(res, 409, { error: 'Already undone.' });
    if (chatRuns(chat.id).some(r => r.status === 'running')) return json(res, 409, { error: 'Wait until the agent has finished.' });
    if (ch.mode === 'branch') {
      if (!chat.branch || !ch.commit) return json(res, 400, { error: 'The branch for this chat is gone.' });
      await revertCommit(chat.branch.path, ch.commit).catch(e => { throw new HttpError(409, errorMessage(e)); });
    } else {
      if (ch.truncated || !ch.patchFile) return json(res, 400, { error: 'These changes are too large to undo automatically.' });
      await reverseApply(project.path, ch.patchFile, ch.createdFiles || []).catch(e => { throw new HttpError(409, errorMessage(e)); });
    }
    ch.undone = true;
    changed();
    return json(res, 200, { ok: true });
  }

  const chatPost = p.match(/^\/api\/chats\/(\d+)\/(messages|abort|rename|delete|merge|reset-session|permissions|model|auto-approve)$/);
  if (!chatPost) return json(res, 404, { error: 'Not found' });
  const chat = findChat(Number(chatPost[1]));
  if (!chat) return json(res, 404, { error: 'Chat not found' });

  switch (chatPost[2]) {
    case 'model': {
      const body = await readBody(req, 1024);
      const chosen = str(body.model, 80) || null;
      chat.model = chosen;
      log(`chat ${chat.id}: model set to ${chosen || 'default'}`);
      changed();
      return json(res, 200, { ok: true, model: chat.model });
    }
    case 'messages': {
      const body = await readBody(req);
      if (typeof body.model === 'string') {
        chat.model = str(body.model, 80) || null;
      }
      const prompt = str(body.prompt, 20000);
      const files = takeAttachments(body.attachments, chat);
      if (typeof files === 'string') return json(res, 400, { error: files });
      if (!prompt && !files.length) return json(res, 400, { error: 'Message is empty.' });
      if (chat.title === 'New chat' && !chatRuns(chat.id).length) chat.title = titleFrom(prompt || files.map(f => f.name).join(', '));
      const run = runner.queue(chat, prompt, source, files);
      return json(res, 200, { runId: run.id });
    }
    case 'abort':
      return json(res, 200, { stopped: runner.abortChat(chat) });
    case 'reset-session': {
      // The agents forget this chat's earlier messages; the next message starts a fresh session. History stays visible.
      if (chatRuns(chat.id).some(isActive)) return json(res, 409, { error: 'Wait until the chat has finished.' });
      chat.sessions = {};
      changed();
      return json(res, 200, { ok: true });
    }
    case 'permissions': {
      // Per-chat "skip permissions" on/off. Applies from the next message; a running message keeps its mode.
      const body = await readBody(req, 1024);
      if (typeof body.skip !== 'boolean') return json(res, 400, { error: 'Send { "skip": true } or { "skip": false }.' });
      chat.skipPermissions = body.skip;
      log(`chat ${chat.id}: skip permissions ${body.skip ? 'ON' : 'off'} (${device ? `device "${device.name}"` : 'PC'})`);
      changed();
      return json(res, 200, { ok: true, skipPermissions: chat.skipPermissions });
    }
    case 'auto-approve': {
      const body = await readBody(req, 1024);
      if (typeof body.on !== 'boolean') return json(res, 400, { error: 'Send { "on": true } or { "on": false }.' });
      if (!chat.workflowId) return json(res, 400, { error: 'Auto build is only for workflow chats.' });
      chat.autoApprove = body.on;
      const approved = body.on ? runner.autoApproveWaiting(chat) : 0;
      log(`chat ${chat.id}: auto build ${body.on ? 'ON' : 'off'} (${device ? `device "${device.name}"` : 'PC'})`);
      changed();
      return json(res, 200, { ok: true, autoApprove: chat.autoApprove, approved });
    }
    case 'rename': {
      const title = str((await readBody(req)).title, 80).replace(/\s+/g, ' ');
      if (!title) return json(res, 400, { error: 'Title is empty.' });
      chat.title = title;
      changed();
      return json(res, 200, { ok: true });
    }
    case 'merge': {
      // Bring the chat's branch into the project's current branch. A failed merge is cancelled, leaving the project as it was.
      const project = projects.get(chat.projectId);
      if (!chat.branch || !project) return json(res, 400, { error: 'This chat does not have its own branch.' });
      if (chatRuns(chat.id).some(isActive)) return json(res, 409, { error: 'Wait until the chat has finished.' });
      const output = await mergeBranch(project.path, chat.branch.name, `Agent Hub: merge chat ${chat.id} - ${chat.title}`)
        .catch(e => { throw new HttpError(409, errorMessage(e)); });
      chat.branch.mergedAt = Date.now();
      changed();
      return json(res, 200, { ok: true, output });
    }
    case 'delete': {
      if (chatRuns(chat.id).some(isActive)) return json(res, 409, { error: 'Stop the chat before deleting it.' });
      const project = projects.get(chat.projectId);
      if (chat.branch && project) {
        try { await removeWorktree(project.path, chat.branch.path, chat.branch.name); }
        catch (e) { return json(res, 500, { error: `Could not remove the chat's branch: ${errorMessage(e)}` }); }
      }
      for (const r of chatRuns(chat.id)) if (r.changes?.patchFile) fs.rm(r.changes.patchFile, { force: true }, () => {});
      db.chats = db.chats.filter(c => c.id !== chat.id);
      removeUploads(u => u.chatId === chat.id);
      changed();
      return json(res, 200, { ok: true });
    }
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e: unknown) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) log('request error:', errorMessage(e));
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'Server error' : errorMessage(e) });
  });
});

let bindRetries = 0;
server.on('error', (e: NodeJS.ErrnoException) => {
  if (process.env.AGENT_HUB_RESPAWNED === '1' && e.code === 'EADDRINUSE' && bindRetries < 20) {
    bindRetries++;
    setTimeout(() => server.listen(config.port, config.host), 500);
    return;
  }
  log(e.code === 'EADDRINUSE'
    ? `Agent Hub is already running (probably started automatically at login). Open http://localhost:${config.port}. To stop it: scripts\\stop.bat`
    : `server error: ${e.message}`);
  process.exit(1);
});

server.on('listening', () => {
  log(`${config.name} running: http://localhost:${config.port}`);
  log('Open that address on this PC, then Devices -> Pair a phone.');
  if (!supervised) ensureAutostart(config.autostart);
});

server.listen(config.port, config.host);

function restartHub() {
  saveNow();
  for (const r of sseClients) r.end();            // let the server close
  sseClients.clear();
  server.closeAllConnections?.();
  server.close(() => {
    if (!supervised) {
      const logs = path.join(ROOT, 'logs');
      fs.mkdirSync(logs, { recursive: true });
      const out = fs.openSync(path.join(logs, 'hub.log'), 'a');
      const err = fs.openSync(path.join(logs, 'hub-error.log'), 'a');
      const child = spawn(process.execPath, ['--import', 'tsx', 'hub/index.ts'], {
        cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, err],
        env: { ...process.env, AGENT_HUB_RESPAWNED: '1' },
      });
      if (child.pid) fs.writeFileSync(path.join(logs, 'hub.pid'), String(child.pid));
      child.unref();
      log(`restarting: new hub process ${child.pid}`);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref(); // safety net if close() hangs
}

const shutdown = () => { saveNow(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', e => log('unhandledRejection:', errorMessage(e)));
