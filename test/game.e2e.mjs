// The game itself, played in a real browser: export the fixture to one HTML file, open it, play missions.
// Needs Playwright, which is NOT a dependency of this project. Without it every test here is skipped.
//   CI:      npm i --no-save playwright@1 && npx playwright install --with-deps chromium && npm run test:e2e
//   locally: NODE_PATH=<global node_modules that holds playwright> npm run test:e2e
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { sampleRepo, tmp, cleanup, cli, readJson, worldFile } from './helpers.mjs';

// `import` ignores NODE_PATH; require() honours it, and also finds a local node_modules.
let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* not installed: skip below */ }
const skip = chromium ? false : 'Playwright is not installed (see the top of this file for how to run the browser tests)';

// In CI a missing browser must be a red job, never four quiet skips.
test('Playwright is installed where the browser tests are required', { skip: !process.env.CODEQUEST_E2E_REQUIRED }, () => {
  assert.ok(chromium, 'CODEQUEST_E2E_REQUIRED is set but require("playwright") failed');
});

let browser, gameUrl, map;
before(async () => {
  if (!chromium) return;
  const repo = sampleRepo();
  const out = path.join(tmp('game'), 'game.html');
  const r = cli('export', repo, '--out', out);
  assert.equal(r.status, 0, r.all);
  gameUrl = pathToFileURL(out).href;
  // The answers come from the map on disk, not from the game: that is what the game is checked against.
  map = { one: readJson(worldFile(repo, 'one')), two: readJson(worldFile(repo, 'two')) };
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); cleanup(); });

const WAIT = { timeout: 30_000 };
const flowOf = (wid, fid) => map[wid].flows.find((f) => f.id === fid);
// Where the code really goes after stop `i` of a case, as the map says.
const rightRoad = (kase, i) => (i + 1 < kase.path.length ? kase.path[i + 1] : 'outcome:' + kase.outcome);

// A fresh player in a fresh browser profile, past the intro, standing on the journey map.
async function openGame() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(gameUrl);
  await page.waitForFunction(() => window.__codequest && window.__codequest.W, null, WAIT);
  await page.getByRole('button', { name: 'Start the journey' }).click();
  return { page, errors, close: () => context.close() };
}
const game = (page) => page.evaluate(() => {
  const G = window.__codequest, m = G.mission;
  return {
    scene: G.scene, wid: G.wid, missions: { ...G.state.missions }, xp: G.state.xp,
    unlocked: Object.fromEntries(G.W.worlds.map((w) => [w.id, G.unlocked(w)])),
    mission: m && { flow: m.flow.id, kase: m.kase.id, phase: m.phase, i: m.i, hearts: m.hearts, mistakes: m.mistakes,
      signs: m.signs.map((s) => ({ to: s.to, dead: s.dead })) },
  };
});
const land = async (page, wid) => { await page.evaluate((id) => window.__codequest.land(id), wid); return game(page); };

// Press a button that starts a mission ("Start" on the board, "Next mission" after a win),
// then walk the player to the first building of that mission.
async function startMission(page, button = 'Start') {
  await page.getByRole('button', { name: button, exact: true }).click();
  await page.waitForFunction(() => window.__codequest.mission?.phase === 'goto', null, WAIT);
  await page.evaluate(() => {
    const G = window.__codequest, m = G.mission;
    const at = G.L.pos[G.stepById(m.flow, m.kase.path[0]).at];
    G.player.target = { x: at.x, y: at.y + 50 };
  });
  await atStop(page, 0);
  return game(page);
}
const atStop = (page, i) => page.waitForFunction((n) => { const m = window.__codequest.mission; return m && m.phase === 'choose' && m.i === n && m.signs.length > 0; }, i, WAIT);

// Pick a road the way a player does: the number key of its sign.
async function pick(page, to) {
  const g = await game(page);
  const k = g.mission.signs.findIndex((s) => s.to === to);
  assert.ok(k >= 0, `there is a sign for ${to} among ${g.mission.signs.map((s) => s.to).join(', ')}`);
  await page.keyboard.press(String(k + 1));
  return game(page);
}
const wrongRoad = (g, right) => g.mission.signs.find((s) => s.to !== right && !s.dead).to;

// Carry the current mission to its end, always taking the road the map says the code takes.
async function playRight(page, wid) {
  let g = await game(page);
  const kase = flowOf(wid, g.mission.flow).cases.find((c) => c.id === g.mission.kase);
  for (let i = g.mission.i; i < kase.path.length; i++) {
    await atStop(page, i);
    g = await pick(page, rightRoad(kase, i));
  }
  await page.waitForFunction(() => window.__codequest.mission?.phase === 'won', null, WAIT);
  return game(page);
}

