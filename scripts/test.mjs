#!/usr/bin/env node
// Runs every test/*.test.mjs with node:test. A tiny runner so `npm test` works the same in every
// shell (cmd.exe does not expand globs, and Node 18 does not expand them itself).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => path.join(dir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
// On GitHub, repeat each failure as an annotation so it shows on the pull request itself.
if (process.env.GITHUB_ACTIONS && r.status !== 0) {
  const lines = (r.stdout || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = /^\s*(?:not ok \d+ - |✖ )(.+)$/.exec(line);
    if (!m) return;
    const detail = lines.slice(i + 1, i + 40).filter((l) => /error:|expected|actual|Error|ENOENT|EPERM|message/.test(l)).slice(0, 6).join(' | ');
    console.log(`::error title=${m[1].slice(0, 120)}::${detail.replace(/\s+/g, ' ').slice(0, 900)}`);
  });
}
process.exit(r.status ?? 1);
