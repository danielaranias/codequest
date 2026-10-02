// Shared by the test files: a throwaway copy of test/fixture as a real git repo, and the CLI as a child process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = path.join(ROOT, 'scripts', 'codequest.mjs');
export const FIXTURE = path.join(ROOT, 'test', 'fixture');

const made = [];
export function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-' + prefix + '-'));
  made.push(d);
  return d;
}
// Call from an `after` hook. Never fails a run: on Windows a folder can still be held for a moment.
export function cleanup() {
  for (const d of made.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
}

export const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
export const commit = (repo, msg) => { git(repo, 'add', '-A'); git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', msg); };

export function sampleRepo() {
  const repo = tmp('repo');
  // leave out anything a contributor's own `play test/fixture` left behind
  fs.cpSync(FIXTURE, repo, { recursive: true, filter: (src) => !/[\\/]\.codequest[\\/](world\.json|progress|\.gitignore)/.test(src) });
  git(repo, 'init', '-q');
  commit(repo, 'init');
  return repo;
}

export const worldFile = (repo, id = 'one') => path.join(repo, '.codequest', 'worlds', id + '.json');
export const builtFile = (repo) => path.join(repo, '.codequest', 'world.json');
export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
// Change one world fragment on disk, the way a mapper (or a mistake) would.
export function editWorld(repo, id, change) {
  const w = readJson(worldFile(repo, id));
  change(w);
  fs.writeFileSync(worldFile(repo, id), JSON.stringify(w, null, 1));
}
export function editMeta(repo, change) {
  const f = path.join(repo, '.codequest', 'meta.json');
  const m = readJson(f);
  change(m);
  fs.writeFileSync(f, JSON.stringify(m, null, 1));
}

const stripColor = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
// Run the real CLI. Output comes back without colour codes.
export function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, out: stripColor(r.stdout), err: stripColor(r.stderr), all: stripColor(r.stdout) + stripColor(r.stderr) };
}

// The lines a pin [a, b] (1-based, inclusive) covers in a file as it is on disk right now.
export function linesOf(file, [a, b]) {
  return fs.readFileSync(file, 'utf8').split('\n').slice(a - 1, b).join('\n');
}
