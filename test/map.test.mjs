// The map pipeline: fragments in .codequest/worlds → validate → build → is it still in sync with the code?
// Every test drives the real functions (or the real CLI) on a real git repo and reads what came out.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assemble, validate, build, readWorld, syncReport, refStatus, allRefs } from '../server/lib/world.mjs';
import { sampleRepo, tmp, cleanup, cli, git, commit, editWorld, editMeta, worldFile, builtFile, readJson, linesOf } from './helpers.mjs';

after(cleanup);

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const appFile = (repo) => path.join(repo, 'src', 'app.js');
const pinOf = (world, wid, eid) => world.worlds.find((w) => w.id === wid).entities.find((e) => e.id === eid).source[0];

// A broken copy of the fixture → the errors validate reports for it.
function errorsWhen(change, id = 'one') {
  const repo = sampleRepo();
  editWorld(repo, id, change);
  return { repo, errors: validate(assemble(repo)).errors };
}
const has = (errors, re) => assert.ok(errors.some((e) => re.test(e)), `expected an error matching ${re}, got:\n  ${errors.join('\n  ') || '(no errors)'}`);

// ---------- a good map ----------

test('the fixture map validates with no errors and no warnings', () => {
  const r = validate(assemble(sampleRepo()));
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('build writes world.json with the code and a file hash on every pin', () => {
  const repo = sampleRepo();
  const r = cli('build', repo);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /Built .*world\.json — 2 worlds, 4 entities/);
  const world = readJson(builtFile(repo));
  assert.deepEqual(world.worlds.map((w) => w.id), ['one', 'two']);
  assert.equal(world.repo.commit, git(repo, 'rev-parse', 'HEAD'), 'the commit comes from git, not from the map');
  const refs = [...allRefs(world)];
  assert.equal(refs.length, 4);
  for (const { ref } of refs) {
    const file = path.join(repo, ...ref.file.split('/'));
    assert.equal(ref.snippet, linesOf(file, ref.lines), `${ref.file}:${ref.lines} carries exactly those lines`);
    assert.ok(ref.snippet.includes(ref.anchor), 'the anchor is inside the pinned code');
    assert.equal(ref.fileHash, sha1(fs.readFileSync(file, 'utf8')));
  }
});

test('worlds are ordered by the journey in meta.json, not by file name', () => {
  const repo = sampleRepo();
  editMeta(repo, (m) => { m.worldOrder = ['two', 'one']; });
  assert.deepEqual(assemble(repo).worlds.map((w) => w.id), ['two', 'one']);
});

test('a team mate with only the fragments gets a built world on first read', () => {
  const repo = sampleRepo();
  assert.equal(fs.existsSync(builtFile(repo)), false);
  const world = readWorld(repo);
  assert.ok(pinOf(world, 'one', 'handle').snippet.includes('export function handle'));
  assert.equal(fs.existsSync(builtFile(repo)), true);
});

// ---------- what validation catches ----------

test('an unknown entity kind does not validate', () => {
  has(errorsWhen((w) => { w.entities[0].kind = 'castle'; }).errors, /one.*handle.*bad kind "castle"/);
});

test('two entities with the same id do not validate', () => {
  has(errorsWhen((w) => { w.entities[1].id = 'handle'; }).errors, /duplicate entity id "handle"/);
});

test('two flows with the same id do not validate', () => {
  has(errorsWhen((w) => { w.flows[1].id = 'f'; }).errors, /flow "f".*duplicate id/);
});

test('two worlds with the same id do not validate', () => {
  has(errorsWhen((w) => { w.id = 'one'; }, 'two').errors, /world "one".*duplicate id/);
});

test('a step that happens at something that is not an entity does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].steps[0].at = 'nowhere'; }).errors, /flow "f"\/s1: at "nowhere" is not an entity/);
});

test('a road to a step that does not exist does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].steps[0].next[0].to = 's9'; }).errors, /s1: next "s9" is not a step/);
});

test('a road to an outcome that does not exist does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].steps[0].next[1].to = 'outcome:nope'; }).errors, /s1: unknown outcome:nope/);
});

test('a flow whose start is not one of its steps does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].start = 's0'; }).errors, /start "s0" is not a step/);
});

test('a case path that jumps where there is no road does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].cases[0].path = ['s1', 's1']; }).errors, /case "c1": no edge s1 → s1/);
});

test('a case path that does not begin at the start of the flow does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].cases[0].path = ['s2']; }).errors, /case "c1": path must begin at start "s1"/);
});

test('a case with an empty path does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].cases[0].path = []; }).errors, /case "c1": empty path/);
});

test('a case that ends in an outcome that does not exist does not validate', () => {
  has(errorsWhen((w) => { w.flows[0].cases[0].outcome = 'nope'; }).errors, /case "c1": unknown outcome "nope"/);
});

