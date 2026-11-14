// Who may use the hub:
// - The PC itself (loopback address AND a localhost Host header, which blocks DNS rebinding).
// - Paired devices: a random token kept in an HttpOnly cookie (or sent as Authorization: Bearer).
// Pairing: the PC creates a one-time code (valid 5 minutes) shown as a QR code; a phone redeems it once.
// Only a SHA-256 hash of each device token is stored.
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db, changed } from './store.js';
import type { Device } from './types.js';

export const DEVICE_COOKIE = 'hub_device';
const PAIR_TTL_MS = 5 * 60 * 1000;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const pairings = new Map<string, number>(); // code -> expiresAt

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function isLocalRequest(req: IncomingMessage, port: number): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress || '')) return false;
  if (req.headers['x-forwarded-for'] || req.headers['forwarded']) return false; // arrived through a proxy
  const host = String(req.headers.host || '').toLowerCase();
  return host === `localhost:${port}` || host === `127.0.0.1:${port}` || host === `[::1]:${port}`;
}

function tokenFrom(req: IncomingMessage): string | null {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim() || null;
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}

export function deviceForRequest(req: IncomingMessage): Device | null {
  const token = tokenFrom(req);
  if (!token) return null;
  const hash = sha256(token);
  const device = db.devices.find(d => d.tokenHash === hash) || null;
  if (device && Date.now() - (device.lastSeenAt || 0) > 60 * 1000) { device.lastSeenAt = Date.now(); changed(); }
  return device;
}

export function newPairingCode(): { code: string; expiresAt: number } {
  const now = Date.now();
  for (const [c, exp] of pairings) if (exp < now) pairings.delete(c);
  const code = crypto.randomBytes(18).toString('base64url');
  const expiresAt = now + PAIR_TTL_MS;
  pairings.set(code, expiresAt);
  return { code, expiresAt };
}

export function redeemPairing(code: string, name: string): { device: Device; token: string } | null {
  const exp = pairings.get(code);
  pairings.delete(code);
  if (!exp || exp < Date.now()) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  const device: Device = {
    id: crypto.randomUUID(),
    name: name.replace(/\s+/g, ' ').trim().slice(0, 40) || 'My device',
    tokenHash: sha256(token),
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  };
  db.devices.push(device);
  changed();
  return { device, token };
}

export function revokeDevice(id: string): boolean {
  const before = db.devices.length;
  db.devices = db.devices.filter(d => d.id !== id);
  if (db.devices.length === before) return false;
  changed();
  return true;
}

export const publicDevice = (d: Device) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt });
