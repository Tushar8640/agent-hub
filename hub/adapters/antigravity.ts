// Antigravity CLI (agy.exe) adapter.
// Real CLI output tested on Antigravity CLI v1.5.9:
//   - Supports: --output-format stream-json, --add-dir, --conversation, --model
//   - Output format: agy -p <prompt> --output-format stream-json [--dangerously-skip-permissions] [--conversation <id>]
//
// Real stream-json event structure (verified in hub/adapters/antigravity.stream-sample.jsonl):
//   - init: { event: "init", conversation_id, init: { model, cwd, tools, permission_mode } }
//   - step_update: { event: "step_update", step_update: { conversation_id, step_index, state: "ACTIVE"|"DONE",
//                   step_type: "user_input"|"agent_response"|"tool", tool_name, tool_info: { name, parameters, output },
//                   text_delta, duration_seconds, usage } }
//   - result: { event: "result", result: { conversation_id, status: "SUCCESS"|"ERROR", response, duration_seconds, num_turns, usage } }
//
// stdout is parsed as a stream of JSON objects, not line by line, so both NDJSON and pretty-printed (multi-line)
// output work. Tool steps are shown once per step_index, whether agy sends an ACTIVE update or only DONE.
// The raw output of the last run is saved to logs/antigravity-last-run.txt for checking the real format.
//
// Live activities emitted:
//   - 💬: agent message / thought
//   - 🔧: tool call with target (read_file, write_file, run_command, etc.)
//   - ⚠️: tool errors
//   - 🧠: model information when resolved
//   - ✏️: changed files (filesystem watcher fallback)
//   - ⏳: heartbeat if working silently
//   - 📊: final run summary
//
// Permissions: by default the hub does NOT pass --dangerously-skip-permissions. Without it agy may be unable to
// edit files or run commands in non-interactive mode. Turning it on (skipPermissions: true in config.yaml) gives
// the agent full, unchecked access to this PC; the app then marks the agent "full access".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { errorMessage, killTree } from '../util.js';
import type { AdapterFactory, AgentModel, RunResult, StartOptions } from '../types.js';
import { getResolved, recordResolved, timeAgo } from '../models.js';

const MAX_PROMPT = 30_000; // Windows command lines are limited to ~32k characters
const MAX_OUTPUT = 400_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export const ANTIGRAVITY_MODELS: AgentModel[] = [
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
];

function findAgy(): string | null {
  const candidates: string[] = [];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
  return candidates.find(p => fs.existsSync(p)) || null;
}

type Json = Record<string, any>;

const formatDur = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
};

// If an agy CLI build fails on stream-json, remember this in memory to fall back to plain json for the session.
let streamDisabledFallback = false;

// Raw stdout of the most recent run, for checking what this agy build actually prints.
const RAW_LOG = path.join(process.cwd(), 'logs', 'antigravity-last-run.txt');

