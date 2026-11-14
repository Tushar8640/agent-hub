// Project discovery and path management across configured project roots.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Project } from './types.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor']);

function isProjectFolder(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (
        name === '.git' ||
        name === 'package.json' ||
        name === 'pyproject.toml' ||
        name === 'go.mod' ||
        name === 'Cargo.toml' ||
        name === 'composer.json' ||
        name.endsWith('.sln')
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

export function stableId(realPath: string): string {
  const base = path.basename(realPath).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  const prefix = (base.slice(0, 30) || 'proj').replace(/^-+/, '') || 'proj';
  const hash = crypto.createHash('sha1').update(realPath.toLowerCase()).digest('hex').slice(0, 6);
  return `${prefix}-${hash}`;
}

export function insideRoots(p: string, roots: string[]): boolean {
  if (!p || !roots || !roots.length) return false;
  let real: string;
  try {
    real = fs.realpathSync(p);
  } catch {
    return false;
  }
  const isWin = process.platform === 'win32';
  const normTarget = isWin ? real.toLowerCase() : real;

  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      continue;
    }
    const normRoot = isWin ? realRoot.toLowerCase() : realRoot;
    if (normTarget === normRoot || normTarget.startsWith(normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep)) {
      return true;
    }
  }
  return false;
}

export function discover(roots: string[], depth = 2): Project[] {
  const projects: Project[] = [];
  const seenRealPaths = new Set<string>();
  const isWin = process.platform === 'win32';

  for (const root of roots) {
    if (projects.length >= 500) break;
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      continue;
    }

    const queue: { dir: string; currentDepth: number }[] = [{ dir: realRoot, currentDepth: 0 }];

    while (queue.length > 0 && projects.length < 500) {
      const { dir, currentDepth } = queue.shift()!;

      if (currentDepth > 0) {
        if (isProjectFolder(dir)) {
          let realDir = dir;
          try { realDir = fs.realpathSync(dir); } catch {}
          const norm = isWin ? realDir.toLowerCase() : realDir;
          if (!seenRealPaths.has(norm)) {
            seenRealPaths.add(norm);
            projects.push({
              id: stableId(realDir),
              name: path.basename(realDir),
              path: realDir,
              missing: false,
              git: false,
              branchCopy: [],
              source: 'discovered',
            });
          }
          // Don't look inside a folder once it has been found as a project
          continue;
        }
      }

      if (currentDepth < depth) {
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const name = entry.name;
          if (name.startsWith('.') || SKIP_DIRS.has(name.toLowerCase())) continue;
          const subDir = path.join(dir, name);
          queue.push({ dir: subDir, currentDepth: currentDepth + 1 });
        }
      }
    }
  }

  return projects;
}

export function mergeProjects(
  configProjects: Project[],
  discovered: Project[],
  addedPaths: string[],
  roots: string[]
): Project[] {
  const result: Project[] = [];
  const seenRealPaths = new Set<string>();
  const isWin = process.platform === 'win32';

  const toKey = (p: string) => {
    try {
      const real = fs.realpathSync(p);
      return isWin ? real.toLowerCase() : real;
    } catch {
      return isWin ? path.resolve(p).toLowerCase() : path.resolve(p);
    }
  };

  // 1. Config entries win
  for (const p of configProjects) {
    const key = toKey(p.path);
    seenRealPaths.add(key);
    p.missing = !fs.existsSync(p.path) || !fs.statSync(p.path).isDirectory();
    p.source = 'config';
    result.push(p);
  }

  // 2. Added entries from settings
  for (const p of addedPaths) {
    if (!fs.existsSync(p)) continue;
    let real = p;
    try { real = fs.realpathSync(p); } catch {}
    if (!insideRoots(real, roots)) continue;
    const key = toKey(real);
    if (seenRealPaths.has(key)) continue;
    seenRealPaths.add(key);
    result.push({
      id: stableId(real),
      name: path.basename(real),
      path: real,
      missing: !fs.existsSync(real) || !fs.statSync(real).isDirectory(),
      git: false,
      branchCopy: [],
      source: 'added',
    });
  }

  // 3. Discovered entries
  for (const p of discovered) {
    const key = toKey(p.path);
    if (seenRealPaths.has(key)) continue;
    seenRealPaths.add(key);
    p.missing = !fs.existsSync(p.path) || !fs.statSync(p.path).isDirectory();
    p.source = 'discovered';
    result.push(p);
  }

  return result;
}
