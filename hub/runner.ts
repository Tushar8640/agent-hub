// Queues messages and runs them: one at a time per chat (so sessions and workflow steps stay in order),
// up to maxParallel chats at once.
// - Workflow messages run their steps in turn; a step marked `approve` waits ('awaiting') until the user approves
//   or edits the previous reply.
// - In git projects every run records what it changed: in the chat's own branch (checkpoint commit per run) or,
//   without a branch, against a snapshot taken just before the run. The diff is saved so it can be shown and undone.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, changed, DIFF_DIR, IMAGE_DIR } from './store.js';
import { errorMessage } from './util.js';
import { insideRoots } from './projects.js';
import { changedFiles, checkpoint, diffText, snapshot, untrackedFiles } from './git.js';
import type { Agent, Attachment, Chat, Project, Run, RunChanges, RunHandle, RunResult, RunSource, Workflow } from './types.js';

const KEEP_ACTIVITY = 40;
const MAX_HANDOFF = 24_000; // longest previous reply passed on to the next step
const MAX_IMAGES_PER_RUN = 40;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Only raster formats a browser shows safely as <img>. SVG is excluded: it can carry script.
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export const formatSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export interface Runner {
  queue(chat: Chat, prompt: string, source: RunSource, attachments?: Attachment[]): Run;
  approve(run: Run, editedHandoff?: string): boolean;
  autoApproveWaiting(chat: Chat): number;
  abortRun(run: Run): boolean;
  abortChat(chat: Chat): number;
  abortAll(): number;
  pump(): void; // start queued work (e.g. after maxParallel was raised)
}

interface RunnerOptions {
  agents: Map<string, Agent>;
  projects: Map<string, Project>;
  workflows: Map<string, Workflow>;
  uploadDir: string;
  limits(): { maxParallel: number; timeoutMs: number }; // read on every use, so Settings changes apply at once
  onUsage(agentId: string, raw: Record<string, unknown>): void;
  projectRoots?: () => string[];
}

// Plain replacement (no regex/$ patterns), so message text is inserted literally.
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), template);

export const isActive = (r: Run) => r.status === 'running' || r.status === 'queued' || r.status === 'awaiting';

