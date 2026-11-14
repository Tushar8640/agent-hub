// Antigravity CLI (agy.exe) adapter, using the same flags as the Antigravity Telegram bot:
//   agy -p <prompt> --output-format json [--dangerously-skip-permissions] [--conversation <id>]
// The reply is one JSON object on stdout: { response, conversation_id, usage: { total_tokens }, duration_seconds }.
// No shell is used; the prompt is a single argv entry.
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

const antigravity: AdapterFactory = cfg => {
  const agentId = String(cfg.id || 'antigravity');
  const command = typeof cfg.command === 'string' && cfg.command ? cfg.command : findAgy();
  const skipPermissions = cfg.skipPermissions === true;
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
    start({ prompt, cwd, sessionId, model: runModel, onActivity, onSession, skipPermissions: chatSkip }: StartOptions) {
      if (prompt.length > MAX_PROMPT) {
        return { abort() {}, done: Promise.resolve({ error: `The message is too long for the agy command line (${prompt.length} characters, limit ${MAX_PROMPT}).` }) };
      }
      const args = ['-p', prompt, '--output-format', 'json'];
      // config.yaml skipPermissions: always on for this agent; otherwise the chat's own setting decides.
      if (skipPermissions || chatSkip) args.push('--dangerously-skip-permissions');
      const chosenModel = runModel || defaultModel;
      if (chosenModel) args.push('--model', chosenModel);
      if (sessionId) args.push('--conversation', sessionId);

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command as string, args, { cwd, windowsHide: true });
      } catch (e) {
        return { abort() {}, done: Promise.resolve({ error: `Could not start Antigravity: ${errorMessage(e)}` }) };
      }

      let stdout = '';
      let stderr = '';
      let partial = '';
      onActivity('🚀', 'Antigravity started');
      child.stdout.on('data', (d: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += d.toString(); });
      // agy prints progress on stderr; show it as activity, line by line.
      child.stderr.on('data', (d: Buffer) => {
        const text = d.toString();
        stderr = (stderr + text).slice(-4000);
        partial += text;
        const lines = partial.split(/\r?\n/);
        partial = lines.pop() || '';
        for (const line of lines) if (line.trim()) onActivity('›', line);
      });
      child.stdin.end();

      const done = new Promise<RunResult>(resolve => {
        let settled = false;
        child.on('error', e => { if (!settled) { settled = true; resolve({ error: `Could not start Antigravity: ${e.message}` }); } });
        child.on('close', code => {
          if (settled) return;
          settled = true;
          const raw = stdout.trim();
          let parsed: Json | null = null;
          try { parsed = JSON.parse(raw); } catch {
            // Some builds print log lines before the JSON; take the last {...} block.
            const start = raw.lastIndexOf('\n{');
            if (start >= 0) { try { parsed = JSON.parse(raw.slice(start + 1)); } catch {} }
          }
          const res: RunResult = {};
          if (parsed && typeof parsed.conversation_id === 'string') { res.sessionId = parsed.conversation_id; onSession(parsed.conversation_id); }
          if (parsed?.usage && typeof parsed.usage.total_tokens === 'number') res.tokensOut = parsed.usage.total_tokens;
          if (code === 0 && parsed) res.text = String(parsed.response ?? '') || '(no text reply)';
          else if (code === 0 && raw) res.text = raw;
          else {
            res.error = stderr.trim().slice(-1500) || raw.slice(-1500) || `Antigravity exited with code ${code}`;
            if (/conversation/i.test(res.error) && /not found|invalid|unknown/i.test(res.error)) res.sessionLost = true;
          }
          resolve(res);
        });
      });

      return { pid: child.pid, abort: () => killTree(child.pid), done };
    },
  };
};

export default antigravity;