test('the exported game boots from a file, with both worlds on the journey and only the first one open', { skip }, async () => {
  const { page, errors, close } = await openGame();
  try {
    const g = await game(page);
    assert.equal(g.scene, 'over');
    assert.deepEqual(g.unlocked, { one: true, two: false });
    assert.deepEqual(g.missions, {});
    assert.equal(await page.evaluate(() => window.PWNED), undefined, 'text in the map did not run as script');
    assert.equal((await land(page, 'one')).wid, 'one');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a wrong road costs a heart, does not win, and cannot be taken twice', { skip }, async () => {
  const { page, errors, close } = await openGame();
  try {
    await land(page, 'one');
    let g = await startMission(page);
    assert.deepEqual([g.mission.flow, g.mission.kase, g.mission.hearts, g.mission.mistakes], ['f', 'c1', 3, 0]);
    const kase = flowOf('one', 'f').cases[0];
    const right = rightRoad(kase, 0);
    assert.deepEqual(g.mission.signs.map((s) => s.to).sort(), flowOf('one', 'f').steps[0].next.map((n) => n.to).sort(), 'one sign per road in the map');
    const wrong = wrongRoad(g, right);

    g = await pick(page, wrong);
    assert.equal(g.mission.mistakes, 1);
    assert.equal(g.mission.hearts, 2);
    assert.equal(g.mission.phase, 'choose', 'still at the same fork');
    assert.equal(g.mission.i, 0);
    assert.deepEqual(g.missions, {}, 'nothing is recorded as beaten');
    assert.equal(g.mission.signs.find((s) => s.to === wrong).dead, true);

    g = await pick(page, wrong);
    assert.equal(g.mission.mistakes, 1, 'a closed road does not cost a second heart');
    assert.equal(g.mission.hearts, 2);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the right roads win the mission; stars are 3 minus the mistakes and are kept after a reload', { skip }, async () => {
  const { page, errors, close } = await openGame();
  try {
    await land(page, 'one');
    let g = await startMission(page);
    const kase = flowOf('one', 'f').cases[0];
    g = await pick(page, wrongRoad(g, rightRoad(kase, 0)));
    assert.equal(g.mission.mistakes, 1);
    g = await playRight(page, 'one');
    assert.equal(g.mission.phase, 'won');
    assert.deepEqual(g.missions, { 'one/f/c1': 2 }, 'one mistake: two stars');
    assert.ok(g.xp > 0);

    // a flawless run of the other flow is three stars
    g = await startMission(page, 'Next mission');
    assert.equal(g.mission.flow, 'g', 'the flow that is not beaten yet comes next');
    g = await playRight(page, 'one');
    assert.deepEqual(g.missions, { 'one/f/c1': 2, 'one/g/c1': 3 });

    // the snapshot keeps progress in this browser: wait for the save, then open the file again
    await page.waitForFunction(() => Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes('one/g/c1')), null, WAIT);
    await page.reload();
    await page.waitForFunction(() => window.__codequest && window.__codequest.W, null, WAIT);
    g = await game(page);
    assert.deepEqual(g.missions, { 'one/f/c1': 2, 'one/g/c1': 3 });
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('the next world opens only when every flow of this one has a beaten mission', { skip }, async () => {
  const { page, errors, close } = await openGame();
  try {
    let g = await land(page, 'two');
    assert.equal(g.scene, 'over', 'landing on a locked world is refused');
    assert.equal(g.wid, null);

    await land(page, 'one');
    g = await startMission(page);
    assert.equal(g.mission.flow, 'f');
    g = await playRight(page, 'one');
    assert.deepEqual(g.missions, { 'one/f/c1': 3 });
    assert.equal(g.unlocked.two, false, 'one flow of two beaten: still locked');
    assert.equal((await land(page, 'two')).wid, 'one', 'and still refused');

    g = await startMission(page, 'Next mission');
    assert.equal(g.mission.flow, 'g');
    g = await playRight(page, 'one');
    assert.equal(g.unlocked.two, true);
    await page.getByRole('button', { name: 'Sail to Store' }).waitFor(WAIT);

    g = await land(page, 'two');
    assert.equal(g.wid, 'two');
    g = await startMission(page);
    assert.equal(g.mission.flow, 'h');
    g = await playRight(page, 'two');
    assert.deepEqual(g.missions, { 'one/f/c1': 3, 'one/g/c1': 3, 'two/h/c1': 3 });
    assert.deepEqual(errors, []);
  } finally { await close(); }
});
