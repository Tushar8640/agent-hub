// Agent Hub web app (PWA). Compiled to web/public/app.js by `tsc -p web/tsconfig.json` (runs on `npm start`).
// Wrapped in a function so its names do not clash with sw.ts (both compile as plain scripts).
(() => {
  // ---------- types (match hub/index.ts responses) ----------
  type RunStatus = 'queued' | 'awaiting' | 'running' | 'done' | 'error' | 'aborted' | 'interrupted';
  interface ChangedFile { path: string; status: string; added: number | null; removed: number | null }
  interface RunChanges { mode: 'branch' | 'direct'; files: ChangedFile[]; commit: string | null; truncated: boolean; undone: boolean; error: string | null; hasDiff: boolean }
  interface Activity { at: number; icon: string; text: string }
  interface RunWorkflow { id: string; step: number; steps: number; label: string; input: string }
  interface FileInfo { id: string; name: string; size: number; type: string }
  interface Run {
    id: number; chatId: number; agentId: string; agentName: string; workflow?: RunWorkflow;
    prompt: string; display?: string; attachments?: FileInfo[]; source: string; status: RunStatus; createdAt: number;
    startedAt: number | null; endedAt: number | null; result: string | null; error: string | null;
    costUsd: number | null; activity: Activity[]; handoff?: string; changes: RunChanges | null;
  }
  interface AgentInfo {
    id: string; name: string; type: string; available: boolean; problem: string | null; resumable: boolean; fullAccess: boolean;
    usageSummary?: string | null;
  }
  interface WorkflowInfo {
    id: string; name: string; description: string; available: boolean; problem: string | null;
    steps: { agentId: string; agentName: string; label: string }[];
  }
  interface ProjectInfo { id: string; name: string; path: string; missing: boolean; git: boolean }
  interface ChatSummary {
    id: number; title: string; status: string; preview: { who: string; text: string } | null;
    kind: 'agent' | 'workflow'; workflowId: string | null; branch: { name: string; mergedAt: number | null } | null;
    agentId: string; agentName: string; projectId: string; projectName: string;
    runCount: number; costUsd: number; lastAt: number; createdAt: number;
  }
  interface HubState {
    now: number; name: string; maxParallel: number; branchByDefault: boolean; agents: AgentInfo[]; workflows: WorkflowInfo[]; projects: ProjectInfo[]; chats: ChatSummary[];
    stats: { running: number; queued: number; costToday: number | null };
  }
  interface ChatDetail { chat: ChatSummary; runs: Run[] }
  interface Me { authed: boolean; local: boolean; device: { id: string; name: string } | null; name: string; port: number }
  interface DeviceInfo { id: string; name: string; createdAt: number; lastSeenAt: number }
  interface PairLink { label: string; url: string; qr: string }
  type Route = { name: 'home' } | { name: 'chat'; id: number } | { name: 'new' } | { name: 'devices' } | { name: 'dashboard' } | { name: 'settings' };
  interface UsageWindow { key: string; label: string; utilization: number | null; resetsAt: number | null }
  interface PeriodStats { messages: number; done: number; errors: number; tokensIn: number; tokensOut: number; costUsd: number | null; avgSeconds: number | null }
  interface AgentDash extends AgentInfo {
    canProbe: boolean; probing: boolean;
    usage: { updatedAt: number; status: string | null; windows: UsageWindow[]; text?: string; source?: string } | null;
    running: number; chats: number; lastUsedAt: number | null; today: PeriodStats; week: PeriodStats;
  }
  interface ActiveRun { runId: number; chatId: number; chatTitle: string; status: string; agentName: string; startedAt: number | null; createdAt: number; step: string | null }
  interface Dashboard { now: number; agents: AgentDash[]; active: ActiveRun[]; limits: { maxParallel: number } }
  interface SettingsView {
    local: boolean;
    settings: { maxParallel: number; runTimeoutMinutes: number; branchByDefault: boolean };
    defaults: { maxParallel: number; runTimeoutMinutes: number; branchByDefault: boolean };
    hub: { name: string; port: number; host: string; publicUrl: string | null };
    agents: (AgentInfo & { permissionMode: string | null; allowedTools: string[] | null })[];
    workflows: (WorkflowInfo & { approvals: string[] })[];
    projects: ProjectInfo[];
  }

  // ---------- small helpers ----------
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  const coarse = matchMedia('(pointer: coarse)').matches;
  const wide = () => matchMedia('(min-width: 761px)').matches;
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  function listTime(t: number) {
    const d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return fmtTime(t);
    if (now.getTime() - d.getTime() < 6 * 864e5) return d.toLocaleDateString('en-AU', { weekday: 'short' });
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'numeric', year: '2-digit' });
  }
  function dayLabel(t: number) {
    const d = new Date(t), now = new Date(), y = new Date(now.getTime() - 864e5);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function dur(ms: number) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }
  const COLOURS = ['#8b5cf6', '#3b82f6', '#10b981', '#d97757', '#f59e0b', '#ec4899', '#14b8a6', '#6366f1'];
  function colourOf(key: string) { let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLOURS[h % COLOURS.length]; }
  const initial = (s: string) => (Array.from(String(s || '?').trim())[0] || '?').toUpperCase();
  const avatar = (key: string, label: string, size = '') =>
    `<div class="avatar ${size}" style="background:${colourOf(key)}">${esc(initial(label))}</div>`;
  const TYPE_LABEL: Record<string, string> = { 'claude-code': 'Claude Code CLI', antigravity: 'Antigravity CLI', cli: 'Command-line agent' };
  const FULL_ACCESS_NOTE = 'Full access: runs without permission checks';

  // Escape-first formatter: ``` code blocks, `inline code`, **bold**, # headings.
  const inline = (s: string) => esc(s)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  function md(s: string) {
    const parts = String(s ?? '').split('```');
    return parts.map((p, i) => i % 2
      ? `<div class="code"><button type="button" class="code-copy" data-copy-code>Copy</button><pre><code>${esc(p.replace(/^[\w+.#-]*\n/, '').replace(/\n$/, ''))}</code></pre></div>`
      : inline(parts.length > 1 ? p.replace(/^\n/, '').replace(/\n$/, '') : p)).join('');
  }

  const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const fileIcon = (type: string, name: string) =>
    /^image\//.test(type) ? '🖼' : /pdf$/i.test(type) || /\.pdf$/i.test(name) ? '📕' : /zip|compressed/.test(type) ? '🗜' : '📄';
  const chipsHtml = (files: FileInfo[]) =>
    `<div class="file-chips">${files.map(f => `<span class="file-chip">${fileIcon(f.type, f.name)} ${esc(f.name)} <small>${fmtSize(f.size)}</small></span>`).join('')}</div>`;

  // Copy text. navigator.clipboard only exists on HTTPS/localhost; on a phone over plain http (LAN) use the old
  // execCommand('copy') way, and as a last resort show the text so it can be copied by hand.
  async function copyText(text: string, button?: HTMLElement) {
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
    }
    if (!ok) { prompt('Copy this text:', text); return; }
    if (button) {
      const before = button.textContent;
      button.textContent = 'Copied ✓';
      setTimeout(() => { button.textContent = before; }, 1500);
    } else toast('Copied');
  }

  function toast(text: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  // ---------- API ----------
  class ApiError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
  async function getJSON<T>(url: string): Promise<T> {
    const r = await fetch(url, { cache: 'no-store' });
    if (r.status === 401) { onUnauthorized(); throw new ApiError(401, 'Not paired'); }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, (out as { error?: string }).error || `Failed (${r.status})`);
    return out as T;
  }
  async function post<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub': '1' }, body: JSON.stringify(body || {}) });
    if (r.status === 401) { onUnauthorized(); throw new ApiError(401, 'Not paired'); }
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, (out as { error?: string }).error || `Failed (${r.status})`);
    return out as T;
  }

  // ---------- state ----------
  let me: Me | null = null;
  let data: HubState | null = null;
  let current: ChatDetail | null = null;
  let route: Route = { name: 'home' };
  let lastThreadHtml = '';
  let clockSkew = 0;
  let firstLoad = true;
  let events: EventSource | null = null;
  // New chat: either one agent or one workflow, plus a project.
  const newChoice: { kind: 'agent' | 'workflow'; targetId: string | null; projectId: string | null; branch: boolean } =
    { kind: 'agent', targetId: null, projectId: null, branch: true };
  const openSteps = new Set<number>();
  const openPrompts = new Set<number>();
  let pairing: { expiresAt: number; links: PairLink[]; index: number } | null = null;
  let pairTimer: number | undefined;

  // ---------- gate screens ----------
  function showGate(html: string) {
    $('gate').innerHTML = `<div class="gate-card">${html}</div>`;
    $('gate').hidden = false;
    $('app').hidden = true;
  }
  function deviceGuess() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'Android phone';
    if (/iPhone|iPad/i.test(ua)) return 'iPhone';
    if (/Windows/i.test(ua)) return 'Windows PC';
    if (/Mac/i.test(ua)) return 'Mac';
    return 'My device';
  }
  function showPairForm(code: string) {
    showGate(`<div class="big">A</div><h2>Pair this device</h2>
      <p>This connects the device to Agent Hub on your PC. Only pair devices you own.</p>
      <label class="field"><span>Device name</span><input id="pair-name" maxlength="40" value="${esc(deviceGuess())}"></label>
      <button class="btn primary" id="pair-go" type="button">Pair this device</button>
      <p class="err" id="pair-err"></p>`);
    const go = $<HTMLButtonElement>('pair-go');
    go.onclick = async () => {
      go.disabled = true;
      $('pair-err').textContent = '';
      try {
        await post('/api/pair', { code, name: $<HTMLInputElement>('pair-name').value });
        history.replaceState(null, '', '/#/');
        location.reload();
      } catch (e) {
        $('pair-err').textContent = e instanceof Error ? e.message : 'Pairing failed.';
        go.disabled = false;
      }
    };
  }
  function showNotPaired() {
    const port = me?.port || 8650;
    showGate(`<div class="big">A</div><h2>This device is not paired</h2>
      <p>On your PC, open <code>http://localhost:${port}</code>, choose <b>Devices → Show pairing QR code</b>, and scan the code with this device's camera.</p>
      <button class="btn" type="button" onclick="location.reload()">Try again</button>`);
  }
  function onUnauthorized() {
    if (events) { events.close(); events = null; }
    if (me) me.authed = false;
    showNotPaired();
  }

  // ---------- sidebar ----------
  function renderList() {
    if (!data) return;
    const q = $<HTMLInputElement>('search').value.trim().toLowerCase();
    const list = data.chats.filter(c => !q
      || c.title.toLowerCase().includes(q)
      || c.agentName.toLowerCase().includes(q)
      || (c.preview?.text || '').toLowerCase().includes(q));
    if (!list.length) {
      $('chat-list').innerHTML = `<div class="list-empty">${q ? 'No chats match.' : 'No chats yet.<br>Tap + to start one.'}</div>`;
      return;
    }
    $('chat-list').innerHTML = list.map(c => {
      const open = route.name === 'chat' && route.id === c.id;
      const p = c.preview;
      let prev: string, cls = '';
      if (c.status === 'running') { prev = esc(p?.text || 'Working…'); cls = 'live'; }
      else if (c.status === 'queued') prev = 'Queued: ' + esc(p?.text || '');
      else if (!p) prev = 'No messages yet';
      else if (p.who === 'error') { prev = esc(p.text); cls = 'err'; }
      else prev = (p.who === 'you' ? 'You: ' : '') + esc(p.text);
      return `<a class="chat-item${open ? ' active' : ''}" href="#/chat/${c.id}">
        <div class="av-wrap">${avatar(c.agentId, c.agentName)}${c.status === 'running' ? '<span class="presence" title="Working"></span>' : ''}</div>
        <div class="ci-body">
          <div class="ci-top"><span class="ci-title">${esc(c.title)}</span><span class="ci-time">${listTime(c.lastAt)}</span>
            <button class="ci-del" type="button" data-delete-chat="${c.id}" title="Delete chat" aria-label="Delete chat">🗑</button></div>
          <div class="ci-bottom"><span class="ci-prev ${cls}">${prev}</span><span class="tag">${esc(c.agentName)}</span></div>
        </div></a>`;
    }).join('');
  }

  function renderFoot() {
    if (!data) return;
    const s = data.stats;
    $('hub-name').textContent = data.name;
    $('s-running').textContent = `${s.running}/${data.maxParallel}`;
    $('s-queued').textContent = String(s.queued);
    $('s-cost').textContent = s.costToday != null ? `USD ${s.costToday.toFixed(2)}` : '–';
    $('agent-pills').innerHTML = data.agents.map(a =>
      `<span class="agent-pill${a.available ? '' : ' off'}${a.fullAccess ? ' full' : ''}"
        title="${esc((a.available ? TYPE_LABEL[a.type] || a.type : a.problem || 'Not available') + (a.fullAccess ? ' · ' + FULL_ACCESS_NOTE : ''))}">${esc(a.name)}${a.fullAccess ? ' ⚠' : ''}</span>`).join('')
      + data.agents.filter(a => a.usageSummary).map(a =>
        `<a class="usage-line" href="#/dashboard" title="Open the dashboard"><b>${esc(a.name)}</b> ${esc(a.usageSummary)}</a>`).join('');
  }

  // ---------- chat screen ----------
  function renderHead() {
    const actions = $('head-actions');
    if (route.name === 'new') {
      $('head-main').innerHTML = `<div class="avatar md" style="background:linear-gradient(135deg,#8b5cf6,#3b82f6)">+</div>
        <div class="head-text"><div class="head-title">New chat</div><div class="head-sub">Pick an agent or a workflow and a project, then send your first message</div></div>`;
      actions.innerHTML = '';
      $('hint').textContent = coarse ? '' : 'Enter to send, Shift+Enter for a new line';
      return;
    }
    const c = current?.chat;
    if (!c) { $('head-main').innerHTML = ''; actions.innerHTML = ''; return; }
    const busy = c.status === 'running' || c.status === 'queued' || c.status === 'awaiting';
    const sub = c.status === 'running' ? `${c.agentName} is working…`
      : c.status === 'queued' ? 'Queued'
      : c.status === 'awaiting' ? 'Waiting for your approval'
      : `${c.agentName} · ${c.projectName} · ${c.runCount} message${c.runCount === 1 ? '' : 's'}${c.costUsd ? ` · USD ${c.costUsd.toFixed(2)}` : ''}`;
    const branchTag = c.branch
      ? `<span class="branch-tag" title="This chat works on its own git branch">⎇ ${esc(c.branch.name)}${c.branch.mergedAt ? ` · applied ${fmtTime(c.branch.mergedAt)}` : ''}</span>` : '';
    $('head-main').innerHTML = `${avatar(c.agentId, c.agentName, 'md')}
      <div class="head-text"><div class="head-title">${esc(c.title)}</div><div class="head-sub${c.status === 'running' ? ' live' : ''}">${esc(sub)} ${branchTag}</div></div>`;
    // Stop is always visible while working; everything else sits in the ⋯ menu (works the same on phone and PC).
    actions.innerHTML = `${busy ? '<button class="pill-btn danger stop-btn" data-act="abort">■ Stop</button>' : ''}
      ${c.branch && !busy ? '<button class="pill-btn primary wide-only" data-act="merge" title="Merge this chat\'s branch into the project">Apply to project</button>' : ''}
      <div class="menu-wrap">
        <button class="round-btn" data-act="menu" aria-label="Chat options" title="Chat options">⋯</button>
        <div class="menu" id="chat-menu" hidden>
          ${busy ? '<button data-act="abort">■ Stop</button>' : ''}
          ${c.branch && !busy ? '<button data-act="merge">⎇ Apply to project</button>' : ''}
          <button data-act="rename">✏️ Rename</button>
          <button data-act="reset" ${busy ? 'disabled' : ''}>🔄 Start fresh session</button>
          <button class="danger" data-act="delete">🗑 Delete chat</button>
        </div>
      </div>`;
    $('hint').textContent = c.status === 'awaiting' ? 'Approve or cancel the waiting step first; new messages wait until then.'
      : busy ? 'The agent is working. New messages wait their turn in this chat.'
      : (coarse ? '' : 'The agent remembers this chat · Enter to send, Shift+Enter for a new line');
  }

  function stepsHtml(r: Run) {
    const n = r.activity.length;
    if (!n) return { btn: '', list: '' };
    const open = openSteps.has(r.id);
    return {
      btn: `<button class="link" data-steps="${r.id}">${open ? 'Hide' : 'Show'} ${n} step${n === 1 ? '' : 's'}</button>`,
      list: open ? `<div class="steps">${r.activity.map(a => `<div><time>${fmtTime(a.at)}</time>${esc(a.icon)} ${esc(a.text)}</div>`).join('')}</div>` : '',
    };
  }

  function runHtml(r: Run) {
    const src = r.source === 'app' ? 'from phone' : 'from PC';
    const wf = r.workflow;
    const stepTag = wf ? `<span class="step-tag">Step ${wf.step + 1}/${wf.steps} · ${esc(wf.label)} · ${esc(r.agentName)}</span>` : '';
    let h: string;
    if (wf && wf.step > 0) {
      // Later workflow steps have no user message: show the hand-off instead.
      h = `<div class="handoff"><span>↓ Handed to <b>${esc(r.agentName)}</b> · ${esc(wf.label)}</span>
        <button class="link" data-show-prompt="${r.id}">What it was asked</button></div>`;
      if (openPrompts.has(r.id)) h += `<div class="steps">${esc(r.prompt)}</div>`;
    } else {
      const typed = r.display ?? (wf ? wf.input : r.prompt);
      const files = r.attachments || [];
      h = `${typed ? `<div class="row me"><div class="bubble me">${esc(typed)}</div></div>` : ''}
        ${files.length ? `<div class="row me">${chipsHtml(files)}</div>` : ''}
        <div class="meta me">${fmtTime(r.createdAt)} · ${src}${typed ? ` · <button class="link" data-copy="${r.id}:you">Copy</button>` : ''}</div>`;
    }
    const st = stepsHtml(r);
    const meta = (parts: string[]) => `<div class="meta bot">${[stepTag, ...parts].filter(Boolean).join(' · ')}</div>${st.list}`;
    const bot = (cls: string, inner: string) => `<div class="row bot">${avatar(r.agentId, r.agentName, 'sm')}<div class="bubble bot ${cls}">${inner}</div></div>`;
    const took = r.startedAt && r.endedAt ? dur(r.endedAt - r.startedAt) : '';
    const cost = r.costUsd != null ? `USD ${r.costUsd.toFixed(3)}` : '';
    if (r.status === 'awaiting') {
      h += approvalHtml(r);
    } else if (r.status === 'queued') {
      h += bot('muted', 'Waiting for its turn…') + meta([`<button class="link danger" data-abort-run="${r.id}">Cancel</button>`]);
    } else if (r.status === 'running') {
      const last = r.activity[r.activity.length - 1];
      h += `<div class="row bot">${avatar(r.agentId, r.agentName, 'sm')}<div class="bubble bot typing"><span class="dots"><i></i><i></i><i></i></span>
        <span class="live">${last ? esc(last.icon + ' ' + last.text) : 'Thinking…'}</span></div></div>`;
      h += meta([`<span data-since="${r.startedAt}">${dur(Date.now() + clockSkew - (r.startedAt || Date.now()))}</span>`, st.btn,
        `<button class="link danger" data-abort-run="${r.id}">Stop</button>`]);
    } else if (r.status === 'done') {
      h += bot('', md(r.result || '(no text reply)'))
        + meta([r.endedAt ? fmtTime(r.endedAt) : '', took, cost, `<button class="link" data-copy="${r.id}:result">Copy</button>`, st.btn]);
    } else if (r.status === 'aborted') {
      h += bot('muted', 'Stopped.') + meta([took, st.btn]);
    } else {
      const msg = r.error || (r.status === 'interrupted' ? 'Interrupted: the hub restarted while this was running. Send it again to retry.' : 'Failed.');
      h += bot('err', esc(msg)) + meta([took, cost, `<button class="link" data-copy="${r.id}:error">Copy</button>`, st.btn]);
    }
    if (r.changes) h += changesHtml(r);
    return h;
  }

  // ---- approval of a waiting workflow step ----
  const editingHandoff = new Set<number>();
  function approvalHtml(r: Run) {
    const label = esc(r.workflow?.label || 'next step');
    const editing = editingHandoff.has(r.id);
    return `<div class="approval">
      <div class="approval-title">⏸ Waiting for your approval: <b>${label}</b> with ${esc(r.agentName)}</div>
      <div class="muted small">${esc(r.agentName)} will get the reply above${editing ? ' as edited below' : ''}. Nothing has been changed yet.</div>
      ${editing ? `<textarea class="handoff-edit" id="handoff-${r.id}" rows="10">${esc(r.handoff || '')}</textarea>` : ''}
      <div class="approval-actions">
        <button class="btn primary" type="button" data-approve="${r.id}">${editing ? 'Save and ' : ''}${label}</button>
        ${editing ? '' : `<button class="btn" type="button" data-edit-handoff="${r.id}">Edit first</button>`}
        <button class="btn" type="button" data-abort-run="${r.id}">Cancel</button>
      </div></div>`;
  }

  // ---- what a run changed: file list, diff, undo ----
  const openDiffs = new Set<number>();
  const diffCache = new Map<number, string>();
  const STATUS_LABEL: Record<string, string> = { A: 'added', M: 'changed', D: 'deleted', T: 'type changed' };
  function changesHtml(r: Run) {
    const ch = r.changes as RunChanges;
    if (ch.error) return `<div class="changes muted">⚠ Could not list the changed files: ${esc(ch.error)}</div>`;
    if (!ch.files.length) return '';
    const added = ch.files.reduce((s, f) => s + (f.added || 0), 0);
    const removed = ch.files.reduce((s, f) => s + (f.removed || 0), 0);
    const open = openDiffs.has(r.id);
    const where = ch.mode === 'branch' ? 'on this chat\'s branch' : 'in the project';
    let h = `<div class="changes${ch.undone ? ' undone' : ''}">
      <span>📝 ${ch.files.length} file${ch.files.length === 1 ? '' : 's'} changed ${where} <b class="plus">+${added}</b> <b class="minus">−${removed}</b></span>
      <button class="link" data-diff="${r.id}">${open ? 'Hide changes' : 'View changes'}</button>
      ${ch.undone ? '<span class="undone-tag">↩ undone</span>' : `<button class="link danger" data-undo="${r.id}">Undo</button>`}
    </div>`;
    if (open) {
      h += `<div class="diff-box"><div class="diff-files">${ch.files.map(f => `<div><span class="fs fs-${esc(f.status)}">${esc(STATUS_LABEL[f.status] || f.status)}</span>
        <span class="mono">${esc(f.path)}</span>${f.added != null ? ` <b class="plus">+${f.added}</b> <b class="minus">−${f.removed}</b>` : ''}</div>`).join('')}</div>
        ${ch.hasDiff ? (diffCache.has(r.id) ? diffHtml(diffCache.get(r.id) as string, ch.truncated) : '<div class="muted small">Loading…</div>') : ''}</div>`;
    }
    return h;
  }
  function diffHtml(patch: string, truncated: boolean) {
    if (!patch.trim()) return '<div class="muted small">Only new files (their content is not shown here).</div>';
    const lines = patch.split('\n').map(l => {
      const cls = l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') ? 'dh'
        : l.startsWith('@@') ? 'dhunk' : l.startsWith('+') ? 'dadd' : l.startsWith('-') ? 'ddel' : '';
      return `<span class="${cls}">${esc(l)}</span>`;
    }).join('\n');
    return `<div class="code"><button type="button" class="code-copy" data-copy-code>Copy</button><pre class="diff">${lines}</pre></div>
      ${truncated ? '<div class="muted small">The diff was too long and is cut off here.</div>' : ''}`;
  }
  async function loadDiff(id: number) {
    try {
      const r = await fetch(`/api/runs/${id}/diff`, { cache: 'no-store' });
      if (r.status === 401) return onUnauthorized();
      diffCache.set(id, r.ok ? await r.text() : '');
    } catch { diffCache.set(id, ''); }
    renderThread(false);
  }

  function pickerHtml() {
    const agents = data?.agents || [];
    const workflows = data?.workflows || [];
    const projects = data?.projects || [];
    const valid = newChoice.kind === 'agent'
      ? agents.some(a => a.id === newChoice.targetId && a.available)
      : workflows.some(w => w.id === newChoice.targetId && w.available);
    if (!valid) {
      const a = agents.find(x => x.available);
      if (a) { newChoice.kind = 'agent'; newChoice.targetId = a.id; }
      else { const w = workflows.find(x => x.available); newChoice.kind = 'workflow'; newChoice.targetId = w ? w.id : null; }
    }
    if (!projects.some(p => p.id === newChoice.projectId && !p.missing)) newChoice.projectId = projects.find(p => !p.missing)?.id || null;
    const isOn = (kind: string, id: string) => newChoice.kind === kind && newChoice.targetId === id;
    const agentCards = agents.map(a => `<button type="button" class="pick${isOn('agent', a.id) ? ' on' : ''}" data-pick-agent="${esc(a.id)}"
        ${a.available ? '' : 'disabled'} title="${esc(a.problem || (a.fullAccess ? FULL_ACCESS_NOTE : ''))}">${avatar(a.id, a.name, 'sm')}
        <span><b>${esc(a.name)}${a.fullAccess ? ' <em class="warn">full access</em>' : ''}</b><small>${esc(a.available ? (TYPE_LABEL[a.type] || a.type) : 'Not available: ' + (a.problem || ''))}</small></span></button>`).join('');
    const workflowCards = workflows.map(w => `<button type="button" class="pick wide${isOn('workflow', w.id) ? ' on' : ''}" data-pick-workflow="${esc(w.id)}"
        ${w.available ? '' : 'disabled'} title="${esc(w.problem || w.description)}">${avatar('wf:' + w.id, w.name, 'sm')}
        <span><b>${esc(w.name)}</b><small>${esc(w.available ? w.steps.map(s => `${s.label} (${s.agentName})`).join(' → ') : w.problem || '')}</small></span></button>`).join('');
    const projectCards = projects.map(p => `<button type="button" class="pick${p.id === newChoice.projectId ? ' on' : ''}" data-pick-project="${esc(p.id)}"
        ${p.missing ? 'disabled' : ''}><span><b>${esc(p.name)}</b><small class="mono">${esc(p.missing ? 'Folder not found: ' + p.path : p.path)}</small></span></button>`).join('');
    const chosen = projects.find(p => p.id === newChoice.projectId);
    const branchOption = chosen?.git ? `<label class="branch-opt"><input type="checkbox" id="opt-branch" ${newChoice.branch ? 'checked' : ''}>
        <span><b>Work on its own branch</b><small>Recommended when several agents work at once. Changes stay on the branch until you press
        "Apply to project". Without it, agents change the project folder directly.</small></span></label>`
      : chosen ? '<p class="muted small">This project is not a git repository, so changes cannot be listed or undone.</p>' : '';
    return `<div class="picker">
      <div class="pick-label">Agent</div>
      <div class="pick-grid">${agentCards || '<p class="muted">No agents yet. Add one to config.yaml on the PC.</p>'}</div>
      ${workflowCards ? `<div class="pick-label">Workflow <span class="muted small">(several agents in turn)</span></div><div class="pick-grid">${workflowCards}</div>` : ''}
      <div class="pick-label">Project</div>
      <div class="pick-grid">${projectCards || '<p class="muted">No projects yet. Add one to config.yaml on the PC.</p>'}</div>
      ${branchOption}
      <p class="muted small">Agents and projects are set in <code>config.yaml</code> on the PC. Restart the hub after changing it.</p>
    </div>`;
  }

  function renderThread(forceBottom: boolean) {
    const el = $('thread');
    let html = '';
    if (route.name === 'new') {
      html = pickerHtml();
    } else if (current) {
      if (!current.runs.length) html = `<div class="intro">No messages yet. Say something to start.</div>`;
      let lastDay = '';
      for (const r of current.runs) {
        const day = new Date(r.createdAt).toDateString();
        if (day !== lastDay) { html += `<div class="day">${dayLabel(r.createdAt)}</div>`; lastDay = day; }
        html += runHtml(r);
      }
    }
    if (html === lastThreadHtml && !forceBottom) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (html !== lastThreadHtml) {
      // Keep what the user is typing in a plan editor when the thread re-renders.
      const typing = new Map<string, string>();
      el.querySelectorAll<HTMLTextAreaElement>('textarea.handoff-edit').forEach(t => typing.set(t.id, t.value));
      el.innerHTML = html;
      lastThreadHtml = html;
      typing.forEach((v, id) => { const t = document.getElementById(id) as HTMLTextAreaElement | null; if (t) t.value = v; });
    }
    if (route.name !== 'new' && (forceBottom || nearBottom)) el.scrollTop = el.scrollHeight;
  }

  async function loadChat(scrollToEnd: boolean) {
    if (route.name !== 'chat') return;
    const id = route.id;
    try {
      const detail = await getJSON<ChatDetail>(`/api/chats/${id}`);
      if (route.name !== 'chat' || route.id !== id) return;
      current = detail;
      renderHead();
      renderThread(scrollToEnd);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && route.name === 'chat' && route.id === id) {
        current = null;
        renderHead();
        $('thread').innerHTML = `<div class="intro">This chat no longer exists. <a class="link" href="#/">Back to chats</a></div>`;
        lastThreadHtml = '';
      }
    }
  }

  // ---------- devices screen (PC only) ----------
  async function loadDevices() {
    try {
      const { devices } = await getJSON<{ devices: DeviceInfo[] }>('/api/devices');
      $('device-list').innerHTML = devices.length ? devices.map(d => `<div class="device-row">
          <div class="grow"><b>${esc(d.name)}</b><div class="small muted">Paired ${listTime(d.createdAt)} · last seen ${listTime(d.lastSeenAt)} ${fmtTime(d.lastSeenAt)}</div></div>
          <button class="pill-btn danger" data-revoke="${esc(d.id)}" type="button">Remove</button></div>`).join('')
        : '<p class="muted">No devices paired yet.</p>';
    } catch (e) {
      $('device-list').innerHTML = `<p class="muted">${esc(e instanceof Error ? e.message : 'Could not load devices.')}</p>`;
    }
  }

  function renderPairBox() {
    const box = $('pair-box');
    if (!pairing) { box.innerHTML = ''; return; }
    const left = pairing.expiresAt - Date.now();
    if (left <= 0) { box.innerHTML = '<p class="muted">This code has expired. Show a new one.</p>'; stopPairTimer(); return; }
    if (!pairing.links.length) { box.innerHTML = '<p class="muted">No network address found. Connect this PC to Wi-Fi or Tailscale, or set publicUrl in config.yaml.</p>'; return; }
    const link = pairing.links[pairing.index] || pairing.links[0];
    const select = pairing.links.length > 1
      ? `<select id="pair-which">${pairing.links.map((l, i) => `<option value="${i}" ${i === pairing!.index ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}</select>`
      : `<div class="small">${esc(link.label)}</div>`;
    box.innerHTML = `<div class="qr-box">${select}<img src="${link.qr}" alt="Pairing QR code">
      <div class="qr-url">${esc(link.url)}</div><div class="small">Expires in <b id="pair-left">${dur(left)}</b></div></div>`;
    const sel = document.getElementById('pair-which') as HTMLSelectElement | null;
    if (sel) sel.onchange = () => { if (pairing) { pairing.index = Number(sel.value); renderPairBox(); } };
  }
  function stopPairTimer() { if (pairTimer) { clearInterval(pairTimer); pairTimer = undefined; } }

  $('pair-new').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('pair-new');
    btn.disabled = true;
    try {
      const res = await post<{ expiresAt: number; links: PairLink[] }>('/api/pairing');
      pairing = { ...res, expiresAt: res.expiresAt - clockSkew, index: 0 };
      renderPairBox();
      stopPairTimer();
      pairTimer = window.setInterval(() => {
        if (!pairing) return stopPairTimer();
        const left = pairing.expiresAt - Date.now();
        const el = document.getElementById('pair-left');
        if (left <= 0) renderPairBox(); else if (el) el.textContent = dur(left);
      }, 1000);
    } catch (e) {
      $('pair-box').innerHTML = `<p class="muted">${esc(e instanceof Error ? e.message : 'Could not create a pairing code.')}</p>`;
    } finally { btn.disabled = false; }
  });

  $('device-list').addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-revoke]');
    if (!b || !confirm('Remove this device? It will need to be paired again.')) return;
    b.disabled = true;
    await post(`/api/devices/${b.dataset.revoke}/revoke`).catch(() => {});
    loadDevices();
  });

  // ---------- dashboard ----------
  let dash: Dashboard | null = null;
  const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n));
  function resetText(t: number) {
    const left = t - (Date.now() + clockSkew);
    const when = new Date(t).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    return left > 0 ? `resets in ${dur(left)} · ${when}` : `reset ${when}`;
  }
  function meterHtml(w: UsageWindow) {
    const pct = w.utilization == null ? null : Math.round(w.utilization * 100);
    const cls = pct == null ? '' : pct >= 85 ? 'high' : pct >= 60 ? 'mid' : '';
    return `<div class="meter-row"><span class="name">${esc(w.label)}</span>
      <div class="meter"><div class="${cls}" style="width:${Math.min(100, pct ?? 0)}%"></div></div>
      <span class="pct">${pct == null ? '–' : pct + '%'}</span></div>
      ${w.resetsAt ? `<div class="reset-line">${esc(resetText(w.resetsAt))}</div>` : ''}`;
  }
  function statRow(label: string, s: PeriodStats) {
    return `<tr><th>${label}</th><td>${s.messages}</td><td>${s.errors ? `<span class="err-text">${s.errors}</span>` : '0'}</td>
      <td>${s.tokensIn || s.tokensOut ? `${fmtNum(s.tokensIn)} / ${fmtNum(s.tokensOut)}` : '–'}</td>
      <td>${s.costUsd != null ? `USD ${s.costUsd.toFixed(2)}` : '–'}</td><td>${s.avgSeconds != null ? dur(s.avgSeconds * 1000) : '–'}</td></tr>`;
  }
  function renderDashboard() {
    if (!dash) return;
    const d = dash;
    const running = d.active.filter(a => a.status === 'running').length;
    const cards = d.agents.map(a => {
      let usage: string;
      if (a.usage && a.usage.text) {
        // The agent's own report (e.g. Antigravity /usage), shown exactly as it came.
        usage = `<pre class="usage-text">${esc(a.usage.text)}</pre>
          <div class="small muted">From <code>${esc(a.usage.source || 'the agent')}</code> · updated ${listTime(a.usage.updatedAt)} ${fmtTime(a.usage.updatedAt)}</div>`;
      } else if (a.usage && a.usage.windows.length) {
        usage = a.usage.windows.map(meterHtml).join('')
          + `<div class="small muted">${a.usage.status ? `Status: ${esc(a.usage.status)} · ` : ''}updated ${listTime(a.usage.updatedAt)} ${fmtTime(a.usage.updatedAt)}</div>`;
      } else if (a.canProbe) {
        usage = a.type === 'antigravity'
          ? '<div class="small muted">Press "Check now" to run Antigravity\'s <code>/usage</code> and show its plan here.</div>'
          : '<div class="small muted">No usage data yet. It arrives with the next message, or press "Check now".</div>';
      } else {
        usage = `<div class="small muted">${a.type === 'antigravity' ? 'The Antigravity CLI does not report plan limits.' : 'This agent does not report plan limits.'}
          The numbers below come from the hub's own records.</div>`;
      }
      return `<div class="card agent-dash">
        <div class="ad-head">${avatar(a.id, a.name, 'md')}<div class="grow"><b>${esc(a.name)}</b>
          <div class="small muted">${esc(TYPE_LABEL[a.type] || a.type)}${a.available ? '' : ' · <span class="err-text">not available</span>'}${a.fullAccess ? ' · <span class="warn">full access</span>' : ''}</div></div>
          ${a.running ? `<span class="live-badge">● ${a.running} working</span>` : ''}</div>
        <div class="ad-usage"><div class="ad-title">Plan usage limits ${a.canProbe ? `<button class="pill-btn" type="button" data-probe="${esc(a.id)}" ${a.probing ? 'disabled' : ''}>${a.probing ? 'Checking…' : 'Check now'}</button>` : ''}</div>${usage}</div>
        <table class="ad-stats"><thead><tr><th></th><th>Messages</th><th>Errors</th><th>Tokens in / out</th><th>Cost</th><th>Avg time</th></tr></thead>
          <tbody>${statRow('Today', a.today)}${statRow('7 days', a.week)}</tbody></table>
        <div class="small muted">Saved sessions in ${a.chats} chat${a.chats === 1 ? '' : 's'}${a.lastUsedAt ? ` · last used ${listTime(a.lastUsedAt)} ${fmtTime(a.lastUsedAt)}` : ''}</div>
      </div>`;
    }).join('');
    const active = d.active.length ? d.active.map(r => `<div class="active-row">
        <span class="status-pill s-${esc(r.status)}">${esc(r.status === 'awaiting' ? 'needs approval' : r.status)}</span>
        <a class="grow" href="#/chat/${r.chatId}"><b>${esc(r.chatTitle)}</b><div class="small muted">${esc(r.agentName)}${r.step ? ' · ' + esc(r.step) : ''}
          ${r.startedAt && r.status === 'running' ? ` · <span data-since="${r.startedAt}">${dur(Date.now() + clockSkew - r.startedAt)}</span>` : ''}</div></a>
        <button class="pill-btn danger" type="button" data-abort-run="${r.runId}">${r.status === 'running' ? 'Stop' : 'Cancel'}</button></div>`).join('')
      : '<p class="muted">Nothing is running.</p>';
    $('dash-body').innerHTML = `
      <div class="card"><h3>Now</h3>
        <div class="kpis"><div><b>${running}/${d.limits.maxParallel}</b><span>working</span></div>
          <div><b>${d.active.filter(a => a.status === 'queued').length}</b><span>queued</span></div>
          <div><b>${d.active.filter(a => a.status === 'awaiting').length}</b><span>need approval</span></div></div>
        ${active}</div>
      ${cards || '<p class="muted">No agents configured.</p>'}`;
    $<HTMLButtonElement>('stop-all').disabled = !d.active.length;
  }
  async function loadDashboard() {
    try { dash = await getJSON<Dashboard>('/api/dashboard'); clockSkew = dash.now - Date.now(); renderDashboard(); }
    catch (e) { $('dash-body').innerHTML = `<p class="muted">${esc(e instanceof Error ? e.message : 'Could not load the dashboard.')}</p>`; }
  }
  $('dash-body').addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    const probe = t.closest<HTMLButtonElement>('[data-probe]');
    if (probe) {
      probe.disabled = true; probe.textContent = 'Checking…';
      try { await post(`/api/usage/${probe.dataset.probe}/refresh`); } catch (err) { toast(err instanceof Error ? err.message : 'Check failed'); }
      loadDashboard();
      return;
    }
    const ab = t.closest<HTMLButtonElement>('[data-abort-run]');
    if (ab) { ab.disabled = true; ab.textContent = 'Stopping…'; await post(`/api/runs/${ab.dataset.abortRun}/abort`).catch(() => {}); loadDashboard(); }
  });
  $('stop-all').addEventListener('click', async () => {
    if (!confirm('Stop everything that is running, queued or waiting for approval?')) return;
    const r = await post<{ stopped: number }>('/api/stop-all').catch(() => null);
    toast(r ? `Stopping ${r.stopped} message${r.stopped === 1 ? '' : 's'}` : 'Could not stop');
    loadDashboard();
  });

  // ---------- settings ----------
  async function loadSettings() {
    let s: SettingsView;
    try { s = await getJSON<SettingsView>('/api/settings'); }
    catch (e) { $('settings-body').innerHTML = `<p class="muted">${esc(e instanceof Error ? e.message : 'Could not load settings.')}</p>`; return; }
    const agentRows = s.agents.map(a => `<div class="set-row"><div class="grow"><b>${esc(a.name)}</b>
        <span class="small muted"> · ${esc(TYPE_LABEL[a.type] || a.type)}${a.available ? '' : ' · <span class="err-text">' + esc(a.problem || 'not available') + '</span>'}</span>
        <div class="small muted">${a.fullAccess ? '<span class="warn">full access</span> — runs without permission checks'
          : a.permissionMode || a.allowedTools ? `Permissions: ${esc(a.permissionMode || 'default')}${a.allowedTools ? ' · ' + esc(a.allowedTools.join(', ')) : ''}` : 'Uses its own defaults'}</div></div></div>`).join('');
    const wfRows = s.workflows.map(w => `<div class="set-row"><div class="grow"><b>${esc(w.name)}</b>
        <div class="small muted">${esc(w.steps.map(x => `${x.label} (${x.agentName})`).join(' → '))}${w.approvals.length ? ' · asks approval before ' + esc(w.approvals.join(', ')) : ''}</div></div></div>`).join('');
    const projRows = s.projects.map(p => `<div class="set-row"><div class="grow"><b>${esc(p.name)}</b>
        <div class="small muted mono">${esc(p.path)}</div><div class="small muted">${p.missing ? '<span class="err-text">folder not found</span>' : p.git ? 'git repository: branches, change lists and undo available' : 'not a git repository'}</div></div></div>`).join('');
    $('settings-body').innerHTML = `
      <form class="card" id="settings-form"><h3>Running agents</h3>
        <label class="set-field"><span><b>Chats working at the same time</b><small>Extra messages wait in a queue. Default ${s.defaults.maxParallel}.</small></span>
          <input type="number" name="maxParallel" min="1" max="10" value="${s.settings.maxParallel}"></label>
        <label class="set-field"><span><b>Time limit per message (minutes)</b><small>A message still running after this is stopped. Default ${s.defaults.runTimeoutMinutes}.</small></span>
          <input type="number" name="runTimeoutMinutes" min="1" max="240" value="${s.settings.runTimeoutMinutes}"></label>
        <label class="set-field"><span><b>New chats work on their own branch</b><small>Default for git projects; can be changed per chat.</small></span>
          <input type="checkbox" name="branchByDefault" ${s.settings.branchByDefault ? 'checked' : ''}></label>
        <div class="approval-actions"><button class="btn primary" type="submit">Save</button>
          <button class="btn" type="button" id="settings-reset">Use config.yaml defaults</button><span class="small muted" id="settings-msg"></span></div>
      </form>
      <div class="card"><h3>Agents</h3>${agentRows || '<p class="muted">None</p>'}</div>
      <div class="card"><h3>Workflows</h3>${wfRows || '<p class="muted">None</p>'}</div>
      <div class="card"><h3>Projects</h3>${projRows || '<p class="muted">None</p>'}</div>
      <div class="card"><h3>Hub</h3>
        <div class="small muted">${esc(s.hub.name)} · port ${s.hub.port} · ${s.hub.host === '127.0.0.1' ? 'this PC only' : 'reachable on your network (paired devices only)'}${s.hub.publicUrl ? ' · ' + esc(s.hub.publicUrl) : ''}</div>
        <p class="small muted">Agents, workflows, projects and agent permissions are set in <code>config.yaml</code> on the PC, then the hub is restarted. They cannot be changed from the app.</p>
        <div class="approval-actions"><button class="btn" type="button" id="hub-restart">Restart hub</button>
          ${s.local ? '<a class="btn" href="#/devices">Paired devices</a>' : ''}</div>
      </div>`;
    const form = $<HTMLFormElement>('settings-form');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = new FormData(form);
      try {
        await post('/api/settings', {
          maxParallel: Number(f.get('maxParallel')),
          runTimeoutMinutes: Number(f.get('runTimeoutMinutes')),
          branchByDefault: f.get('branchByDefault') === 'on',
        });
        $('settings-msg').textContent = 'Saved ✓';
        refresh();
      } catch (err) { $('settings-msg').textContent = err instanceof Error ? err.message : 'Could not save'; }
    });
    $('settings-reset').addEventListener('click', async () => { await post('/api/settings', { reset: true }).catch(() => {}); loadSettings(); refresh(); });
    $('hub-restart').addEventListener('click', async () => {
      if (!confirm('Restart the hub? It is back in about 20 seconds. This works when the hub was started with scripts\\start.bat or autostart.')) return;
      try { await post('/api/hub/restart'); toast('Restarting… reconnecting in about 20 seconds'); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not restart.'); }
    });
  }

  // ---------- routing: #/  #/chat/<id>  #/new  #/devices  #/dashboard  #/settings ----------
  function parseRoute(): Route {
    const h = location.hash;
    const m = h.match(/^#\/chat\/(\d+)$/);
    if (m) return { name: 'chat', id: Number(m[1]) };
    if (h === '#/new') return { name: 'new' };
    if (h === '#/dashboard') return { name: 'dashboard' };
    if (h === '#/settings') return { name: 'settings' };
    if (h === '#/devices' && me?.local) return { name: 'devices' };
    return { name: 'home' };
  }
  function applyRoute() {
    route = parseRoute();
    document.body.dataset.route = route.name;
    $('screen-home').hidden = route.name !== 'home';
    $('screen-chat').hidden = route.name !== 'chat' && route.name !== 'new';
    $('screen-devices').hidden = route.name !== 'devices';
    $('screen-dashboard').hidden = route.name !== 'dashboard';
    $('screen-settings').hidden = route.name !== 'settings';
    document.querySelectorAll<HTMLElement>('[data-nav]').forEach(n => n.classList.toggle('on', n.dataset.nav === route.name));
    if (route.name === 'dashboard') loadDashboard();
    if (route.name === 'settings') loadSettings();
    if (route.name === 'new') newChoice.branch = data?.branchByDefault ?? true;
    current = null;
    lastThreadHtml = '';
    $('form-error').textContent = '';
    if (route.name !== 'devices') { stopPairTimer(); pairing = null; renderPairBox(); }
    pending = []; renderPending(); // attachments belong to the screen they were added on
    if (route.name === 'chat' || route.name === 'new') {
      $('thread').innerHTML = '';
      renderHead();
      if (route.name === 'new') renderThread(true); else loadChat(true);
      if (!coarse) setTimeout(() => $('input').focus(), 30);
    }
    if (route.name === 'devices') loadDevices();
    renderList();
  }
  window.addEventListener('hashchange', applyRoute);

  // ---------- data loading (the hub pushes "changed" over SSE) ----------
  async function loadState() {
    data = await getJSON<HubState>('/api/state');
    clockSkew = data.now - Date.now();
    renderList();
    renderFoot();
    if (route.name === 'new') renderThread(false);
    if (firstLoad) {
      firstLoad = false;
      if (route.name === 'home' && wide() && data.chats.length) location.replace(`#/chat/${data.chats[0].id}`);
    }
  }
  let busyLoading = false, loadAgain = false;
  async function refresh() {
    if (busyLoading) { loadAgain = true; return; }
    busyLoading = true;
    try {
      await loadState();
      await loadChat(false);
      if (route.name === 'devices') await loadDevices();
      if (route.name === 'dashboard') await loadDashboard();
    } catch {}
    finally {
      busyLoading = false;
      if (loadAgain) { loadAgain = false; refresh(); }
    }
  }
  function connect() {
    events = new EventSource('/api/events');
    events.onopen = () => { $('dot').className = 'dot on'; $('conn').textContent = 'Online'; $('conn-wrap').title = 'Online'; refresh(); };
    events.addEventListener('changed', () => refresh());
    events.onerror = () => { $('dot').className = 'dot off'; $('conn').textContent = 'Offline'; $('conn-wrap').title = 'Offline: cannot reach the hub'; };
  }

  // ---------- events ----------
  $('search').addEventListener('input', renderList);

  $('screen-chat').addEventListener('click', async e => {
    const target = e.target as HTMLElement;
    const pickA = target.closest<HTMLElement>('[data-pick-agent]');
    if (pickA) { newChoice.kind = 'agent'; newChoice.targetId = pickA.dataset.pickAgent || null; renderThread(false); return; }
    const pickW = target.closest<HTMLElement>('[data-pick-workflow]');
    if (pickW) { newChoice.kind = 'workflow'; newChoice.targetId = pickW.dataset.pickWorkflow || null; renderThread(false); return; }
    const showPrompt = target.closest<HTMLElement>('[data-show-prompt]');
    if (showPrompt) {
      const id = Number(showPrompt.dataset.showPrompt);
      if (openPrompts.has(id)) openPrompts.delete(id); else openPrompts.add(id);
      renderThread(false);
      return;
    }
    const pickP = target.closest<HTMLElement>('[data-pick-project]');
    if (pickP) { newChoice.projectId = pickP.dataset.pickProject || null; renderThread(false); return; }
    const steps = target.closest<HTMLElement>('[data-steps]');
    if (steps) {
      const id = Number(steps.dataset.steps);
      if (openSteps.has(id)) openSteps.delete(id); else openSteps.add(id);
      renderThread(false);
      return;
    }
    const optBranch = target.closest<HTMLInputElement>('#opt-branch');
    if (optBranch) { newChoice.branch = optBranch.checked; return; }
    const approveBtn = target.closest<HTMLButtonElement>('[data-approve]');
    if (approveBtn) {
      const id = Number(approveBtn.dataset.approve);
      const edited = document.getElementById(`handoff-${id}`) as HTMLTextAreaElement | null;
      approveBtn.disabled = true;
      try { await post(`/api/runs/${id}/approve`, edited ? { handoff: edited.value } : {}); editingHandoff.delete(id); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not approve.'); approveBtn.disabled = false; }
      refresh();
      return;
    }
    const editBtn = target.closest<HTMLElement>('[data-edit-handoff]');
    if (editBtn) { editingHandoff.add(Number(editBtn.dataset.editHandoff)); renderThread(false); return; }
    const diffBtn = target.closest<HTMLElement>('[data-diff]');
    if (diffBtn) {
      const id = Number(diffBtn.dataset.diff);
      if (openDiffs.has(id)) openDiffs.delete(id);
      else { openDiffs.add(id); if (!diffCache.has(id)) loadDiff(id); }
      renderThread(false);
      return;
    }
    const undoBtn = target.closest<HTMLButtonElement>('[data-undo]');
    if (undoBtn) {
      if (!confirm('Undo the file changes made by this message? Later changes to the same lines can block this.')) return;
      undoBtn.disabled = true;
      try { await post(`/api/runs/${undoBtn.dataset.undo}/undo`); toast('Changes undone'); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not undo.'); }
      refresh();
      return;
    }
    const codeCopy = target.closest<HTMLElement>('[data-copy-code]');
    if (codeCopy) {
      const pre = codeCopy.parentElement?.querySelector('pre');
      if (pre) copyText(pre.textContent || '', codeCopy);
      return;
    }
    const copy = target.closest<HTMLElement>('[data-copy]');
    if (copy) {
      const [id, what] = String(copy.dataset.copy).split(':');
      const run = current?.runs.find(r => r.id === Number(id));
      if (run) {
        const text = what === 'you' ? (run.display ?? run.workflow?.input ?? run.prompt)
          : what === 'error' ? (run.error || '') : (run.result || '');
        copyText(text, copy);
      }
      return;
    }
    const ab = target.closest<HTMLButtonElement>('[data-abort-run]');
    if (ab) { ab.disabled = true; ab.textContent = 'Stopping…'; await post(`/api/runs/${ab.dataset.abortRun}/abort`).catch(() => {}); return; }
    const act = target.closest<HTMLButtonElement>('[data-act]');
    if (!act || route.name !== 'chat' || !current) return;
    const id = current.chat.id;
    if (act.dataset.act === 'menu') { const m = document.getElementById('chat-menu'); if (m) m.hidden = !m.hidden; return; }
    const menu = document.getElementById('chat-menu');
    if (menu) menu.hidden = true;
    if (act.dataset.act === 'abort') {
      act.disabled = true;
      act.textContent = 'Stopping…';
      await post(`/api/chats/${id}/abort`).catch(() => {});
      refresh();
    }
    else if (act.dataset.act === 'reset') {
      if (!confirm('Start a fresh session? The agents forget the earlier messages of this chat (they stay visible here). Useful when a chat gets long or confused.')) return;
      try { await post(`/api/chats/${id}/reset-session`); toast('Next message starts a fresh session'); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not reset.'); }
    }
    else if (act.dataset.act === 'merge') {
      if (!confirm('Apply this chat\'s branch to the project? Its changes are merged into the project\'s current git branch. If they clash with other changes, nothing is changed.')) return;
      act.disabled = true;
      act.textContent = 'Applying…';
      try { await post(`/api/chats/${id}/merge`); toast('Applied to the project'); }
      catch (err) { alert(err instanceof Error ? err.message : 'Could not apply the changes.'); }
      refresh();
    }
    else if (act.dataset.act === 'rename') {
      const title = prompt('Chat name', current.chat.title);
      if (title && title.trim()) { await post(`/api/chats/${id}/rename`, { title }).catch(() => {}); refresh(); }
    } else if (act.dataset.act === 'delete') {
      if (await deleteChat(current.chat)) location.hash = '#/';
    }
  });

  // Close the ⋯ menu when tapping anywhere else.
  document.addEventListener('click', e => {
    const m = document.getElementById('chat-menu');
    if (m && !m.hidden && !(e.target as HTMLElement).closest('.menu-wrap')) m.hidden = true;
  });

  const isBusy = (status: string) => status === 'running' || status === 'queued' || status === 'awaiting';
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // Deletes a chat. A chat that is still working is stopped first (after confirmation).
  async function deleteChat(c: ChatSummary): Promise<boolean> {
    const busy = isBusy(c.status);
    const what = c.branch
      ? 'Delete this chat and its branch? Changes that were not applied to the project are lost. The project folder itself is not changed.'
      : 'Delete this chat and its history from the hub? Project files are not changed.';
    if (!confirm((busy ? 'This chat is still working. It will be stopped first.\n\n' : '') + what)) return false;
    try {
      if (busy) {
        toast('Stopping…');
        await post(`/api/chats/${c.id}/abort`).catch(() => {});
        for (let i = 0; i < 40; i++) {
          await sleep(500);
          const d = await getJSON<ChatDetail>(`/api/chats/${c.id}`).catch(() => null);
          if (!d || !isBusy(d.chat.status)) break;
        }
      }
      await post(`/api/chats/${c.id}/delete`);
      toast('Chat deleted');
      refresh();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete the chat.');
      return false;
    }
  }

  // Delete from the chat list (PC: the bin appears on hover).
  $('chat-list').addEventListener('click', async e => {
    const bin = (e.target as HTMLElement).closest<HTMLElement>('[data-delete-chat]');
    if (!bin) return;
    e.preventDefault();
    e.stopPropagation();
    const c = data?.chats.find(x => x.id === Number(bin.dataset.deleteChat));
    if (c && await deleteChat(c) && route.name === 'chat' && route.id === c.id) location.hash = '#/';
  });

  // ---------- attachments: upload as soon as picked, send their ids with the message ----------
  interface Pending { key: number; name: string; size: number; type: string; id?: string; status: 'uploading' | 'done' | 'error'; error?: string }
  const MAX_FILES = 10;
  const MAX_BYTES = 25 * 1024 * 1024;
  let pending: Pending[] = [];
  let pendingKey = 0;

  function renderPending() {
    const box = $('attach-list');
    box.hidden = !pending.length;
    box.innerHTML = pending.map(p => {
      const note = p.status === 'uploading' ? 'uploading…' : p.status === 'error' ? (p.error || 'failed') : fmtSize(p.size);
      return `<span class="file-chip ${p.status}" title="${esc(p.error || p.name)}">${fileIcon(p.type, p.name)} ${esc(p.name)}
        <small>${esc(note)}</small><button type="button" class="chip-x" data-remove-file="${p.key}" aria-label="Remove ${esc(p.name)}">✕</button></span>`;
    }).join('');
    $<HTMLButtonElement>('send').disabled = pending.some(p => p.status === 'uploading');
  }

  function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      if (pending.length >= MAX_FILES) { toast(`Up to ${MAX_FILES} files per message`); break; }
      const p: Pending = { key: ++pendingKey, name: f.name || 'pasted-file', size: f.size, type: f.type, status: 'uploading' };
      pending.push(p);
      if (f.size > MAX_BYTES) { p.status = 'error'; p.error = 'larger than 25 MB'; continue; }
      fetch(`/api/uploads?name=${encodeURIComponent(p.name)}`, {
        method: 'POST', headers: { 'X-Hub': '1', 'Content-Type': f.type || 'application/octet-stream' }, body: f,
      })
        .then(async r => {
          const out = await r.json().catch(() => ({})) as { id?: string; error?: string };
          if (r.status === 401) onUnauthorized();
          if (!r.ok || !out.id) throw new Error(out.error || `Failed (${r.status})`);
          p.id = out.id;
          p.status = 'done';
        })
        .catch((e: unknown) => { p.status = 'error'; p.error = e instanceof Error ? e.message : 'failed'; })
        .finally(renderPending);
    }
    renderPending();
  }

  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', () => {
    const inp = $<HTMLInputElement>('file-input');
    if (inp.files?.length) addFiles(inp.files);
    inp.value = '';
  });
  $('attach-list').addEventListener('click', e => {
    const x = (e.target as HTMLElement).closest<HTMLElement>('[data-remove-file]');
    if (x) { pending = pending.filter(p => p.key !== Number(x.dataset.removeFile)); renderPending(); }
  });
  // Paste a screenshot straight into the message box.
  $('input').addEventListener('paste', e => {
    const files = (e as ClipboardEvent).clipboardData?.files;
    if (files && files.length) { e.preventDefault(); addFiles(files); }
  });
  // Drag and drop files onto the chat (PC).
  $('screen-chat').addEventListener('dragover', e => { if ((e as DragEvent).dataTransfer?.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
  $('screen-chat').addEventListener('dragleave', e => { if (e.target === $('screen-chat')) document.body.classList.remove('dropping'); });
  $('screen-chat').addEventListener('drop', e => {
    document.body.classList.remove('dropping');
    const files = (e as DragEvent).dataTransfer?.files;
    if (files && files.length) { e.preventDefault(); addFiles(files); }
  });

  function autosize() { const t = $<HTMLTextAreaElement>('input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 200) + 'px'; }
  $('input').addEventListener('input', autosize);
  $('input').addEventListener('keydown', e => {
    const k = e as KeyboardEvent;
    if (k.key === 'Enter' && !k.shiftKey && !k.isComposing && !coarse) { k.preventDefault(); $<HTMLFormElement>('composer').requestSubmit(); }
  });

  $('composer').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $<HTMLTextAreaElement>('input');
    const text = input.value.trim();
    if (route.name !== 'chat' && route.name !== 'new') return;
    if (pending.some(p => p.status === 'uploading')) return;
    if (pending.some(p => p.status === 'error')) { $('form-error').textContent = 'Remove the files that failed to upload first.'; return; }
    const attachments = pending.map(p => p.id).filter((id): id is string => !!id);
    if (!text && !attachments.length) return;
    const send = $<HTMLButtonElement>('send');
    send.disabled = true;
    $('form-error').textContent = '';
    const sent = () => { input.value = ''; autosize(); pending = []; renderPending(); };
    try {
      if (route.name === 'new') {
        if (!newChoice.targetId || !newChoice.projectId) { $('form-error').textContent = 'Pick an agent or a workflow, and a project.'; return; }
        const target = newChoice.kind === 'workflow' ? { workflowId: newChoice.targetId } : { agentId: newChoice.targetId };
        const useBranch = !!data?.projects.find(p => p.id === newChoice.projectId)?.git && newChoice.branch;
        if (useBranch) $('form-error').textContent = 'Creating the branch…';
        const out = await post<{ id: number }>('/api/chats', { ...target, projectId: newChoice.projectId, prompt: text, attachments, branch: useBranch });
        $('form-error').textContent = '';
        sent();
        location.hash = `#/chat/${out.id}`;
      } else {
        await post(`/api/chats/${route.id}/messages`, { prompt: text, attachments });
        sent();
        await loadChat(true);
      }
    } catch (err) {
      $('form-error').textContent = err instanceof Error ? err.message : 'Could not reach the hub.';
    } finally { send.disabled = false; renderPending(); }
  });

  setInterval(() => {
    document.querySelectorAll<HTMLElement>('[data-since]').forEach(s => { s.textContent = dur(Date.now() + clockSkew - Number(s.dataset.since)); });
  }, 1000);

  // ---------- start ----------
  async function boot() {
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const pair = location.hash.match(/^#pair=([\w-]+)$/);
    try {
      me = await (await fetch('/api/me', { cache: 'no-store' })).json() as Me;
    } catch {
      showGate(`<div class="big">A</div><h2>Can't reach the hub</h2><p>Check that the PC is on and Agent Hub is running.</p>
        <button class="btn" type="button" onclick="location.reload()">Try again</button>`);
      return;
    }
    if (pair && !me.local) return showPairForm(pair[1]);
    if (pair) history.replaceState(null, '', '/#/'); // a pairing link opened on the PC itself
    if (!me.authed) return showNotPaired();
    $('gate').hidden = true;
    $('app').hidden = false;
    document.body.classList.toggle('is-local', me.local);
    applyRoute();
    await refresh();
    connect();
  }
  boot();
})();
