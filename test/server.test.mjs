// The local server's API, as the game in the browser meets it: a real server on a free port, real HTTP.
// Routes that start the AI agent (ask, simulate, challenge, run, tasks/dispatch, remap) are never called here.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startServer } from '../server/server.mjs';
import { sampleRepo, tmp, cleanup } from './helpers.mjs';

// The tests must not read (or depend on) the settings of whoever runs them.
process.env.XDG_CONFIG_HOME = tmp('home');
after(cleanup);

const KEY = 'x-codequest-token';

// Start a server for `repo`, hand the test a small client, and always shut the server down again.
async function withServer(repo, opts, run) {
  const s = await startServer({ repo, port: 0, opts: { noTests: true, player: 'tester', ...opts } });
  const base = `http://127.0.0.1:${s.port}`;
  const api = async (method, route, body) => {
    const r = await fetch(base + route, { method, headers: { [KEY]: s.token, 'content-type': 'application/json' }, body });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, type: r.headers.get('content-type') || '', text, json };
  };
  try { return await run({ ...s, base, api }); }
  finally { s.server.close(); s.server.closeAllConnections?.(); }
}
const progressDir = (repo) => path.join(repo, '.codequest', 'progress');
const progressFile = (repo, player = 'tester') => path.join(progressDir(repo), player + '.json');

test('GET /api/world returns the built world, a sync report and no saved state yet', async () => {
  const repo = sampleRepo();
  await withServer(repo, {}, async ({ api }) => {
    const r = await api('GET', '/api/world');
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    const { world, sync, state } = r.json;
    assert.deepEqual(world.worlds.map((w) => w.id), ['one', 'two']);
    const pin = world.worlds[0].entities[0].source[0];
    assert.ok(pin.snippet.includes('export function handle'), 'pins arrive with their code');
    assert.match(pin.fileHash, /^[0-9a-f]{40}$/);
    assert.equal(sync.worlds.one.status, 'synced');
    assert.equal(sync.entities['two/save'], 'synced');
    assert.equal(sync.commitsSinceMap, 0);
    assert.equal(state, null);
  });
});

test('PUT /api/state is what the next GET returns, and it lands in .codequest/progress/', async () => {
  const repo = sampleRepo();
  const saved = { v: 1, xp: 25, missions: { 'one/f/c1': 2 }, notes: ['first'] };
  await withServer(repo, {}, async ({ api }) => {
    const put = await api('PUT', '/api/state', JSON.stringify(saved));
    assert.equal(put.status, 200);
    assert.deepEqual(put.json, { ok: true });
    assert.deepEqual(fs.readdirSync(progressDir(repo)), ['tester.json']);
    assert.deepEqual(JSON.parse(fs.readFileSync(progressFile(repo), 'utf8')), saved);
    assert.deepEqual((await api('GET', '/api/world')).json.state, saved);
  });
  // a new run of the server (a new key) still finds the progress
  await withServer(repo, {}, async ({ api }) => {
    assert.deepEqual((await api('GET', '/api/world')).json.state, saved);
  });
});

test('each player gets their own progress file, and a player name cannot leave the progress folder', async () => {
  const repo = sampleRepo();
  await withServer(repo, { player: '../../escape/me' }, async ({ api }) => {
    assert.equal((await api('PUT', '/api/state', '{"xp":1}')).status, 200);
  });
  await withServer(repo, { player: 'ann' }, async ({ api }) => {
    assert.equal((await api('GET', '/api/world')).json.state, null, 'ann does not see the other player');
    assert.equal((await api('PUT', '/api/state', '{"xp":2}')).status, 200);
  });
  const files = fs.readdirSync(progressDir(repo)).sort();
  assert.equal(files.length, 2);
  assert.ok(files.includes('ann.json'));
  for (const f of files) assert.match(f, /^[\w.-]+\.json$/);
  assert.equal(fs.existsSync(path.join(repo, 'escape')), false);
  assert.equal(fs.existsSync(path.join(repo, '..', 'escape')), false);
});

test('POST /api/sync reports code that changed while the game is open', async () => {
  const repo = sampleRepo();
  await withServer(repo, {}, async ({ api }) => {
    assert.equal((await api('POST', '/api/sync', '{}')).json.worlds.one.status, 'synced');
    const app = path.join(repo, 'src', 'app.js');
    fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace('if (!req.user)', 'if (req.user == null)'));
    const r = await api('POST', '/api/sync', '{}');
    assert.equal(r.status, 200);
    assert.equal(r.json.worlds.one.status, 'stale');
    assert.equal(r.json.entities['one/auth'], 'stale');
    assert.equal(r.json.remote, null, 'the remote is only contacted when asked');
  });
});

test('a repo with no map answers 404 with a sentence a person can act on', async () => {
  await withServer(tmp('nomap'), {}, async ({ api }) => {
    const r = await api('GET', '/api/world');
    assert.equal(r.status, 404);
    assert.match(r.json.error, /No map yet/);
  });
});