test('a bridge to a world that does not exist does not validate', () => {
  const repo = sampleRepo();
  editMeta(repo, (m) => { m.bridges = [{ from: 'one', to: 'ghost' }]; });
  has(validate(assemble(repo)).errors, /bridge one→ghost: unknown world/);
});

test('a case that crosses fewer than two forks is warned about, not refused', () => {
  const repo = sampleRepo();
  editWorld(repo, 'one', (w) => { w.flows[0].steps[1].next = [{ to: 'outcome:ok', when: 'always' }]; });
  const r = validate(assemble(repo));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((x) => /case "c1": crosses 1 fork/.test(x)), r.warnings.join('\n'));
});

test('a map with errors is not built: no world.json, and the CLI says why', () => {
  const { repo } = errorsWhen((w) => { w.entities[0].kind = 'castle'; });
  const r = build(repo);
  assert.equal(r.world, null);
  assert.equal(fs.existsSync(builtFile(repo)), false);
  const c = cli('build', repo);
  assert.equal(c.status, 1);
  assert.match(c.out, /bad kind "castle"/);
  assert.match(c.out, /Not built: fix 1 error/);
  assert.equal(fs.existsSync(builtFile(repo)), false);
});

test('worldOrder that names a world that does not exist does not validate', () => {
  const repo = sampleRepo();
  editMeta(repo, (m) => { m.worldOrder = ['one', 'ghost']; });
  const r = validate(assemble(repo));
  assert.ok([...r.errors, ...r.warnings].some((x) => /ghost/.test(x)), 'nothing mentions "ghost"');
});

test('a road with no "to" is reported as a map error, not as a crash', () => {
  const repo = sampleRepo();
  editWorld(repo, 'one', (w) => { delete w.flows[0].steps[0].next[0].to; });
  let r;
  assert.doesNotThrow(() => { r = validate(assemble(repo)); });
  has(r.errors, /s1/);
});

test('a pin whose lines are past the end of the file does not validate or build clean', () => {
  const repo = sampleRepo();
  editWorld(repo, 'one', (w) => { w.entities[0].source = [{ file: 'src/app.js', lines: [100, 200] }]; });
  const r = build(repo);
  const complained = [...r.errors, ...r.warnings].some((x) => /handle/.test(x));
  const honest = r.world && syncReport(r.world, repo).entities['one/handle'] !== 'synced';
  assert.ok(complained || honest, 'an empty pin is called synced and nobody is told');
});

// ---------- sync: does the map still match the code? ----------

test('right after a build every world and every entity is in sync', () => {
  const repo = sampleRepo();
  const { world } = build(repo);
  const s = syncReport(world, repo);
  assert.deepEqual(s.entities, { 'one/handle': 'synced', 'one/auth': 'synced', 'one/describe': 'synced', 'two/save': 'synced' });
  assert.equal(s.worlds.one.status, 'synced');
  assert.equal(s.worlds.two.status, 'synced');
  assert.deepEqual(s.worlds.one.counts, { synced: 3, drifted: 0, stale: 0, lost: 0 });
  assert.deepEqual(s.changedFiles, []);
  assert.equal(s.commitsSinceMap, 0);
  assert.equal(s.dirtyFiles, 0, 'the built world.json itself is not counted as an uncommitted change');
  assert.equal(s.uncharted.count, 0);
});

test('one pin is synced, drifted, stale or lost by these exact rules', () => {
  const text = 'line one\nfunction keep() {}\n';
  const built = { anchor: 'function keep', fileHash: sha1(text) };
  assert.equal(refStatus(built, text), 'synced', 'same bytes');
  assert.equal(refStatus(built, text + '// more\n'), 'drifted', 'file changed, anchor still there');
  assert.equal(refStatus(built, 'line one\nfunction gone() {}\n'), 'stale', 'file changed, anchor gone');
  assert.equal(refStatus(built, null), 'lost', 'file gone');
  assert.equal(refStatus(built, ''), 'stale', 'an emptied file is not "lost": it still exists');
  assert.equal(refStatus({ fileHash: sha1(text) }, text + 'x'), 'stale', 'no anchor to hold on to: any change is stale');
  assert.equal(refStatus({ anchor: 'function keep' }, text), 'drifted', 'never built (no hash) is never called synced');
  assert.equal(refStatus({}, text), 'drifted');
});

