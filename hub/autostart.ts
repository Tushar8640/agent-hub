import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT } from './config.js';
import { log } from './util.js';

// Windows only: makes sure the "Agent Hub Supervisor" login task exists (or is removed when autostart: false).
export function ensureAutostart(enabled: boolean): void {
  if (process.platform !== 'win32') return;
  const script = path.join(ROOT, 'scripts', 'install-autostart.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  if (!enabled) args.push('-Remove');
  execFile('powershell.exe', args, { windowsHide: true, timeout: 30000 }, (err, stdout) => {
    const out = String(stdout || '').trim();
    if (err) log(`autostart: could not ${enabled ? 'register' : 'remove'} the login task (${out || err.message}). ` +
      'Run scripts\\install-autostart.ps1 in PowerShell opened as administrator.');
    else if (!/^Already installed|^Not installed/.test(out)) log(`autostart: ${out}`);
  });
}
