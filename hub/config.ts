import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { errorMessage, log } from './util.js';
import type { AgentConfig, AgentOverrides, HubConfig, Project, Workflow, WorkflowStep } from './types.js';

const DEFAULT_STEP_PROMPT = '{previous}';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'config.yaml');
const EXAMPLE_FILE = path.join(ROOT, 'config.example.yaml');
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

function isProtectedPath(full: string): boolean {
  const norm = full.toLowerCase();
  const windir = (process.env.WINDIR || 'C:\\Windows').toLowerCase();
  if (norm === windir || norm.startsWith(windir + path.sep)) return true;

  const progFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase();
  if (norm === progFiles || norm.startsWith(progFiles + path.sep)) return true;

  const progFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase();
  if (norm === progFilesX86 || norm.startsWith(progFilesX86 + path.sep)) return true;

  const appData = (process.env.APPDATA || '').toLowerCase();
  if (appData && (norm === appData || norm.startsWith(appData + path.sep))) return true;

  const rootLower = ROOT.toLowerCase();
  if (norm === rootLower || norm.startsWith(rootLower + path.sep)) return true;

  return false;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, def: number, min: number, max: number) =>
  Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.min(max, Math.max(min, Number(v))) : def;

export function loadConfig(): HubConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.copyFileSync(EXAMPLE_FILE, CONFIG_FILE);
    log('created config.yaml from config.example.yaml');
  }
  let raw: Raw;
  try {
    const parsed: unknown = parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    raw = isObj(parsed) ? parsed : {};
  } catch (e) {
    throw new Error(`config.yaml could not be read: ${errorMessage(e)}`);
  }

  const cfg: HubConfig = {
    name: String(raw.name || 'Agent Hub'),
    port: num(raw.port, 8650, 1, 65535),
    host: String(raw.host || '0.0.0.0'),
    publicUrl: raw.publicUrl ? String(raw.publicUrl).replace(/\/+$/, '') : null,
    maxParallel: num(raw.maxParallel, 3, 1, 20),
    runTimeoutMs: num(raw.runTimeoutMinutes, 20, 1, 240) * 60 * 1000,
    projectRoots: [],
    projects: [],
    agents: [],
    workflows: [],
  };

  const rawRoots = Array.isArray(raw.projectRoots)
    ? raw.projectRoots
    : typeof raw.projectRoots === 'string' && raw.projectRoots
      ? [raw.projectRoots]
      : [];
  const seenRoots = new Set<string>();
  for (const r of rawRoots) {
    if (!r) continue;
    const full = path.resolve(String(r));
    const norm = process.platform === 'win32' ? full.toLowerCase() : full;
    if (seenRoots.has(norm)) continue;
    seenRoots.add(norm);

    const parsed = path.parse(full);
    const isDriveRoot = parsed.root.toLowerCase() === full.toLowerCase() ||
      parsed.root.replace(/[\\/]+$/, '').toLowerCase() === full.replace(/[\\/]+$/, '').toLowerCase();
    if (isDriveRoot && raw.allowDriveRoot !== true) {
      log(`config: refused project root "${full}" (drive root not allowed)`);
      continue;
    }
    if (isProtectedPath(full)) {
      log(`config: refused project root "${full}" (inside protected system or hub folder)`);
      continue;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      log(`config: project root not found: ${full}`);
      continue;
    }
    cfg.projectRoots.push(full);
  }

  const seen = new Set<string>();
  for (const p of Array.isArray(raw.projects) ? raw.projects : []) {
    if (!isObj(p) || !ID_RE.test(String(p.id ?? '')) || !p.path) { log('config: skipped a project without a valid id/path'); continue; }
    const id = String(p.id);
    if (seen.has('p:' + id)) { log(`config: duplicate project id "${id}" skipped`); continue; }
    seen.add('p:' + id);
    const full = path.resolve(String(p.path));
    const missing = !fs.existsSync(full) || !fs.statSync(full).isDirectory();
    if (missing) log(`config: project "${id}" folder not found: ${full}`);
    const branchCopy = Array.isArray(p.branchCopy) ? p.branchCopy.map(String) : [];
    const project: Project = { id, name: String(p.name || id), path: full, missing, git: false, branchCopy, source: 'config' }; // git: detected at start-up
    cfg.projects.push(project);
  }

  for (const a of Array.isArray(raw.agents) ? raw.agents : []) {
    if (!isObj(a) || !ID_RE.test(String(a.id ?? '')) || !a.type) { log('config: skipped an agent without a valid id/type'); continue; }
    const id = String(a.id);
    if (seen.has('a:' + id)) { log(`config: duplicate agent id "${id}" skipped`); continue; }
    seen.add('a:' + id);
    const agent: AgentConfig = { ...a, id, name: String(a.name || id), type: String(a.type) };
    cfg.agents.push(agent);
  }

  // Workflows: several agents answer one message in turn, each step getting the previous step's reply.
  const agentIds = new Set(cfg.agents.map(a => a.id));
  for (const w of Array.isArray(raw.workflows) ? raw.workflows : []) {
    if (!isObj(w) || !ID_RE.test(String(w.id ?? ''))) { log('config: skipped a workflow without a valid id'); continue; }
    const id = String(w.id);
    if (seen.has('w:' + id) || agentIds.has(id)) { log(`config: workflow id "${id}" is already used - skipped`); continue; }
    const steps: WorkflowStep[] = [];
    let bad = '';
    for (const [i, s] of (Array.isArray(w.steps) ? w.steps : []).entries()) {
      if (!isObj(s) || !agentIds.has(String(s.agent ?? ''))) { bad = `step ${i + 1} needs "agent" set to one of: ${[...agentIds].join(', ')}`; break; }
      const overrides: AgentOverrides = {};
      if (Array.isArray(s.allowedTools)) overrides.allowedTools = s.allowedTools.map(String);
      if (typeof s.permissionMode === 'string') overrides.permissionMode = s.permissionMode;
      steps.push({
        agentId: String(s.agent),
        label: String(s.label || `Step ${i + 1}`),
        prompt: typeof s.prompt === 'string' && s.prompt.trim() ? s.prompt : (i === 0 ? '{input}' : DEFAULT_STEP_PROMPT),
        overrides,
        approve: i > 0 && s.approve === true, // the first step runs on the user's own message
      });
    }
    if (!bad && !steps.length) bad = 'it has no steps';
    if (bad) { log(`config: workflow "${id}" skipped - ${bad}`); continue; }
    seen.add('w:' + id);
    const workflow: Workflow = { id, name: String(w.name || id), description: String(w.description || ''), steps };
    cfg.workflows.push(workflow);
  }
  return cfg;
}
