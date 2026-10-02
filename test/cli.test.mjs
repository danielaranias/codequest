// The command line, run as a real child process: what it prints, what it writes, how it exits.
// `play` and `doctor` are not run here: they open a browser and look for agent CLIs on the machine.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sampleRepo, tmp, cleanup, cli, editWorld, builtFile, readJson, ROOT } from './helpers.mjs';

after(cleanup);

const COMMANDS = ['init', 'validate', 'build', 'status', 'play', 'export', 'format', 'doctor', 'version'];

test('version prints the version in package.json', () => {
  const want = readJson(path.join(ROOT, 'package.json')).version;
  for (const flag of ['version', '--version', '-v']) {
    const r = cli(flag);
    assert.equal(r.status, 0, r.all);
    assert.equal(r.out.trim(), want, flag);
  }
});

test('format prints the world format, whole', () => {
  const r = cli('format');
  assert.equal(r.status, 0, r.all);
  assert.equal(r.out, fs.readFileSync(path.join(ROOT, 'schema', 'WORLD_FORMAT.md'), 'utf8'));
  assert.match(r.out, /schemaVersion/);
});

test('where prints the folder CodeQuest is installed in', () => {
  const r = cli('where');
  assert.equal(r.status, 0, r.all);
  assert.equal(fs.realpathSync(r.out.trim()), fs.realpathSync(ROOT));
});

test('init creates .codequest/worlds and a .gitignore that keeps progress and build output out of git', () => {
  const repo = tmp('init');
  const r = cli('init', repo);
  assert.equal(r.status, 0, r.all);
  assert.ok(fs.statSync(path.join(repo, '.codequest', 'worlds')).isDirectory());
  const ignored = fs.readFileSync(path.join(repo, '.codequest', '.gitignore'), 'utf8').split('\n');
  for (const line of ['progress/', 'world.json', '*.html']) assert.ok(ignored.includes(line), line);
});

test('init a second time keeps the .gitignore and the map that are already there', () => {
  const repo = sampleRepo();
  const gi = path.join(repo, '.codequest', '.gitignore');
  fs.writeFileSync(gi, 'mine\n');
  const before = fs.readdirSync(path.join(repo, '.codequest', 'worlds'));
  assert.equal(cli('init', repo).status, 0);
  assert.equal(fs.readFileSync(gi, 'utf8'), 'mine\n');
  assert.deepEqual(fs.readdirSync(path.join(repo, '.codequest', 'worlds')), before);
});

test('validate exits 0 on the fixture and says how many worlds it found', () => {
  const r = cli('validate', sampleRepo());
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /OK — 2 worlds/);
  assert.doesNotMatch(r.out, /error|warn/);
});

test('validate exits 1 on a broken map and names what is wrong and where', () => {
  const repo = sampleRepo();
  editWorld(repo, 'one', (w) => { w.entities[0].kind = 'castle'; w.flows[0].cases[0].outcome = 'nope'; });
  const r = cli('validate', repo);
  assert.equal(r.status, 1);
  assert.match(r.out, /error world "one"\/handle: bad kind "castle"/);
  assert.match(r.out, /error world "one"\/flow "f"\/case "c1": unknown outcome "nope"/);
  assert.match(r.out, /2 error\(s\)/);
  assert.equal(fs.existsSync(builtFile(repo)), false, 'validate writes nothing');
});

test('validate uses the current folder when no repo is given', () => {
  const repo = sampleRepo();
  const old = process.cwd();
  // the child inherits our cwd
  process.chdir(repo);
  try { assert.match(cli('validate').out, /OK — 2 worlds/); } finally { process.chdir(old); }
});

test('status on a repo with no map says so and exits 1', () => {
  const r = cli('status', tmp('nomap'));
  assert.equal(r.status, 1);
  assert.match(r.out, /No map yet/);
});

// The world a snapshot carries, read back out of the HTML the way the browser would.
function worldIn(html) {
  const m = /<script>window\.CODEQUEST_WORLD=(.*?);<\/script>/s.exec(html);
  assert.ok(m, 'the file carries the world data');
  return JSON.parse(m[1]);
}

test('export writes one self-contained HTML file that carries the world', () => {
  const repo = sampleRepo();
  const dir = tmp('exp');
  const out = path.join(dir, 'game.html');
  const r = cli('export', repo, '--out', out);
  assert.equal(r.status, 0, r.all);
  assert.match(r.out, /Wrote /);
  assert.match(r.out, /contains code snippets/, 'the user is told the file holds their code');
  assert.deepEqual(fs.readdirSync(dir), ['game.html'], 'one file, nothing beside it');
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /^<!doctype html>/i);
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no script is loaded from elsewhere');
  assert.ok(!/<link[^>]*rel="stylesheet"/i.test(html), 'no stylesheet is loaded from elsewhere');
  assert.ok(!html.includes('<!--CW:SCRIPTS-->'));
  assert.ok(html.includes('<style>'));
  const world = worldIn(html);
  assert.deepEqual(world, readJson(builtFile(repo)), 'it is the built world, unchanged');
  assert.deepEqual(world.worlds.map((w) => w.id), ['one', 'two']);
  assert.ok(world.worlds[0].entities[0].source[0].snippet.includes('export function handle'));
  // every game script the page names is inside the file
  const page = fs.readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8');
  const srcs = [...page.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  for (const src of srcs) {
    const firstLine = fs.readFileSync(path.join(ROOT, 'game', ...src.split('/')), 'utf8').split('\n').find((l) => l.trim().length > 20);
    if (!firstLine) continue;
    assert.ok(html.includes(firstLine.replace(/<\/script/gi, '<\\/script')), src + ' is inlined');
  }
});

test('export with no --out writes <repo name>-codequest.html into .codequest', () => {
  const repo = sampleRepo();
  const r = cli('export', repo);
  assert.equal(r.status, 0, r.all);
  const out = path.join(repo, '.codequest', 'fixture-codequest.html');
  assert.equal(worldIn(fs.readFileSync(out, 'utf8')).repo.name, 'fixture');
});

test('export --artifact writes the page without the outer document, with the same world', () => {
  const repo = sampleRepo();
  const out = path.join(tmp('exp'), 'a.html');
  const r = cli('export', repo, '--out', out, '--artifact');
  assert.equal(r.status, 0, r.all);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(!/<!doctype|<html|<head>|<body>|<meta /i.test(html));
  assert.ok(!/<script[^>]*\ssrc=/i.test(html));
  assert.deepEqual(worldIn(html).worlds.map((w) => w.id), ['one', 'two']);
});

test('an unknown command, or none, prints the help with every command in it', () => {
  for (const args of [['frobnicate'], [], ['help']]) {
    const r = cli(...args);
    assert.equal(r.status, 0, r.all);
    assert.match(r.out, /^codequest <command> \[repo\]/);
    for (const c of COMMANDS) assert.match(r.out, new RegExp('^  ' + c + '\\b', 'm'), `${args[0] || '(none)'}: help lists ${c}`);
    assert.equal(r.err, '');
  }
});

test('an unknown command changes nothing in the repo it is pointed at', () => {
  const repo = tmp('unknown');
  cli('frobnicate', repo);
  assert.deepEqual(fs.readdirSync(repo), []);
});