test('an unknown route is a 404, for the API and for files', async () => {
  await withServer(sampleRepo(), {}, async ({ api, base }) => {
    const a = await api('GET', '/api/nope');
    assert.equal(a.status, 404);
    assert.deepEqual(a.json, { error: 'not found' });
    assert.equal((await api('DELETE', '/api/world')).status, 404, 'a known path with another method is not a route');
    assert.equal((await api('GET', '/api/jobs/none')).status, 404);
    assert.equal((await fetch(base + '/no-such-file.js')).status, 404);
    assert.equal((await fetch(base + '/js')).status, 404, 'a folder is not a file');
  });
});

test('the page and every script it names are served, with the live settings as inert JSON', async () => {
  await withServer(sampleRepo(), {}, async ({ base, token }) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    const conf = JSON.parse(/<script type="application\/json" id="cw-config">(.*?)<\/script>/s.exec(html)[1]);
    assert.equal(conf.mode, 'live');
    assert.equal(conf.testCommand, null);
    assert.ok(!JSON.stringify(conf).includes(token));
    const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length > 0);
    for (const src of [...srcs, 'style.css']) {
      const r = await fetch(base + '/' + src);
      assert.equal(r.status, 200, src);
      assert.match(r.headers.get('content-type'), src.endsWith('.css') ? /text\/css/ : /text\/javascript/, src);
      await r.arrayBuffer();
    }
  });
});

test('anything but GET on a file path is a 405', async () => {
  await withServer(sampleRepo(), {}, async ({ base }) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const route of ['/', '/index.html', '/js/main.js', '/no-such-file']) {
        const r = await fetch(base + route, { method, body: method === 'DELETE' ? undefined : 'x' });
        assert.equal(r.status, 405, `${method} ${route}`);
        await r.arrayBuffer();
      }
    }
  });
});

test('a body that is not a JSON object is an error, saves nothing, and the server keeps answering', async () => {
  const repo = sampleRepo();
  await withServer(repo, {}, async ({ api }) => {
    for (const body of ['[1,2]', 'null', '"text"', '42', 'true', '{ not json', '\u0000']) {
      const r = await api('PUT', '/api/state', body);
      assert.ok(r.status >= 400 && r.status < 600, `${JSON.stringify(body)} → ${r.status}`);
      assert.equal(typeof r.json?.error, 'string', `${JSON.stringify(body)} gets an error message`);
      assert.equal(fs.existsSync(progressFile(repo)), false, `${JSON.stringify(body)} is not saved`);
    }
    assert.equal((await api('GET', '/api/world')).status, 200);
  });
});

// A raw request on its own connection: fetch() may or may not show a reply that arrives mid-upload.
function rawPut(port, token, body) {
  return new Promise((resolve) => {
    const req = http.request({ agent: false, host: '127.0.0.1', port, path: '/api/state', method: 'PUT',
      headers: { [KEY]: token, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text }));
      res.on('error', (e) => resolve({ dropped: e.code || e.message }));
    });
    req.on('error', (e) => resolve({ dropped: e.code || e.message }));
    req.end(body);
  });
}

test('a body over the size limit is refused and never reaches the disk; one just under it is saved', async () => {
  const repo = sampleRepo();
  await withServer(repo, {}, async ({ api, port, token }) => {
    for (const size of [2_100_000, 40_000_000]) {
      const r = await rawPut(port, token, JSON.stringify({ pad: 'x'.repeat(size) }));
      // Either the refusal arrives, or the server hangs up on the upload. It must never be accepted.
      if (!r.dropped) {
        assert.ok(r.status >= 400, `${size} bytes → ${r.status}`);
        assert.match(r.text, /too large/);
      }
      assert.equal(fs.existsSync(progressFile(repo)), false, `${size} bytes were not saved`);
    }
    assert.equal((await api('GET', '/api/world')).status, 200, 'the server is still up');
    const ok = await rawPut(port, token, JSON.stringify({ pad: 'x'.repeat(1_900_000) }));
    assert.equal(ok.status, 200, JSON.stringify(ok).slice(0, 200));
    assert.equal(JSON.parse(fs.readFileSync(progressFile(repo), 'utf8')).pad.length, 1_900_000);
  });
});

test('saved state with non-English text comes back exactly as it was sent', async () => {
  const repo = sampleRepo();
  const note = 'שלום עולם — héllo 🚀 '.repeat(20_000); // about 600 KB, so it arrives in many chunks
  await withServer(repo, {}, async ({ api, port, token }) => {
    assert.equal((await rawPut(port, token, JSON.stringify({ notes: [note] }))).status, 200);
    const back = (await api('GET', '/api/world')).json.state.notes[0];
    assert.equal(back.includes('�'), false, 'the saved text holds replacement characters');
    assert.equal(back, note);
  });
});

test('short non-English text in saved state does come back as sent', async () => {
  const repo = sampleRepo();
  const saved = { notes: ['שלום — héllo 🚀'] };
  await withServer(repo, {}, async ({ api }) => {
    assert.equal((await api('PUT', '/api/state', JSON.stringify(saved))).status, 200);
    assert.deepEqual((await api('GET', '/api/world')).json.state, saved);
  });
});
