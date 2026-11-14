import os from 'node:os';
import { execFileSync } from 'node:child_process';

export const log = (...a: unknown[]): void => console.log(`[${new Date().toISOString()}]`, ...a);

// Stops a process and everything it started (Claude Code spawns its own children).
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch {}
}

export interface Address { address: string; name: string; kind: 'tailscale' | 'lan' }

// Tailscale addresses are in 100.64.0.0/10.
const isTailscaleIp = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

// Addresses a phone could use to reach this PC, Tailscale first.
export function lanAddresses(): Address[] {
  const out: Address[] = [];
  for (const [name, nets] of Object.entries(os.networkInterfaces())) {
    for (const n of nets || []) {
      const v4 = n.family === 'IPv4' || (n.family as unknown) === 4;
      if (!v4 || n.internal || n.address.startsWith('169.254.')) continue;
      const tailscale = /tailscale/i.test(name) || isTailscaleIp(n.address);
      if (!tailscale && /vEthernet|VirtualBox|VMware|WSL|Loopback|Hyper-V/i.test(name)) continue;
      out.push({ address: n.address, name, kind: tailscale ? 'tailscale' : 'lan' });
    }
  }
  return out.sort((a, b) => (a.kind === 'tailscale' ? 0 : 1) - (b.kind === 'tailscale' ? 0 : 1));
}

export const clip = (s: unknown, n: number): string => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
