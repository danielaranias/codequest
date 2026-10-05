// CodeQuest local server: serves the game for one repo and bridges it to the user's agent.
// Binds to 127.0.0.1 only. Every API call needs the per-run token, which is handed over in the
// URL fragment printed in the terminal (never served in the page itself).
//
// Trust model: the repository being played is UNTRUSTED input. It may not choose commands,
// agents or settings; map text is data; the agent's tools are confined to the repo or worktree.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { readWorld, syncReport, git, cwDir, build } from './lib/world.mjs';
import { runAgent, parseJson, defaultAgent, readTools, editTools, NO_NETWORK_NO_SHELL } from './lib/agent.mjs';
import { P, checkFound } from './lib/prompts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'game');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

// Shown in the game and in the terminal, so a player can tell which version is really running.
export const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch { return '?'; } })();

export function userConfigPath() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'codequest', 'config.json');
}

/**
 * Settings come from three places, in this order of trust:
 *   1. command-line flags (opts)                              — the user, right now
 *   2. ~/.config/codequest/config.json                        — the user, earlier
 *   3. <repo>/.codequest/config.json                          — the REPO: only `player` is read
 * A repo can never set the agent or the test command: both run code on this machine.
 */
export function loadConfig(repo, opts = {}) {
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
  const user = readJson(userConfigPath());
  const repoCfg = readJson(path.join(cwDir(repo), 'config.json'));
  const ignored = ['agent', 'testCommand', 'model'].filter((k) => k in repoCfg);
  const mine = user.repos?.[path.resolve(repo)] || {};
  const kind = opts.agent || user.agent?.kind || 'claude';
  if (!['claude', 'codex'].includes(kind)) throw new Error(`Unknown agent "${kind}". Use claude or codex.`);
  const agent = { kind, command: kind, model: opts.model || user.agent?.model || user.model };
  let testCommand = null, testSource = null;
  if (opts.noTests) testSource = 'off';
  else if (opts.test) { testCommand = String(opts.test); testSource = 'flag'; }
  else if (mine.testCommand) { testCommand = String(mine.testCommand); testSource = 'your config'; }
  else { testCommand = detectTest(repo); testSource = testCommand ? 'detected' : null; }
  const player = String(opts.player || user.player || repoCfg.player || os.userInfo().username || 'player').slice(0, 40);
  return { player, agent, testCommand, testSource, ignored };
}
// Only fixed, well-known commands are ever auto-detected. They still run the repo's own test code.
function detectTest(repo) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
    if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) return 'npm test --silent';
  } catch {}
  if (fs.existsSync(path.join(repo, 'pytest.ini')) || fs.existsSync(path.join(repo, 'pyproject.toml')) && fs.existsSync(path.join(repo, 'tests'))) return 'python -m pytest -q';
  if (fs.existsSync(path.join(repo, 'go.mod'))) return 'go test ./...';
  if (fs.existsSync(path.join(repo, 'Cargo.toml'))) return 'cargo test';
  return null;
}

// ---------- jobs ----------
const jobs = new Map();
function newJob(kind, fn) {
  const id = kind + '-' + crypto.randomBytes(4).toString('hex');
  const job = { id, kind, status: 'running', log: [], result: null, startedAt: new Date().toISOString() };
  jobs.set(id, job);
  const log = (l) => { for (const line of String(l).split('\n')) if (line.trim()) job.log.push(line); if (job.log.length > 400) job.log.splice(0, job.log.length - 400); };
  Promise.resolve().then(() => fn(log, job)).then((r) => { job.result = r || null; job.status = 'done'; })
    .catch((e) => { log('✗ ' + (e.message || e)); job.status = 'failed'; job.result = { summary: e.message }; })
    .finally(() => { job.endedAt = new Date().toISOString(); });
  return job;
}

function sh(cmd, cwd, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, env: { ...process.env, CI: '1' } });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); out += '\n[stopped: took longer than ' + timeoutMs / 1000 + 's]'; }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.slice(-20000) }); });
  });
}