// Splits a stream of text into top-level JSON objects, whether agy prints one object per line (NDJSON) or
// pretty-prints each object over several lines. Text outside objects (log lines) is ignored.
function jsonObjectSplitter(onObject: (o: Json) => void) {
  let buf = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  return (chunk: string) => {
    let i = buf.length;
    buf += chunk;
    for (; i < buf.length; i++) {
      const ch = buf[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { if (depth > 0) inString = true; }
      else if (ch === '{') { if (depth++ === 0) start = i; }
      else if (ch === '}' && depth > 0 && --depth === 0) {
        let obj: Json | null = null;
        try { obj = JSON.parse(buf.slice(start, i + 1)); } catch {}
        buf = buf.slice(i + 1);
        if (obj) onObject(obj);
        i = -1;
        start = -1;
      }
    }
    if (depth === 0) buf = ''; // nothing open: drop stray log text
    else if (buf.length > MAX_OUTPUT) { buf = ''; depth = 0; inString = false; escaped = false; start = -1; } // runaway object
  };
}

// Reads a field under either snake_case or camelCase.
const pick = (o: Json | null | undefined, snake: string): any => {
  if (!o) return undefined;
  if (o[snake] !== undefined) return o[snake];
  return o[snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
};

const antigravity: AdapterFactory = cfg => {
  const agentId = String(cfg.id || 'antigravity');
  const command = typeof cfg.command === 'string' && cfg.command ? cfg.command : findAgy();
  const skipPermissions = cfg.skipPermissions === true;
  const stream = cfg.stream !== false;
  const streamFormat = typeof cfg.streamFormat === 'string' && cfg.streamFormat ? cfg.streamFormat : 'stream-json';
  const defaultModel = typeof cfg.model === 'string' && cfg.model ? cfg.model : null;
  const customModels = Array.isArray(cfg.models) && cfg.models.length
    ? (cfg.models as any[]).map(m => ({ id: String(m.id || m), label: String(m.label || m.name || m.id || m) }))
    : null;
  // How to ask agy for its plan usage. Default: its /usage command in print mode. Change in config.yaml (usageArgs)
  // if your agy version needs something else. Never runs automatically, only from the dashboard's "Check now".
  const usageArgs = Array.isArray(cfg.usageArgs) && cfg.usageArgs.length
    ? cfg.usageArgs.map(String)
    : ['-p', '/usage', '--output-format', 'json'];

  let problem: string | null = null;
  if (!command) problem = 'Antigravity CLI (agy.exe) not found. Set "command" for this agent in config.yaml to the full path of agy.exe.';
  else if (path.isAbsolute(command) && !fs.existsSync(command)) problem = `Antigravity CLI not found at ${command}`;

  return {
    available: !problem,
    problem,
    resumable: true,
    fullAccess: skipPermissions,
    // Discovered via "agy models" and cached in data/models.json; falls back to ANTIGRAVITY_MODELS or config.yaml override.
    get models(): AgentModel[] {
      if (customModels) return customModels;
      const resolved = getResolved(agentId);
      const entries = Object.entries(resolved);
      if (entries.length > 0) {
        return entries.map(([id, info]) => ({
          id,
          label: info.id,
          description: `checked ${timeAgo(info.at)}`,
        }));
      }
      return ANTIGRAVITY_MODELS;
    },
    async refreshModels(): Promise<AgentModel[]> {
      if (problem) throw new Error(problem);
      return new Promise<AgentModel[]>((resolve, reject) => {
        let p: ChildProcessWithoutNullStreams;
        try {
          p = spawn(command as string, ['models'], { cwd: os.tmpdir(), windowsHide: true });
        } catch (e) {
          return reject(e);
        }
        let out = '';
        p.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        const timer = setTimeout(() => killTree(p.pid), 30_000);
        p.on('error', e => { clearTimeout(timer); reject(e); });
        p.on('close', () => {
          clearTimeout(timer);
          const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (line.toLowerCase().startsWith('fetching')) continue;
            const parts = line.split(/\t+/);
            if (parts.length >= 2) {
              const id = parts[0].trim();
              const label = parts.slice(1).join(' ').trim();
              if (id && label) recordResolved(agentId, id, label);
            }
          }
          resolve(this.models || []);
        });
      });
    },
    // Runs agy's /usage and returns its reply as text (shown as-is in the dashboard; nothing is guessed from it).
    probeUsage() {
      return new Promise<Record<string, unknown> | null>(resolve => {
        if (problem) return resolve(null);
        let p: ChildProcessWithoutNullStreams;
        try { p = spawn(command as string, usageArgs, { cwd: os.tmpdir(), windowsHide: true }); }
        catch { return resolve(null); }
        let out = '';
        let err = '';
        p.stdout.on('data', (d: Buffer) => { if (out.length < 50_000) out += d.toString(); });
        p.stderr.on('data', (d: Buffer) => { if (err.length < 20_000) err += d.toString(); });
        p.stdin.on('error', () => {});
        p.stdin.end();
        const t = setTimeout(() => killTree(p.pid), 60_000);
        p.on('error', () => { clearTimeout(t); resolve(null); });
        p.on('close', () => {
          clearTimeout(t);
          const raw = out.trim();
          let parsed: any = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            const start = raw.lastIndexOf('\n{');
            if (start >= 0) { try { parsed = JSON.parse(raw.slice(start + 1)); } catch {} }
          }
          if (parsed?.command?.data?.groups && Array.isArray(parsed.command.data.groups)) {
            return resolve({
              groups: parsed.command.data.groups,
              text: parsed.response || '',
              source: `agy ${usageArgs.join(' ')}`,
            });
          }
          let text = parsed && typeof parsed.response === 'string' ? parsed.response.trim() : raw;
          if (!text) text = err.trim();
          resolve(text ? { text: text.slice(0, 6000), source: `agy ${usageArgs.join(' ')}` } : null);
        });
      });
    },
    start({ prompt, cwd, sessionId, model: runModel, onActivity, onSession, onImage, skipPermissions: chatSkip, extraDirs }: StartOptions) {
      if (prompt.length > MAX_PROMPT) {
        return { abort() {}, done: Promise.resolve({ error: `The message is too long for the agy command line (${prompt.length} characters, limit ${MAX_PROMPT}).` }) };
      }
      const useStream = stream && !streamDisabledFallback;
      const args = ['-p', prompt, '--output-format', useStream ? streamFormat : 'json'];
      // config.yaml skipPermissions: always on for this agent; otherwise the chat's own setting decides.
      if (skipPermissions || chatSkip) args.push('--dangerously-skip-permissions');
      const chosenModel = runModel || defaultModel;
      if (chosenModel) args.push('--model', chosenModel);
      if (sessionId) args.push('--conversation', sessionId);
      if (extraDirs?.length) {
        for (const d of extraDirs) args.push('--add-dir', d);
      }

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command as string, args, { cwd, windowsHide: true });
      } catch (e) {
        return { abort() {}, done: Promise.resolve({ error: `Could not start Antigravity: ${errorMessage(e)}` }) };
      }

      let stdout = '';
      let stderr = '';
      let partialStderr = '';
      let lastStderrLine = '';
      let final: Json | null = null;
      let currentSession = sessionId;
      let resolvedModelId: string | null = null;
      let reportedModel = false;
      let eventsSeen = 0;
      let lastActivityAt = Date.now();
      const startTime = Date.now();

      const emitActivity = (icon: string, text: string) => {
        lastActivityAt = Date.now();
        onActivity(icon, text);
      };

      // Deduplicated image emission: mirrors Claude Code adapter's onImage support so screenshots
      // Antigravity reads or references appear live in the chat's ImageGallery.
      const seenImages = new Set<string>();
      const emitImageFromPath = (rawPath: string) => {
        if (!onImage || !rawPath) return;
        let cleaned = rawPath.trim().replace(/^["']|["']$/g, '');
        if (/^file:\/\//i.test(cleaned)) {
          cleaned = cleaned.replace(/^file:\/\//i, '');
          try { cleaned = decodeURIComponent(cleaned); } catch {}
          // Windows file:///C:/... -> C:/...
          if (/^\/[a-zA-Z]:[\\/]/.test(cleaned)) cleaned = cleaned.slice(1);
        }
        const ext = path.extname(cleaned).toLowerCase();
        const mime = IMAGE_MIME[ext];
        if (!mime) return;
        const resolved = path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
        const dedupeKey = resolved.toLowerCase();
        if (seenImages.has(dedupeKey)) return;
        try {
          const stat = fs.statSync(resolved);
          if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) return;
          const data = fs.readFileSync(resolved);
          seenImages.add(dedupeKey);
          onImage({ name: path.basename(resolved), type: mime, data });
        } catch {}
      };

      const emitImagesFromMarkdown = (markdown: string) => {
        if (!onImage || !markdown) return;
        const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = imgRe.exec(markdown)) !== null) {
          const target = m[1].trim();
          if (/^https?:\/\//i.test(target)) continue;
          emitImageFromPath(target);
        }
      };

      emitActivity('🚀', 'Antigravity started');

      // 1. Fallback file watcher: tracks modified/created files in cwd
      const changedFiles = new Set<string>();
      const reportedFiles = new Set<string>();
      let moreFilesReported = false;
      let watcher: fs.FSWatcher | null = null;
      try {
        watcher = fs.watch(cwd, { recursive: true }, (_eventType, filename) => {
          if (!filename) return;
          const normal = filename.replace(/\\/g, '/');
          if (/(^|\/)(node_modules|\.git|dist|\.next|data|logs)(\/|$)/i.test(normal)) return;
          changedFiles.add(normal);
        });
      } catch {}

      const reportChangesTimer = setInterval(() => {
        if (reportedFiles.size >= 200) {
          if (!moreFilesReported) {
            moreFilesReported = true;
            emitActivity('✏️', '…more files changed');
          }
          return;
        }
        for (const f of changedFiles) {
          if (reportedFiles.size >= 200) {
            if (!moreFilesReported) {
              moreFilesReported = true;
              emitActivity('✏️', '…more files changed');
            }
            break;
          }
          if (!reportedFiles.has(f)) {
            reportedFiles.add(f);
            emitActivity('✏️', `Changed: ${f}`);
          }
        }
      }, 2000);

      // 2. Heartbeat timer: emits status if nothing was reported for 30 seconds
      const heartbeatTimer = setInterval(() => {
        if (Date.now() - lastActivityAt >= 30_000) {
          emitActivity('⏳', `Still working (${formatDur(Date.now() - startTime)})`);
        }
      }, 5000);

      const cleanup = () => {
        if (watcher) {
          try { watcher.close(); } catch {}
          watcher = null;
        }
        clearInterval(reportChangesTimer);
        clearInterval(heartbeatTimer);
      };

      // Stream parsing
      if (useStream) {
        // Tool steps already shown, and agent text per step (steps can interleave).
        const shownTools = new Set<string>();
        const agentText = new Map<string, string>();
        const isDone = (s: unknown) => typeof s === 'string' && /DONE|COMPLETE|FINISH/i.test(s);

        const handleEvent = (o: Json) => {
          eventsSeen++;
          const stepObj = pick(o, 'step_update');
          const resultObj = typeof o.result === 'object' && o.result ? o.result : null;

          const sidRaw = pick(o, 'conversation_id') ?? pick(stepObj, 'conversation_id') ?? pick(resultObj, 'conversation_id');
          const sid = typeof sidRaw === 'string' ? sidRaw : null;
          if (sid && sid !== currentSession) {
            currentSession = sid;
            onSession(sid);
          }

          const eventType = String(o.event ?? o.type ?? '').toLowerCase();
          const initObj = o.init ?? (eventType === 'init' ? o : null);
          if (initObj && typeof initObj.model === 'string' && !reportedModel) {
            reportedModel = true;
            resolvedModelId = initObj.model;
            recordResolved(agentId, chosenModel || 'default', initObj.model);
            emitActivity('🧠', 'Model: ' + initObj.model);
          }

          const step = stepObj ?? (eventType === 'step_update' ? o : null);
          if (step) {
            const stepType = String(pick(step, 'step_type') ?? '').toLowerCase();
            const state = pick(step, 'state');
            const key = String(pick(step, 'step_index') ?? '?');
            const toolInfo = pick(step, 'tool_info') || {};
            const toolName = pick(step, 'tool_name') || toolInfo.name;

            if (stepType.includes('tool') || (toolName && !stepType.includes('response'))) {
              // Show each tool step once, whether agy sends ACTIVE first or only DONE.
              if (!shownTools.has(key)) {
                shownTools.add(key);
                const p = toolInfo.parameters || toolInfo.args || {};
                const rawTarget = p.Path || p.path || p.AbsolutePath || p.file_path || p.TargetFile || p.CommandLine || p.command
                  || p.Url || p.url || p.query || p.Query || p.pattern || p.description || p.Target || p.target || '';
                const target = typeof rawTarget === 'string' ? rawTarget.trim() : '';
                emitActivity('🔧', `${toolName || 'tool'}${target ? ': ' + target : ''}`);
              }
              if (isDone(state)) {
                const p = toolInfo.parameters || toolInfo.args || {};
                const fileParam = p.Path || p.path || p.AbsolutePath || p.file_path || p.TargetFile;
                if (typeof fileParam === 'string' && fileParam.trim()) {
                  emitImageFromPath(fileParam);
                }
                const err = toolInfo.error || step.error || null;
                if (err) emitActivity('⚠️', String(typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 120));
              }
            } else if (stepType.includes('response') || stepType.includes('agent') || stepType.includes('planner')) {
              const delta = pick(step, 'text_delta');
              if (typeof delta === 'string') agentText.set(key, (agentText.get(key) || '') + delta);
              else if (typeof step.text === 'string') agentText.set(key, step.text);
              if (isDone(state)) {
                const text = (agentText.get(key) || '').trim();
                if (text) {
                  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || text;
                  emitActivity('💬', firstLine.slice(0, 140));
                }
                agentText.delete(key);
              }
            }
          } else if (eventType === 'result' || resultObj) {
            final = resultObj ?? o;
          } else if (typeof o.response === 'string') {
            // Plain json output (no streaming): one object with the whole reply.
            final = o;
          }
        };

        const split = jsonObjectSplitter(handleEvent);
        child.stdout.setEncoding('utf8'); // keep multi-byte characters intact across chunks
        child.stdout.on('data', (text: string) => {
          if (stdout.length < MAX_OUTPUT) stdout += text;
          try { split(text); } catch {} // an unexpected event shape must never take the hub down
        });
      } else {
        child.stdout.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString(); });
      }

      // agy prints progress on stderr; show it as activity, line by line.
      child.stderr.on('data', (d: Buffer) => {
        const text = d.toString();
        stderr = (stderr + text).slice(-4000);
        partialStderr += text;
        const lines = partialStderr.split(/\r?\n/);
        partialStderr = lines.pop() || '';
        for (const rawLine of lines) {
          const clean = rawLine.replace(/\x1b\[[0-9;]*m/g, '').trim();
          if (!clean || clean === lastStderrLine) continue;
          lastStderrLine = clean;
          emitActivity('›', clean);
        }
      });
      child.stdin.end();

      const done = new Promise<RunResult>(resolve => {
        let settled = false;
        child.on('error', e => {
          cleanup();
          if (!settled) { settled = true; resolve({ error: `Could not start Antigravity: ${e.message}` }); }
        });
        child.on('close', code => {
          cleanup();
          if (settled) return;
          settled = true;

          // Keep the raw output of the last run so the real agy format can be checked (overwritten each run).
          try {
            fs.mkdirSync(path.dirname(RAW_LOG), { recursive: true });
            fs.writeFileSync(RAW_LOG, `# agy ${args.filter(a => a !== prompt).join(' ')}\n# exit ${code}, ${eventsSeen} JSON object(s) parsed\n${stdout}\n# stderr\n${stderr}`);
          } catch {}

          // Auto-fallback: if stream-json produced no events and stderr indicates format issue, fall back to json
          if (useStream && !final && eventsSeen === 0 && /output-format|unknown option|invalid/i.test(stderr)) {
            streamDisabledFallback = true;
            emitActivity('⚠️', 'agy does not support stream-json; using json');
          }

          const res: RunResult = { sessionId: currentSession, resolvedModel: resolvedModelId };
          let parsed: Json | null = null;

          if (final) {
            if (final.conversation_id) {
              res.sessionId = final.conversation_id;
              onSession(final.conversation_id);
            }
            if (final.usage) {
              if (typeof final.usage.input_tokens === 'number') res.tokensIn = final.usage.input_tokens;
              if (typeof final.usage.output_tokens === 'number') res.tokensOut = final.usage.output_tokens;
              else if (typeof final.usage.total_tokens === 'number') res.tokensOut = final.usage.total_tokens;
            }
            if (final.status === 'SUCCESS' || (!final.status && final.response)) {
              res.text = String(final.response ?? '') || '(no text reply)';
              emitImagesFromMarkdown(res.text);
            } else {
              res.error = String(final.response || stderr.trim().slice(-1500) || `Antigravity exited with code ${code}`);
            }
          } else {
            const raw = stdout.trim();
            try { parsed = JSON.parse(raw); } catch {
              // Some builds print log lines before the JSON; take the last {...} block.
              const start = raw.lastIndexOf('\n{');
              if (start >= 0) { try { parsed = JSON.parse(raw.slice(start + 1)); } catch {} }
            }
            if (parsed && typeof parsed.conversation_id === 'string') {
              res.sessionId = parsed.conversation_id;
              onSession(parsed.conversation_id);
            }
            if (parsed?.usage && typeof parsed.usage.total_tokens === 'number') res.tokensOut = parsed.usage.total_tokens;
            if (code === 0 && parsed) {
              res.text = String(parsed.response ?? '') || '(no text reply)';
              emitImagesFromMarkdown(res.text);
            } else if (code === 0 && raw) {
              res.text = raw;
              emitImagesFromMarkdown(res.text);
            } else {
              res.error = stderr.trim().slice(-1500) || raw.slice(-1500) || `Antigravity exited with code ${code}`;
            }
          }

          // Done summary activity
          const turns = typeof final?.num_turns === 'number' ? final.num_turns
            : typeof parsed?.num_turns === 'number' ? parsed.num_turns
            : null;
          const tokens = res.tokensOut ?? final?.usage?.total_tokens ?? parsed?.usage?.total_tokens;
          // Wall-clock time: agy's own duration_seconds leaves out its start-up, so it reads shorter than the run.
          emitActivity('📊', `Done in ${formatDur(Date.now() - startTime)} · ${tokens ? tokens + ' tokens' : (turns ? turns + ' turn(s)' : 'finished')}`);

          if (res.error && /conversation/i.test(res.error) && /not found|invalid|unknown/i.test(res.error)) {
            res.sessionLost = true;
          }

          resolve(res);
        });
      });

      return {
        pid: child.pid,
        abort: () => {
          cleanup();
          killTree(child.pid);
        },
        done,
      };
    },
  };
};

export default antigravity;
