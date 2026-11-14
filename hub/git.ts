// Git helpers for per-chat branches (worktrees), per-run checkpoints, diffs, undo and merge.
// Every command runs through execFile (no shell). Checkpoint/merge commits use a fixed local identity, so they
// work even when user.name/user.email are not configured; they never touch the user's global git config.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

import type { ChangedFile } from './types.js';

export interface GitResult { code: number; stdout: string; stderr: string }

const IDENTITY = ['-c', 'user.name=Agent Hub', '-c', 'user.email=agent-hub@localhost'];
const MAX_PATCH = 300_000;

export function git(cwd: string, args: string[], timeoutMs = 120_000): Promise<GitResult> {
  return new Promise(resolve => {
    execFile('git', args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: unknown }) | null;
      const code = !e ? 0 : typeof e.code === 'number' ? e.code : 1;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr || (e ? e.message : '')) });
    });
  });
}

async function must(cwd: string, args: string[], what: string): Promise<string> {
  const r = await git(cwd, args);
  if (r.code !== 0) throw new Error(`${what}: ${(r.stderr || r.stdout).trim().slice(-800)}`);
  return r.stdout;
}

export async function isRepo(dir: string): Promise<boolean> {
  const r = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

// Uncommitted or untracked files (not ignored). A new branch starts from the last commit and would not have them.
export async function pendingChanges(dir: string): Promise<number> {
  const out = (await must(dir, ['status', '--porcelain', '-z'], 'git status')).split('\0').filter(Boolean);
  return out.length;
}

const isIgnored = async (cwd: string, rel: string) => (await git(cwd, ['check-ignore', '-q', rel])).code === 0;

// Creates a new branch in its own folder. node_modules is linked (junction) and listed files are copied from the
// project, but only when git ignores them, so they can never end up in a commit.
export async function createWorktree(projectDir: string, wtDir: string, branch: string, copyFiles: string[]): Promise<string> {
  fs.mkdirSync(path.dirname(wtDir), { recursive: true });
  await must(projectDir, ['worktree', 'add', '-b', branch, wtDir, 'HEAD'], 'Could not create the branch');
  const base = (await must(wtDir, ['rev-parse', 'HEAD'], 'git rev-parse')).trim();

  const nm = path.join(projectDir, 'node_modules');
  const wtNm = path.join(wtDir, 'node_modules');
  if (fs.existsSync(nm) && !fs.existsSync(wtNm) && await isIgnored(wtDir, 'node_modules')) {
    try { fs.symlinkSync(nm, wtNm, 'junction'); } catch {}
  }
  for (const rel of copyFiles) {
    if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) continue;
    const src = path.join(projectDir, rel);
    const dst = path.join(wtDir, rel);
    if (fs.existsSync(src) && fs.statSync(src).isFile() && !fs.existsSync(dst) && await isIgnored(wtDir, rel)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  return base;
}

// Removes the branch folder and the branch. The node_modules junction is unlinked first so that removing the
// folder can never reach into the real project's node_modules.
export async function removeWorktree(projectDir: string, wtDir: string, branch: string): Promise<void> {
  const wtNm = path.join(wtDir, 'node_modules');
  try {
    if (fs.lstatSync(wtNm).isSymbolicLink()) {
      try { fs.unlinkSync(wtNm); } catch { fs.rmdirSync(wtNm); }
    }
  } catch {}
  if (fs.existsSync(path.join(wtDir, 'node_modules'))) throw new Error('node_modules in the branch folder could not be unlinked; not removing it.');
  await git(projectDir, ['worktree', 'remove', '--force', wtDir]);
  await git(projectDir, ['worktree', 'prune']);
  await git(projectDir, ['branch', '-D', branch]);
}

// Commits everything the agent changed in a branch folder. Returns the commit, or null when nothing changed.
export async function checkpoint(wtDir: string, message: string): Promise<string | null> {
  await must(wtDir, ['add', '-A'], 'git add');
  if ((await git(wtDir, ['diff', '--cached', '--quiet'])).code === 0) return null;
  await must(wtDir, [...IDENTITY, 'commit', '-q', '-m', message], 'Checkpoint commit failed');
  return (await must(wtDir, ['rev-parse', 'HEAD'], 'git rev-parse')).trim();
}

// Snapshot of the working tree before a run in "direct" mode (no branch): a stash-like commit that does not touch
// the files or the stash list, plus the untracked files that already existed.
export async function snapshot(dir: string): Promise<{ ref: string; untracked: string[] }> {
  const created = (await git(dir, ['stash', 'create'])).stdout.trim();
  const ref = created || (await must(dir, ['rev-parse', 'HEAD'], 'git rev-parse')).trim();
  return { ref, untracked: await untrackedFiles(dir) };
}

export async function untrackedFiles(dir: string): Promise<string[]> {
  const out = (await git(dir, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout;
  return out.split('\0').filter(Boolean);
}

// Files changed between two refs (or a ref and the working tree), with line counts.
export async function changedFiles(dir: string, from: string, to?: string): Promise<ChangedFile[]> {
  const range = to ? [from, to] : [from];
  const nameStatus = (await must(dir, ['diff', '--no-renames', '--name-status', '-z', ...range], 'git diff')).split('\0');
  const numstat = (await must(dir, ['diff', '--no-renames', '--numstat', '-z', ...range], 'git diff')).split('\0');
  const counts = new Map<string, { added: number | null; removed: number | null }>();
  for (const entry of numstat) {
    const m = entry.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (m) counts.set(m[3], { added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]) });
  }
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < nameStatus.length; i += 2) {
    const status = nameStatus[i];
    const file = nameStatus[i + 1];
    if (!status || !file) continue;
    files.push({ path: file, status: status[0], ...(counts.get(file) || { added: null, removed: null }) });
  }
  return files;
}

export async function diffText(dir: string, from: string, to?: string): Promise<{ patch: string; truncated: boolean }> {
  const out = await must(dir, ['diff', '--no-renames', '--no-color', from, ...(to ? [to] : [])], 'git diff');
  return out.length > MAX_PATCH ? { patch: out.slice(0, MAX_PATCH), truncated: true } : { patch: out, truncated: false };
}

// Undo one checkpoint in a branch folder with a new "revert" commit (works for older runs too).
export async function revertCommit(wtDir: string, commit: string): Promise<void> {
  const r = await git(wtDir, [...IDENTITY, 'revert', '--no-edit', commit]);
  if (r.code !== 0) {
    await git(wtDir, ['revert', '--abort']);
    throw new Error(`Could not undo (later changes touch the same lines): ${(r.stderr || r.stdout).trim().slice(-600)}`);
  }
}

// Undo a direct-mode run: reverse-apply its patch (only if the files still match) and delete files it created.
export async function reverseApply(dir: string, patchFile: string, createdFiles: string[]): Promise<void> {
  if (fs.statSync(patchFile).size > 0) {
    const check = await git(dir, ['apply', '-R', '--check', patchFile]);
    if (check.code !== 0) throw new Error(`Could not undo: the files were changed again since. ${(check.stderr || '').trim().slice(-600)}`);
    await must(dir, ['apply', '-R', patchFile], 'git apply');
  }
  for (const rel of createdFiles) {
    if (rel.split(/[\\/]/).includes('..')) continue;
    fs.rmSync(path.join(dir, rel), { force: true });
  }
}

// Brings a chat's branch into the project's current branch.
export async function mergeBranch(projectDir: string, branch: string, message: string): Promise<string> {
  const r = await git(projectDir, [...IDENTITY, 'merge', '--no-ff', '-m', message, branch]);
  if (r.code !== 0) {
    await git(projectDir, ['merge', '--abort']);
    throw new Error(`Merge failed and was cancelled, so your project is unchanged. ${(r.stderr || r.stdout).trim().slice(-800)}`);
  }
  return r.stdout.trim();
}