test('lines added above pinned code: drifted until rebuilt, then the pin follows its anchor', () => {
  const repo = sampleRepo();
  const first = build(repo).world;
  const before = { handle: pinOf(first, 'one', 'handle'), auth: pinOf(first, 'one', 'auth'), describe: pinOf(first, 'one', 'describe') };
  assert.deepEqual([before.handle.lines, before.auth.lines, before.describe.lines], [[1, 5], [2, 2], [7, 11]]);

  fs.writeFileSync(appFile(repo), '// a new header\n// two lines long\n' + fs.readFileSync(appFile(repo), 'utf8'));
  const stale = syncReport(first, repo);
  assert.equal(stale.worlds.one.status, 'drifted', 'the old build is not called synced');
  assert.equal(stale.worlds.two.status, 'synced', 'a world whose files did not change is left alone');

  const r = build(repo);
  assert.equal(r.moved, 3);
  for (const id of ['handle', 'auth', 'describe']) {
    const pin = pinOf(r.world, 'one', id);
    assert.deepEqual(pin.lines, before[id].lines.map((n) => n + 2), id + ' moved down by two');
    assert.equal(pin.snippet, before[id].snippet, id + ' still shows the same code');
    assert.equal(pin.snippet, linesOf(appFile(repo), pin.lines), id + ': and that is what is on those lines now');
  }
  // the fragment on disk is healed too, and stays free of build output
  const frag = readJson(worldFile(repo, 'one'));
  assert.deepEqual(frag.entities.map((e) => e.source[0]), [
    { file: 'src/app.js', lines: [3, 7], anchor: 'export function handle' },
    { file: 'src/app.js', lines: [4, 4], anchor: 'if (!req.user)' },
    { file: 'src/app.js', lines: [9, 13], anchor: 'export function describe' },
  ]);
  assert.equal(syncReport(readWorld(repo), repo).worlds.one.status, 'synced');
  assert.equal(build(repo).moved, 0, 'a second build has nothing left to move');
});

test('editing pinned code without rebuilding is "drifted" while the anchor line survives', () => {
  const repo = sampleRepo();
  const { world } = build(repo);
  fs.writeFileSync(appFile(repo), fs.readFileSync(appFile(repo), 'utf8').replace('> 10', '> 20'));
  const s = syncReport(world, repo);
  assert.equal(s.entities['one/handle'], 'drifted');
  assert.equal(s.worlds.one.status, 'drifted');
  assert.deepEqual(s.worlds.one.staleFiles, [], 'drift is not fog: no file is listed as stale');
  assert.deepEqual(s.changedFiles, ['src/app.js']);
  assert.equal(s.dirtyFiles, 1);
  assert.equal(s.entities['two/save'], 'synced');
});

test('editing the anchor line itself is "stale", and the world takes its worst entity', () => {
  const repo = sampleRepo();
  const { world } = build(repo);
  fs.writeFileSync(appFile(repo), fs.readFileSync(appFile(repo), 'utf8').replace('if (!req.user)', 'if (req.user == null)'));
  const s = syncReport(world, repo);
  assert.equal(s.entities['one/auth'], 'stale', 'its anchor is gone');
  assert.equal(s.entities['one/handle'], 'drifted', 'same file, but its own anchor is still there');
  assert.equal(s.worlds.one.status, 'stale');
  assert.deepEqual(s.worlds.one.counts, { synced: 0, drifted: 2, stale: 1, lost: 0 });
  assert.deepEqual(s.worlds.one.staleFiles, ['src/app.js']);
  assert.equal(s.worlds.two.status, 'synced');
});

test('the CLI reports the same sync status as the library, in JSON and in words', () => {
  const repo = sampleRepo();
  const { world } = build(repo);
  fs.writeFileSync(appFile(repo), fs.readFileSync(appFile(repo), 'utf8').replace('if (!req.user)', 'if (req.user == null)'));
  const j = cli('status', repo, '--json');
  assert.equal(j.status, 0, j.all);
  const fromCli = JSON.parse(j.out);
  const fromLib = syncReport(world, repo);
  assert.deepEqual(fromCli.worlds, fromLib.worlds);
  assert.deepEqual(fromCli.entities, fromLib.entities);
  assert.equal(fromCli.worlds.one.status, 'stale');
  const words = cli('status', repo);
  assert.match(words.out, /stale\s+Handle\s+src\/app\.js/);
  assert.match(words.out, /in sync\s+Store/);
  assert.match(words.out, /1 uncommitted/);
});

test('deleting a pinned file is "lost", and rebuilding does not hide it', () => {
  const repo = sampleRepo();
  const { world } = build(repo);
  fs.rmSync(appFile(repo));
  const s = syncReport(world, repo);
  assert.deepEqual(s.worlds.one.counts, { synced: 0, drifted: 0, stale: 0, lost: 3 });
  assert.equal(s.worlds.one.status, 'lost');
  assert.deepEqual(s.worlds.one.staleFiles, ['src/app.js']);
  const again = build(repo);
  assert.deepEqual(again.errors, []);
  assert.equal(pinOf(again.world, 'one', 'handle').missing, true);
  assert.equal(syncReport(readWorld(repo), repo).worlds.one.status, 'lost');
  assert.equal(JSON.parse(cli('status', repo, '--json').out).worlds.one.status, 'lost');
});

