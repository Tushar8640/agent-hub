// Cache of models resolved by agent CLIs (stored in data/models.json).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export type Resolved = Record<string, { id: string; at: number }>;

const MODELS_FILE = path.join(ROOT, 'data', 'models.json');
let cache: Record<string, Resolved> | null = null;

export function loadResolved(): Record<string, Resolved> {
  if (cache) return cache;
  try {
    if (fs.existsSync(MODELS_FILE)) {
      cache = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8')) as Record<string, Resolved>;
      return cache || {};
    }
  } catch {}
  cache = {};
  return cache;
}

export function saveResolved(data: Record<string, Resolved>): void {
  cache = data;
  try {
    fs.mkdirSync(path.dirname(MODELS_FILE), { recursive: true });
    fs.writeFileSync(MODELS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

export function getResolved(agentId: string): Resolved {
  const all = loadResolved();
  return all[agentId] || {};
}

export function recordResolved(agentId: string, alias: string, resolvedId: string): boolean {
  if (!agentId || !alias || !resolvedId) return false;
  const all = loadResolved();
  const current = all[agentId]?.[alias];
  if (current && current.id === resolvedId) return false;
  if (!all[agentId]) all[agentId] = {};
  all[agentId][alias] = { id: resolvedId, at: Date.now() };
  saveResolved(all);
  return true;
}

export function labelFor(id: string): string {
  if (!id || typeof id !== 'string') return '';
  let str = id.trim();
  const has1m = /\[1m\]/i.test(str);
  str = str.replace(/\[1m\]/gi, '');

  // Drop 8-digit date suffix: e.g. -20251001
  str = str.replace(/-\d{8}$/, '');

  // Pattern 1: claude-<family>-<version>(-<suffix>)? e.g. claude-opus-5-5, claude-haiku-4-5
  const m1 = str.match(/^claude-([a-z]+)-(\d+(?:-\d+)*)(?:-([a-z]+))?$/i);
  if (m1) {
    const family = m1[1].charAt(0).toUpperCase() + m1[1].slice(1).toLowerCase();
    const version = m1[2].replace(/-/g, '.');
    const suffix = m1[3] ? ` (${m1[3].charAt(0).toUpperCase() + m1[3].slice(1).toLowerCase()})` : '';
    const m1Text = has1m ? ' (1M)' : '';
    return `Claude ${family} ${version}${suffix}${m1Text}`;
  }

  // Pattern 2: claude-<version>-<family>(-<suffix>)? e.g. claude-3-5-sonnet
  const m2 = str.match(/^claude-(\d+(?:-\d+)*)-([a-z]+)(?:-([a-z]+))?$/i);
  if (m2) {
    const version = m2[1].replace(/-/g, '.');
    const family = m2[2].charAt(0).toUpperCase() + m2[2].slice(1).toLowerCase();
    const suffix = m2[3] ? ` (${m2[3].charAt(0).toUpperCase() + m2[3].slice(1).toLowerCase()})` : '';
    const m1Text = has1m ? ' (1M)' : '';
    return `Claude ${family} ${version}${suffix}${m1Text}`;
  }

  if (has1m) {
    return `${str} (1M)`;
  }

  return id;
}

export function timeAgo(at: number): string {
  const diff = Date.now() - at;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