export function createRunner(o: RunnerOptions): Runner {
  const live = new Map<number, RunHandle>();
  const before = new Map<number, { ref: string; untracked: string[] }>(); // direct-mode snapshots
  const findChat = (id: number) => db.chats.find(c => c.id === id);

  fs.mkdirSync(DIFF_DIR, { recursive: true });
  fs.mkdirSync(IMAGE_DIR, { recursive: true });

  // Anything that was working when the hub stopped cannot be continued. Steps awaiting approval can.
  for (const r of db.runs) if (r.status === 'running' || r.status === 'queued') { r.status = 'interrupted'; r.endedAt ??= Date.now(); }

  function addActivity(run: Run, icon: string, text: string) {
    run.activity.push({ at: Date.now(), icon, text: String(text).replace(/\s+/g, ' ').slice(0, 300) });
    if (run.activity.length > KEEP_ACTIVITY) run.activity.splice(0, run.activity.length - KEEP_ACTIVITY);
    changed();
  }

  function addImage(run: Run, img: { name: string; type: string; data: Buffer }) {
    const ext = IMAGE_EXT[img.type];
    if (!ext || !img.data.length || img.data.length > MAX_IMAGE_BYTES) return;
    run.images ??= [];
    if (run.images.length >= MAX_IMAGES_PER_RUN) return;
    const id = crypto.randomUUID().slice(0, 12);
    const file = path.join(IMAGE_DIR, `run-${run.id}-${id}.${ext}`);
    try { fs.writeFileSync(file, img.data); } catch { return; }
    const name = String(img.name || `image.${ext}`).replace(/[\u0000-\u001f]/g, '').slice(0, 120);
    run.images.push({ id, name, type: img.type, size: img.data.length, at: Date.now(), path: file });
    changed();
  }

  function fail(run: Run, message: string) {
    run.status = 'error';
    run.error = message;
    run.endedAt = Date.now();
    changed();
    pump();
  }

  function newRun(chat: Chat, agentId: string, prompt: string, source: RunSource, workflow?: Run['workflow']): Run {
    const run: Run = {
      id: db.nextRunId++, chatId: chat.id, agentId, model: chat.model || null, prompt, source, status: 'queued', createdAt: Date.now(),
      startedAt: null, endedAt: null, result: null, error: null, costUsd: null, tokensIn: null, tokensOut: null,
      sessionId: null, activity: [],
    };
    if (workflow) run.workflow = workflow;
    db.runs.push(run);
    chat.updatedAt = Date.now();
    changed();
    return run;
  }

  // Where a chat's agents work: its own branch folder, or the project folder.
  function workDir(chat: Chat, project: Project): string | null {
    if (chat.branch) return fs.existsSync(chat.branch.path) ? chat.branch.path : null;
    return project.path;
  }

  // After a successful workflow step, queue the next one with this step's reply (or wait for approval).
  function continueWorkflow(run: Run, chat: Chat) {
    const wf = run.workflow;
    if (!wf || run.status !== 'done') return;
    const workflow = o.workflows.get(wf.id);
    const next = workflow?.steps[wf.step + 1];
    if (!workflow || !next) return;
    let previous = run.result || '';
    if (previous.length > MAX_HANDOFF) previous = previous.slice(0, MAX_HANDOFF) + '\n\n[…the rest of the previous reply was cut off]';
    const nextRun = newRun(chat, next.agentId, fill(next.prompt, { input: wf.input, previous }), run.source,
      { ...wf, step: wf.step + 1, label: next.label });
    nextRun.handoff = previous;
    if (next.approve) {
      if (chat.autoApprove) addActivity(nextRun, '⚡', 'Auto-approved (Auto build is on)');
      else nextRun.status = 'awaiting';
    }
  }

  // Records what the run changed. Never throws: a git problem is shown on the run instead.
  async function recordChanges(run: Run, chat: Chat, project: Project, dir: string): Promise<void> {
    if (!project.git) return;
    const agentName = o.agents.get(run.agentId)?.name || run.agentId;
    const patchFile = path.join(DIFF_DIR, `run-${run.id}.patch`);
    let changes: RunChanges;
    try {
      if (chat.branch) {
        const commit = await checkpoint(dir, `Agent Hub: chat ${chat.id}, message ${run.id} (${agentName})\n\n${run.prompt.slice(0, 500)}`);
        if (!commit) return;
        const files = await changedFiles(dir, `${commit}~1`, commit);
        const { patch, truncated } = await diffText(dir, `${commit}~1`, commit);
        fs.writeFileSync(patchFile, patch);
        changes = { mode: 'branch', files, commit, patchFile, truncated };
      } else {
        const snap = before.get(run.id);
        before.delete(run.id);
        if (!snap) return;
        const files = await changedFiles(dir, snap.ref);
        const had = new Set(snap.untracked);
        const created = (await untrackedFiles(dir)).filter(f => !had.has(f));
        for (const f of created) files.push({ path: f, status: 'A', added: null, removed: null });
        if (!files.length) return;
        const { patch, truncated } = await diffText(dir, snap.ref);
        fs.writeFileSync(patchFile, patch);
        changes = { mode: 'direct', files, createdFiles: created, patchFile, truncated };
      }
    } catch (e) {
      changes = { mode: chat.branch ? 'branch' : 'direct', files: [], error: errorMessage(e) };
    }
    run.changes = changes;
  }

  async function finish(run: Run, chat: Chat, project: Project, dir: string, res: RunResult) {
    live.delete(run.id);
    // Keep the run 'running' until its changes are recorded, so the next message in this chat cannot start
    // (and edit files) in the middle of the checkpoint.
    await recordChanges(run, chat, project, dir);
    run.endedAt = Date.now();
    if (res.sessionId !== undefined) run.sessionId = res.sessionId;
    if (res.costUsd !== undefined) run.costUsd = res.costUsd;
    if (res.tokensIn !== undefined) run.tokensIn = res.tokensIn;
    if (res.tokensOut !== undefined) run.tokensOut = res.tokensOut;
    if (res.resolvedModel !== undefined) run.resolvedModel = res.resolvedModel;
    if (run.aborted) run.status = 'aborted';
    else if (run.timedOut) { run.status = 'error'; run.error = `Stopped after ${Math.round(o.limits().timeoutMs / 60000)} minutes (time limit).`; }
    else if (res.error) { run.status = 'error'; run.error = res.error; run.result = res.text || null; }
    else { run.status = 'done'; run.result = res.text ?? ''; }
    if (res.sessionLost) {
      delete chat.sessions[run.agentId];
      run.error = `${run.error || ''}\n\nThe saved session for this agent was missing, so its next message starts a fresh one.`.trim();
    }
    if (run.workflow && run.status !== 'done' && run.workflow.step + 1 < run.workflow.steps) {
      addActivity(run, '⏹', 'Workflow stopped here: later steps were not run.');
    }
    continueWorkflow(run, chat);
    chat.updatedAt = Date.now();
    changed();
    pump();
  }

  async function start(run: Run) {
    const chat = findChat(run.chatId);
    if (!chat) return fail(run, 'Chat not found.');
    const agent = o.agents.get(run.agentId);
    const project = o.projects.get(chat.projectId);
    if (!agent) return fail(run, `Agent "${run.agentId}" is no longer in config.yaml.`);
    if (!agent.available) return fail(run, agent.problem || 'This agent is not available.');
    if (!project || project.missing || !fs.existsSync(project.path)) return fail(run, 'Project folder not found.');
    const roots = o.projectRoots ? o.projectRoots() : [];
    if (project.source !== 'config' && roots.length && !insideRoots(project.path, roots)) {
      return fail(run, 'Project folder is outside the allowed project roots in config.yaml.');
    }
    const dir = workDir(chat, project);
    if (!dir) return fail(run, 'This chat\'s branch folder is missing. Start a new chat.');

    run.status = 'running';
    run.startedAt = Date.now();
    changed();

    if (project.git && !chat.branch) {
      try { before.set(run.id, await snapshot(dir)); } catch (e) { addActivity(run, '⚠️', `Could not snapshot the project, changes will not be listed: ${errorMessage(e)}`); }
    }

    // Agents that cannot resume their own sessions get this chat's earlier exchanges with them instead.
    const history = agent.resumable ? null : db.runs
      .filter(r => r.chatId === chat.id && r.agentId === agent.id && r.status === 'done' && r.id !== run.id)
      .slice(-10)
      .map(r => ({ prompt: r.prompt, result: r.result ?? '' }));

    const step = run.workflow ? o.workflows.get(run.workflow.id)?.steps[run.workflow.step] : undefined;
    // Chat setting "skip permissions". A workflow step with its own limits (e.g. read-only planning) keeps them.
    const stepLimited = !!(step?.overrides?.allowedTools || step?.overrides?.permissionMode);
    const skipPermissions = chat.skipPermissions === true && !stepLimited;
    if (skipPermissions) addActivity(run, '⚠️', 'Permissions skipped for this chat (--dangerously-skip-permissions)');
    else if (chat.skipPermissions && stepLimited) addActivity(run, '🔒', 'This workflow step keeps its own permission limits');

    let handle: RunHandle;
    try {
      handle = agent.start({
        prompt: run.prompt,
        cwd: dir,
        sessionId: chat.sessions[agent.id] || null,
        history,
        model: run.model || chat.model || null,
        overrides: step?.overrides,
        skipPermissions,
        extraDirs: db.uploads.some(u => u.chatId === chat.id) ? [o.uploadDir] : undefined,
        onActivity: (icon, text) => addActivity(run, icon, text),
        onSession: id => { chat.sessions[agent.id] = id; run.sessionId = id; changed(); },
        onUsage: raw => o.onUsage(agent.id, raw),
        onImage: img => addImage(run, img),
      });
    } catch (e) {
      handle = { abort() {}, done: Promise.resolve({ error: errorMessage(e) }) };
    }
    live.set(run.id, handle);

    const timer = setTimeout(() => { run.timedOut = true; handle.abort(); }, o.limits().timeoutMs);
    handle.done
      .catch((e: unknown): RunResult => ({ error: errorMessage(e) }))
      .then(res => { clearTimeout(timer); return finish(run, chat, project, dir, res); })
      .catch(e => { run.status = 'error'; run.error = errorMessage(e); changed(); pump(); });
  }

  function pump() {
    const runningNow = db.runs.filter(r => r.status === 'running');
    const busy = new Set(runningNow.map(r => r.chatId));
    let slots = o.limits().maxParallel - runningNow.length;
    for (const r of db.runs) {
      // A step waiting for approval holds its chat: later messages wait until it is approved or cancelled.
      if (r.status === 'awaiting') { busy.add(r.chatId); continue; }
      if (r.status !== 'queued' || busy.has(r.chatId)) continue;
      busy.add(r.chatId);
      if (slots <= 0) break;
      slots--;
      start(r).catch(e => fail(r, errorMessage(e)));
    }
  }

  function abortRun(run: Run): boolean {
    if (run.status === 'queued' || run.status === 'awaiting') {
      run.status = 'aborted'; run.endedAt = Date.now(); changed(); pump(); return true;
    }
    const handle = live.get(run.id);
    if (!handle) return false;
    run.aborted = true;
    handle.abort();
    return true;
  }

  function approve(run: Run, editedHandoff?: string): boolean {
    if (run.status !== 'awaiting' || !run.workflow) return false;
    if (typeof editedHandoff === 'string' && editedHandoff.trim() && editedHandoff !== run.handoff) {
      const step = o.workflows.get(run.workflow.id)?.steps[run.workflow.step];
      if (step) {
        run.handoff = editedHandoff;
        run.prompt = fill(step.prompt, { input: run.workflow.input, previous: editedHandoff });
        addActivity(run, '✏️', 'Plan edited before approval');
      }
    }
    run.status = 'queued';
    changed();
    pump();
    return true;
  }

  return {
    abortRun,
    abortChat: chat => db.runs.filter(r => r.chatId === chat.id && isActive(r)).filter(abortRun).length,
    abortAll: () => db.runs.filter(isActive).filter(abortRun).length,
    pump,
    approve,
    autoApproveWaiting(chat: Chat) {
      const waiting = db.runs.filter(r => r.chatId === chat.id && r.status === 'awaiting');
      let count = 0;
      for (const r of waiting) {
        addActivity(r, '⚡', 'Auto-approved (Auto build is on)');
        if (approve(r)) count++;
      }
      return count;
    },

    queue(chat, typed, source, attachments = []) {
      // Agents get uploaded files as absolute paths they can read (Claude also gets --add-dir for the uploads folder).
      const files = attachments.length
        ? `\n\nAttached files (saved on this PC; read them from these paths):\n${attachments
          .map(a => `- ${a.name} (${a.type || 'unknown type'}, ${formatSize(a.size)}): ${a.path}`).join('\n')}`
        : '';
      const input = (typed || 'Please look at the attached file(s).') + files;
      const workflow = chat.workflowId ? o.workflows.get(chat.workflowId) : undefined;
      let run: Run;
      if (workflow) {
        const first = workflow.steps[0];
        run = newRun(chat, first.agentId, fill(first.prompt, { input, previous: '' }), source,
          { id: workflow.id, step: 0, steps: workflow.steps.length, label: first.label, input });
      } else {
        run = newRun(chat, chat.agentId || '', input, source);
      }
      run.display = typed;
      if (attachments.length) run.attachments = attachments;
      changed();
      pump();
      return run;
    },
  };
}