test('commits made after mapping are counted, and new code outside every world is called out', () => {
  const repo = sampleRepo();
  const { world } = build(repo);
  fs.mkdirSync(path.join(repo, 'lib'));
  fs.writeFileSync(path.join(repo, 'lib', 'extra.js'), 'export const extra = 1;\n');
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'not source\n');
  commit(repo, 'more');
  const s = syncReport(world, repo);
  assert.equal(s.commitsSinceMap, 1);
  assert.notEqual(s.head, s.mappedCommit);
  assert.equal(s.uncharted.count, 1);
  assert.deepEqual(s.uncharted.sample, ['lib/extra.js']);
  assert.deepEqual(s.uncharted.newSinceMap, ['lib/extra.js']);
  assert.equal(s.worlds.one.status, 'synced', 'new files elsewhere do not make a mapped world drift');
});

// ---------- both ends: nothing, and far too much ----------

test('a map with zero worlds is refused in plain words everywhere, and nothing is written', () => {
  const repo = sampleRepo();
  fs.rmSync(path.join(repo, '.codequest', 'worlds'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.codequest', 'worlds'));
  has(validate(assemble(repo)).errors, /worlds must be a non-empty array/);
  assert.equal(build(repo).world, null);
  assert.equal(readWorld(repo), null);
  const v = cli('validate', repo);
  assert.equal(v.status, 1);
  assert.match(v.out, /worlds must be a non-empty array/);
  const s = cli('status', repo);
  assert.equal(s.status, 1);
  assert.match(s.out, /No map yet/);
  const e = cli('export', repo, '--out', path.join(tmp('exp'), 'g.html'));
  assert.equal(e.status, 1);
  assert.match(e.err, /worlds must be a non-empty array/);
  assert.equal(fs.existsSync(builtFile(repo)), false);
});

test('a folder that was never mapped is refused the same way, with no crash', () => {
  const bare = tmp('bare');
  const v = cli('validate', bare);
  assert.equal(v.status, 1);
  assert.match(v.out, /worlds must be a non-empty array/);
  assert.equal(readWorld(bare), null);
  assert.equal(fs.existsSync(path.join(bare, '.codequest')), false, 'validate creates nothing');
});

test('a world file that is not JSON is named in the error', () => {
  const repo = sampleRepo();
  fs.writeFileSync(worldFile(repo, 'two'), '{ not json');
  assert.throws(() => assemble(repo), /worlds\/two\.json: invalid JSON/);
  const v = cli('validate', repo);
  assert.equal(v.status, 1);
  assert.match(v.err, /worlds\/two\.json: invalid JSON/);
});

test('an absurdly big map (5,000 entities, a megabyte of text) still builds, syncs and exports', { timeout: 120_000 }, () => {
  const repo = sampleRepo();
  editWorld(repo, 'one', (w) => {
    for (let i = 0; i < 5000; i++) {
      w.entities.push({ id: 'e' + i, kind: 'module', name: 'n' + i, district: 'd', summary: 'x'.repeat(200), details: '',
        source: [{ file: 'src/app.js', lines: [1, 5], anchor: 'export function handle' }] });
    }
    w.summary += 'y'.repeat(1_000_000);
    w.name = 'N'.repeat(100_000);
  });
  const r = build(repo);
  assert.deepEqual(r.errors, []);
  assert.equal(readJson(builtFile(repo)).worlds[0].entities.length, 5003);
  const s = syncReport(r.world, repo);
  assert.deepEqual(s.worlds.one.counts, { synced: 5003, drifted: 0, stale: 0, lost: 0 });
  const out = path.join(tmp('exp'), 'big.html');
  const e = cli('export', repo, '--out', out);
  assert.equal(e.status, 0, e.all);
  assert.ok(fs.statSync(out).size > 2_000_000);
});

test('a pin over thousands of lines carries a capped snippet and says it was cut', () => {
  const repo = sampleRepo();
  const long = Array.from({ length: 5000 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  fs.writeFileSync(path.join(repo, 'src', 'long.js'), long);
  editWorld(repo, 'one', (w) => { w.entities[0].source = [{ file: 'src/long.js', lines: [1, 5000], anchor: 'export const v0 =' }]; });
  const pin = pinOf(build(repo).world, 'one', 'handle');
  assert.equal(pin.snippet.split('\n').length, 60);
  assert.equal(pin.snippetCut, true);
  assert.equal(pin.fileHash, sha1(long));
});
