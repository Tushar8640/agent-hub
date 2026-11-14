// Generic command-line agent. Configured entirely in config.yaml:
//   command: path to an .exe (or "node"), args: [...], input: stdin | arg, context: none | transcript
// The prompt is passed without a shell (stdin, or a single argv entry), so message text is never parsed as a command.
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { errorMessage, killTree } from '../util.js';
import type { AdapterFactory, RunResult, StartOptions } from '../types.js';

const MAX_OUTPUT = 200_000;

const cli: AdapterFactory = cfg => {
  const rawCommand = typeof cfg.command === 'string' ? cfg.command.trim() : '';
  const command = rawCommand === 'node' ? process.execPath : rawCommand;
  const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
  const input = cfg.input === 'arg' ? 'arg' : 'stdin';
  const transcript = cfg.context === 'transcript';

  let problem: string | null = null;
  if (!command) problem = 'Set "command" for this agent in config.yaml.';
  else if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command))
    problem = '.cmd/.bat files need a shell, which the hub never uses. Point "command" at the .exe, or use "node" with the script path.';

  return {
    available: !problem,
    problem,
    resumable: false,
    fullAccess: false,
    start({ prompt, cwd, history, onActivity }: StartOptions) {
      let full = prompt;
      if (transcript && history?.length) {
        full = history.map(h => `User: ${h.prompt}\n\nAssistant: ${h.result}`).join('\n\n') + `\n\nUser: ${prompt}\n\nAssistant:`;
      }
      const finalArgs = input === 'arg'
        ? (args.includes('{prompt}') ? args.map(a => (a === '{prompt}' ? full : a)) : [...args, full])
        : args;

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(command, finalArgs, { cwd, windowsHide: true });
      } catch (e) {
        return { abort() {}, done: Promise.resolve({ error: `Could not start ${command}: ${errorMessage(e)}` }) };
      }

      let out = '';
      let stderr = '';
      readline.createInterface({ input: child.stdout }).on('line', line => {
        if (out.length < MAX_OUTPUT) out += line + '\n';
        if (line.trim()) onActivity('›', line);
      });
      child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
      child.stdin.on('error', () => {});
      if (input === 'stdin') child.stdin.end(full);
      else child.stdin.end();

      const done = new Promise<RunResult>(resolve => {
        let settled = false;
        child.on('error', e => { if (!settled) { settled = true; resolve({ error: `Could not start ${command}: ${e.message}` }); } });
        child.on('close', code => {
          if (settled) return;
          settled = true;
          const text = out.trimEnd();
          if (code === 0) resolve({ text });
          else resolve({ text, error: stderr.trim().slice(-1500) || `Exited with code ${code}` });
        });
      });

      return { pid: child.pid, abort: () => killTree(child.pid), done };
    },
  };
};

export default cli;