function addWorktree(repo, { branch } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codequest-'));
  fs.rmdirSync(dir);
  const args = branch ? ['worktree', 'add', '-b', branch, dir, 'HEAD'] : ['worktree', 'add', '--detach', dir, 'HEAD'];
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  // reuse installed dependencies so tests can run
  for (const dep of DEP_LINKS) {
    const src = path.join(repo, dep);
    if (fs.existsSync(src) && !fs.existsSync(path.join(dir, dep))) { try { fs.symlinkSync(src, path.join(dir, dep)); } catch {} }
  }
  return dir;
}
const DEP_LINKS = ['node_modules', '.venv', 'venv'];
function dropDepLinks(dir) {
  for (const dep of DEP_LINKS) { try { if (fs.lstatSync(path.join(dir, dep)).isSymbolicLink()) fs.unlinkSync(path.join(dir, dep)); } catch {} }
}
function removeWorktree(repo, dir) {
  try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo, stdio: 'pipe' }); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ---------- server ----------
export function startServer({ repo, port = 4477, opts = {} }) {
  const host = '127.0.0.1'; // loopback only, by design: there is no flag to change it
  repo = fs.realpathSync(path.resolve(repo));
  const token = crypto.randomBytes(24).toString('hex');
  const tokenBuf = Buffer.from(token);
  const cfg = loadConfig(repo, opts);
  const progressPath = path.join(cwDir(repo), 'progress', cfg.player.replace(/[^\w.-]/g, '_') + '.json');
  const pluginRoot = ROOT;

  const getWorld = () => {
    const W = readWorld(repo);
    if (!W) { const e = new Error('No map yet. Map this repo first (the codequest-map skill).'); e.status = 404; throw e; }
    return W;
  };
  const focusOf = (W, b) => {
    const w = W.worlds.find((x) => x.id === b.worldId);
    if (!w) throw new Error('Unknown world ' + b.worldId);
    return { w, entity: w.entities.find((e) => e.id === b.entityId), flow: w.flows.find((f) => f.id === b.flowId) };
  };
  const agentOpts = { agent: cfg.agent };
  const READ_ONLY = { tools: readTools(repo), deny: NO_NETWORK_NO_SHELL };

  const routes = {
    'GET /api/world': () => {
      const W = getWorld();
      let state = null;
      try { state = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch {}
      return { world: W, sync: syncReport(W, repo), state };
    },
    'PUT /api/state': (b) => {
      fs.mkdirSync(path.dirname(progressPath), { recursive: true });
      fs.writeFileSync(progressPath, JSON.stringify(b, null, 1));
      return { ok: true };
    },
    'POST /api/sync': (b) => syncReport(getWorld(), repo, { fetchRemote: !!b.fetch }),
    'POST /api/pull': () => {
      const dirty = (git(repo, ['status', '--porcelain']) || '').trim();
      if (dirty) throw new Error('You have uncommitted changes. Commit or stash them, then pull.');
      const out = git(repo, ['pull', '--ff-only'], { allowFail: true });
      if (out == null) throw new Error('Pull failed (not a fast-forward?). Pull from your terminal to sort it out.');
      return { message: out.split('\n').slice(-1)[0] || 'Pulled' };
    },
    'POST /api/ask': async (b) => {
      const W = getWorld(); const f = focusOf(W, b);
      const r = await runAgent({ ...agentOpts, cwd: repo, ...READ_ONLY, prompt: P.ask(W, f.w, f, String(b.question || '').slice(0, 4000)), timeoutMs: 5 * 60 * 1000 });
      return { text: r.text };
    },
    // Search by meaning: the player describes a symptom, the agent points at the flows and buildings behind it.
    'POST /api/find': async (b) => {
      const W = getWorld();
      const query = String(b.query || '').trim().slice(0, 600);
      if (!query) return { results: [], note: '' };
      const r = await runAgent({ ...agentOpts, cwd: repo, ...READ_ONLY, prompt: P.find(W, query, true), timeoutMs: 3 * 60 * 1000 });
      return checkFound(W, parseJson(r.text));
    },
    'POST /api/simulate': async (b) => {
      const W = getWorld(); const f = focusOf(W, b);
      if (!f.flow) throw new Error('Unknown flow');
      const r = await runAgent({ ...agentOpts, cwd: repo, ...READ_ONLY, prompt: P.simulate(W, f.w, f.flow, String(b.input || '').slice(0, 4000), String(b.change || '').slice(0, 6000)), timeoutMs: 6 * 60 * 1000 });
      return parseJson(r.text);
    },
    'POST /api/challenge': async (b) => {
      const W = getWorld(); const f = focusOf(W, b);
      if (!f.entity) throw new Error('Unknown entity');
      const r = await runAgent({ ...agentOpts, cwd: repo, ...READ_ONLY, prompt: P.challenge(W, f.w, f.entity, String(b.claim || '').slice(0, 4000)), timeoutMs: 5 * 60 * 1000 });
      return parseJson(r.text);
    },
    'POST /api/run': (b) => {
      const W = getWorld(); const f = focusOf(W, b);
      if (!f.flow) throw new Error('Unknown flow');
      const job = newJob('run', async (log) => {
        const dirty = (git(repo, ['status', '--porcelain']) || '').trim();
        if (dirty) log('Note: the sandbox starts from your last commit; uncommitted edits are not included.');
        log('Creating a throwaway worktree…');
        const dir = addWorktree(repo);
        try {
          log('Asking the agent to make the change…');
          const r = await runAgent({ ...agentOpts, cwd: dir, tools: [...readTools(dir), ...editTools(dir)], deny: NO_NETWORK_NO_SHELL, write: true, permissionMode: 'acceptEdits', prompt: P.sandboxChange(W, f.w, f.flow, String(b.change).slice(0, 6000)), onLog: log });
          const diff = git(dir, ['diff']) || '';
          if (!diff) log('The agent made no file changes.');
          if (!cfg.testCommand) {
            log('No test command. Start CodeQuest with --test "<your test command>" to run tests here.');
            return { passed: null, diff, summary: r.text + '\n(No tests were run.)' };
          }
          log('Running tests: ' + cfg.testCommand);
          const t = await sh(cfg.testCommand, dir);
          log(t.out.split('\n').slice(-40).join('\n'));
          return { passed: t.code === 0, diff, summary: r.text, testCommand: cfg.testCommand };
        } finally { removeWorktree(repo, dir); log('Sandbox removed.'); }
      });
      return { jobId: job.id };
    },
    'POST /api/tasks/dispatch': (b) => {
      const id = String(b.id || crypto.randomBytes(3).toString('hex')).replace(/[^\w-]/g, '');
      const branch = 'codequest/task-' + id;
      if (git(repo, ['rev-parse', '--verify', '--quiet', branch])) throw new Error(`Branch ${branch} already exists`);
      const job = newJob('task', async (log) => {
        log(`Creating branch ${branch} in a separate worktree…`);
        const dir = addWorktree(repo, { branch });
        try {
          const r = await runAgent({ ...agentOpts, cwd: dir, tools: [...readTools(dir), ...editTools(dir)], deny: NO_NETWORK_NO_SHELL, write: true, permissionMode: 'acceptEdits', prompt: P.task({ ...b, id }), onLog: log, timeoutMs: 20 * 60 * 1000 });
          let passed = null;
          if (cfg.testCommand) {
            log('Running tests: ' + cfg.testCommand);
            const t = await sh(cfg.testCommand, dir);
            passed = t.code === 0;
            log(t.out.split('\n').slice(-25).join('\n'));
            log(passed ? '✓ Tests passed' : '✗ Tests failed');
          }
          dropDepLinks(dir); // never commit the borrowed node_modules / venv links
          if ((git(dir, ['status', '--porcelain']) || '').trim()) {
            git(dir, ['add', '-A']);
            git(dir, ['commit', '-m', `codequest: ${String(b.title || 'task').slice(0, 70)}`, '-m', String(r.text || '').slice(0, 1500)]);
            log('Committed on ' + branch + '.');
          } else log('The agent made no changes.');
          const commits = git(repo, ['rev-list', '--count', `HEAD..${branch}`]);
          return { summary: r.text.slice(-800) + (passed === null ? '' : passed ? '\nTests passed.' : '\nTests failed — review before merging.'), branch, commits: Number(commits || 0), passed };
        } finally { removeWorktree(repo, dir); }
      });
      return { jobId: job.id, branch };
    },
    'POST /api/remap': (b) => {
      const W = getWorld();
      const ids = (b.worlds || []).filter((id) => W.worlds.some((w) => w.id === id));
      const all = ids.length === W.worlds.length;
      const job = newJob('remap', async (log) => {
        log(`Re-mapping ${all ? 'everything' : ids.join(', ')}…`);
        // The mapper reads the repo and this tool's own docs, and may write only inside .codequest/.
        // No shell at all: the server runs the build itself below.
        const tools = [...readTools(repo, pluginRoot), ...editTools(cwDir(repo))];
        let r, res, errors = null;
        for (let pass = 1; pass <= 2; pass++) {
          r = await runAgent({ ...agentOpts, cwd: repo, tools, deny: NO_NETWORK_NO_SHELL, write: true, permissionMode: 'acceptEdits', prompt: P.remap(pluginRoot, ids, all, errors), onLog: log, timeoutMs: 30 * 60 * 1000 });
          res = build(repo);
          if (!res.errors.length) break;
          errors = res.errors;
          log(`Build found ${errors.length} error(s)${pass < 2 ? ' — handing them back to the agent' : ''}.`);
        }
        if (res.errors.length) throw new Error('Map still has errors: ' + res.errors.slice(0, 5).join('; '));
        log('Map rebuilt and validated.');
        return { summary: r.text.slice(-600) };
      });
      return { jobId: job.id };
    },
  };

  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const tokenOk = (given) => {
    const g = Buffer.from(String(given || ''));
    return g.length === tokenBuf.length && crypto.timingSafeEqual(g, tokenBuf);
  };
  const server = http.createServer(async (req, res) => {
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, {
        'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': CSP,
      });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    // only answer to localhost names (blocks DNS-rebinding)
    const hostHdr = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(hostHdr)) return send(403, { error: 'forbidden host' });
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!tokenOk(req.headers['x-codequest-token'])) return send(401, { error: 'bad token — open the link CodeQuest printed in your terminal' });
        if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
          const j = jobs.get(decodeURIComponent(url.pathname.slice(10)));
          return j ? send(200, j) : send(404, { error: 'no such job' });
        }
        const fn = routes[`${req.method} ${url.pathname}`];
        if (!fn) return send(404, { error: 'not found' });
        let body = {};
        if (req.method !== 'GET') {
          // collect bytes and decode once: decoding per chunk breaks characters split across chunks
          const chunks = [];
          let size = 0;
          for await (const c of req) {
            size += c.length;
            if (size > 2e6) return send(413, { error: 'body too large' });
            chunks.push(c);
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: 'body is not valid JSON' }); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'body must be a JSON object' });
          if (req.method === 'PUT' && !raw) return send(400, { error: 'empty body' });
        }
        return send(200, await fn(body));
      }
      if (req.method !== 'GET') return send(405, 'method not allowed', 'text/plain');
      // static game
      const rel = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = path.join(GAME, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!(file === GAME || file.startsWith(GAME + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'not found', 'text/plain');
      let content = fs.readFileSync(file);
      if (rel === '/index.html') {
        // config is inert JSON (not a script) and holds no secret: the token arrives in the URL fragment
        const conf = { mode: 'live', version: VERSION, repoPath: repo, agent: cfg.agent.kind, testCommand: cfg.testCommand, testSource: cfg.testSource };
        const tag = `<script type="application/json" id="cw-config">${JSON.stringify(conf).replace(/</g, '\\u003c')}</script>`;
        content = String(content).replace('<!--CW:HEAD-->', () => tag);
      }
      return send(200, content, MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      return send(e.status || 500, { error: e.message || String(e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      const p = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${p}/#t=${token}`, port: p, token, config: cfg });
    });
  });
}
