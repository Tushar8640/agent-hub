// Claude Code CLI adapter: claude -p --output-format stream-json, prompt on stdin, sessions resumed with --resume.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { errorMessage, killTree } from '../util.js';
import type { AdapterFactory, AgentModel, RunResult, StartOptions } from '../types.js';
import { getResolved, recordResolved, labelFor, timeAgo } from '../models.js';

const DEFAULT_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(npm run build)', 'Bash(npm run lint)', 'Bash(git status)', 'Bash(git diff:*)', 'Bash(git log:*)',
];
const MODES = new Set(['default', 'acceptEdits', 'plan']); // bypassPermissions is deliberately not allowed

export const CLAUDE_ALIASES = ['default', 'opus', 'sonnet', 'haiku'] as const;

function findClaude(): string | null {
  const candidates: string[] = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'));
  candidates.push(path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  return candidates.find(p => fs.existsSync(p)) || null;
}

type Json = Record<string, any>;

const claudeCode: AdapterFactory = cfg => {
  const agentId = String(cfg.id || 'claude');
  const command = typeof cfg.command === 'string' && cfg.command ? cfg.command : findClaude();
  const tools = Array.isArray(cfg.allowedTools) ? cfg.allowedTools.map(String) : DEFAULT_TOOLS;
  const mode = MODES.has(String(cfg.permissionMode)) ? String(cfg.permissionMode) : 'acceptEdits';
  const model = typeof cfg.model === 'string' && cfg.model ? cfg.model : null;
  const customModels = Array.isArray(cfg.models) && cfg.models.length
    ? (cfg.models as any[]).map(m => ({ id: String(m.id || m), label: String(m.label || m.name || m.id || m) }))
    : null;

  let problem: string | null = null;
  if (!command) problem = 'Claude Code CLI not found. Set "command" for this agent in config.yaml to the full path of claude.exe.';
  else if (path.isAbsolute(command) && !fs.existsSync(command)) problem = `Claude Code CLI not found at ${command}`;
  else if (cfg.permissionMode && !MODES.has(String(cfg.permissionMode))) problem = `permissionMode "${cfg.permissionMode}" is not allowed (use default, acceptEdits or plan)`;

  return {
    available: !problem,
    problem,
    resumable: true,
    fullAccess: false,
    get models(): AgentModel[] {
      if (customModels) return customModels;
      const resolved = getResolved(agentId);
      return CLAUDE_ALIASES.map(alias => {
        const info = resolved[alias];
        if (alias === 'default') {
          return {
            id: 'default',
            label: info ? `Default · ${labelFor(info.id)}` : 'Default',
            description: info ? `${info.id} · checked ${timeAgo(info.at)}` : 'Uses your Claude Code CLI default',
          };
        }
        const cap = alias.charAt(0).toUpperCase() + alias.slice(1);
        if (info) {
          return {
            id: alias,
            label: `${cap} · ${labelFor(info.id)}`,
            description: `${info.id} · checked ${timeAgo(info.at)}`,
          };
        }
        return {
          id: alias,
          label: `${cap} (latest)`,
          description: `Resolves to latest ${cap} on run`,
        };
      });
    },
    // Plan usage limits only arrive inside a Claude run, so probe with the smallest model, no tools, no saved session.
    probeUsage() {
      return new Promise<Record<string, unknown> | null>(resolve => {
        if (problem) return resolve(null);
        let probe: ChildProcessWithoutNullStreams;
        try {
          probe = spawn(command as string, ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--strict-mcp-config',
            '--output-format', 'stream-json', '--verbose'], { cwd: os.tmpdir(), windowsHide: true });
        } catch { return resolve(null); }
        let info: Record<string, unknown> | null = null;
        readline.createInterface({ input: probe.stdout }).on('line', line => {
          try {
            const o = JSON.parse(line);
            if (o.type === 'system' && o.subtype === 'init' && typeof o.model === 'string') {
              recordResolved(agentId, 'haiku', o.model);
            }
            if (o.type === 'rate_limit_event' && o.rate_limit_info) info = o.rate_limit_info;
          } catch {}
        });
        probe.stderr.on('data', () => {});
        probe.stdin.on('error', () => {});
        probe.stdin.end('ok');
        const t = setTimeout(() => killTree(probe.pid), 60_000);
        probe.on('error', () => { clearTimeout(t); resolve(null); });
        probe.on('close', () => { clearTimeout(t); resolve(info); });
      });
    },
    async refreshModels(): Promise<AgentModel[]> {
      if (problem) throw new Error(problem);
      for (const alias of CLAUDE_ALIASES) {
        await new Promise<void>(resolve => {
          let probe: ChildProcessWithoutNullStreams;
          const args = ['-p', '--tools', '', '--no-session-persistence', '--strict-mcp-config',
            '--output-format', 'stream-json', '--verbose'];
          if (alias !== 'default') args.push('--model', alias);
          try {
            probe = spawn(command as string, args, { cwd: os.tmpdir(), windowsHide: true });
          } catch {
            return resolve();
          }
          readline.createInterface({ input: probe.stdout }).on('line', line => {
            try {
              const o = JSON.parse(line);
              const m = (o.type === 'system' && o.subtype === 'init' && typeof o.model === 'string')
                ? o.model
                : (o.type === 'assistant' && typeof o.message?.model === 'string')
                  ? o.message.model
                  : null;
              if (m) recordResolved(agentId, alias, m);
            } catch {}
          });
          probe.stderr.on('data', () => {});
          probe.stdin.on('error', () => {});
          probe.stdin.end('ok');
          const t = setTimeout(() => killTree(probe.pid), 60_000);
          probe.on('error', () => { clearTimeout(t); resolve(); });
          probe.on('close', () => { clearTimeout(t); resolve(); });
        });
      }
      return this.models || [];
    },
    start({ prompt, cwd, sessionId, model: runModel, onActivity, onSession, onUsage, onImage, overrides, extraDirs, skipPermissions }: StartOptions) {
      // A workflow step may tighten permissions (e.g. read-only planning). It can never loosen them:
      // step tools are limited to the agent's own allowedTools.
      const stepMode = overrides?.permissionMode && MODES.has(overrides.permissionMode) ? overrides.permissionMode : mode;
      const stepTools = overrides?.allowedTools ? overrides.allowedTools.filter(t => tools.includes(t)) : tools;
      const args = ['-p', '--output-format', 'stream-json', '--verbose'];
      // Per-chat "skip permissions" (set from the app): no permission checks at all, so allowedTools is not needed.
      if (skipPermissions) args.push('--dangerously-skip-permissions');
      else args.push('--permission-mode', stepMode);
      const chosenModel = runModel || model;
      if (chosenModel && chosenModel !== 'default') args.push('--model', chosenModel);
      if (extraDirs?.length) args.push('--add-dir', ...extraDirs); // lets Claude read uploaded files
      if (!skipPermissions && stepTools.length) args.push('--allowedTools', ...stepTools);
      if (sessionId) args.push('--resume', sessionId);

      let child: ChildProcessWithoutNullStreams;
      try {
        // No shell: the prompt only ever travels through stdin.
        child = spawn(command as string, args, { cwd, windowsHide: true });
      } catch (e) {
        return { abort() {}, done: Promise.resolve({ error: `Could not start Claude Code: ${errorMessage(e)}` }) };
      }

      let stderr = '';
      let final: Json | null = null;
      let currentSession = sessionId;
      let resolvedModelId: string | null = null;
      let reportedModel = false;
      const toolFiles = new Map<string, string>(); // tool_use id -> file it read, to name images

      readline.createInterface({ input: child.stdout }).on('line', line => {
        let o: Json;
        try { o = JSON.parse(line); } catch { return; }
        if (typeof o.session_id === 'string' && o.session_id !== currentSession) {
          currentSession = o.session_id;
          onSession(o.session_id);
        }
        const modelId = (o.type === 'system' && o.subtype === 'init' && typeof o.model === 'string')
          ? o.model
          : (o.type === 'assistant' && typeof o.message?.model === 'string')
            ? o.message.model
            : null;
        if (modelId && !reportedModel) {
          reportedModel = true;
          resolvedModelId = modelId;
          const effectiveAlias = chosenModel && chosenModel !== 'default' ? chosenModel : 'default';
          recordResolved(agentId, effectiveAlias, modelId);
          onActivity('🧠', 'Model: ' + labelFor(modelId));
        }
        if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
          for (const b of o.message.content) {
            if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) onActivity('💬', b.text);
            else if (b.type === 'tool_use') {
              const i = b.input || {};
              if (typeof b.id === 'string' && typeof i.file_path === 'string') toolFiles.set(b.id, i.file_path);
              const target = i.file_path || i.command || i.pattern || i.path || i.description || '';
              onActivity('🔧', `${b.name}${target ? ': ' + target : ''}`);
            }
          }
        } else if (o.type === 'user' && onImage && Array.isArray(o.message?.content)) {
          // Tool results come back as user messages; reading an image file returns base64 image blocks.
          for (const b of o.message.content) {
            if (b?.type !== 'tool_result' || !Array.isArray(b.content)) continue;
            const file = toolFiles.get(b.tool_use_id);
            for (const c of b.content) {
              if (c?.type !== 'image' || c.source?.type !== 'base64' || typeof c.source.data !== 'string') continue;
              onImage({
                name: file ? path.basename(file) : 'image',
                type: String(c.source.media_type || ''),
                data: Buffer.from(c.source.data, 'base64'),
              });
            }
          }
        } else if (o.type === 'rate_limit_event' && o.rate_limit_info && typeof o.rate_limit_info === 'object') {
          onUsage?.(o.rate_limit_info);
        } else if (o.type === 'result') {
          final = o;
        }
      });
      child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);

      const done = new Promise<RunResult>(resolve => {
        let settled = false;
        const finish = (startError?: string) => {
          if (settled) return;
          settled = true;
          if (startError) return resolve({ error: startError });
          const f = final;
          const res: RunResult = { sessionId: currentSession, resolvedModel: resolvedModelId };
          if (f) {
            const u = f.usage || {};
            res.costUsd = typeof f.total_cost_usd === 'number' ? f.total_cost_usd : null;
            res.tokensIn = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            res.tokensOut = u.output_tokens || 0;
            const denied = Array.isArray(f.permission_denials) ? f.permission_denials.length : 0;
            if (denied) onActivity('⛔', `${denied} tool call(s) denied by permissions`);
            if (f.is_error) res.error = String(f.result || 'Claude Code reported an error');
            else res.text = String(f.result ?? '');
          } else {
            res.error = stderr.trim().slice(-1500) || 'Claude Code exited without a result';
          }
          if (res.error && /No conversation found/i.test(`${res.error}\n${stderr}`)) res.sessionLost = true;
          resolve(res);
        };
        child.on('error', e => finish(`Could not start Claude Code: ${e.message}`));
        child.on('close', () => finish());
      });

      return { pid: child.pid, abort: () => killTree(child.pid), done };
    },
  };
};

export default claudeCode;
