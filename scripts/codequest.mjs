#!/usr/bin/env node
// CodeQuest CLI — build/validate the map, check sync, play, export a shareable snapshot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { assemble, validate, build, readWorld, syncReport, enrich, cwDir } from '../server/lib/world.mjs';

if (Number(process.versions.node.split('.')[0]) < 18) { console.error('CodeQuest needs Node.js 18 or newer.'); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd = 'help', ...rest] = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags[k] = v ?? (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true); }
  else pos.push(a);
}
const repo = path.resolve(pos[0] || flags.repo || process.cwd());

const C = { g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` };

function printStatus(W, S) {
  console.log(C.b(`${W.repo.name}`) + C.d(`  mapped at ${String(S.mappedCommit).slice(0, 7)}, code at ${String(S.head).slice(0, 7)}`) + (S.commitsSinceMap ? C.y(`  (${S.commitsSinceMap} commits later)`) : '') + (S.dirtyFiles ? C.y(`  ${S.dirtyFiles} uncommitted`) : ''));
  if (S.remote?.upstream) console.log(S.remote.behind ? C.y(`  ${S.remote.behind} new commit(s) on ${S.remote.upstream} — run git pull`) : C.d(`  up to date with ${S.remote.upstream}`));
  for (const w of W.worlds) {
    const s = S.worlds[w.id];
    const mark = { synced: C.g('● in sync  '), drifted: C.y('● drifted  '), stale: C.r('● stale    '), lost: C.r('● lost     ') }[s.status];
    console.log(`  ${mark} ${w.name}` + (s.staleFiles.length ? C.d('  ' + s.staleFiles.join(', ')) : ''));
  }
  if (S.uncharted.newSinceMap.length) console.log(C.y(`  New code not in any world: ${S.uncharted.newSinceMap.join(', ')}`));
  console.log(C.d(`  ${S.uncharted.count} source files are not covered by any world.`));
}

async function main() {
  switch (cmd) {
    case 'init': {
      fs.mkdirSync(path.join(cwDir(repo), 'worlds'), { recursive: true });
      const gi = path.join(cwDir(repo), '.gitignore');
      if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'progress/\nworld.json\n*.html\n');
      console.log('Created .codequest/ (worlds/, .gitignore). Map fragments go in .codequest/worlds/*.json');
      break;
    }
    case 'validate': {
      const W = assemble(repo);
      const r = validate(W);
      r.warnings.forEach((w) => console.log(C.y('warn  ') + w));
      r.errors.forEach((e) => console.log(C.r('error ') + e));
      console.log(r.errors.length ? C.r(`${r.errors.length} error(s)`) : C.g(`OK — ${W.worlds.length} worlds`));
      process.exitCode = r.errors.length ? 1 : 0;
      break;
    }
    case 'build': {
      const r = build(repo);
      r.warnings.forEach((w) => console.log(C.y('warn  ') + w));
      r.errors.forEach((e) => console.log(C.r('error ') + e));
      if (r.errors.length) { console.log(C.r(`Not built: fix ${r.errors.length} error(s) above.`)); process.exitCode = 1; break; }
      const n = r.world.worlds.reduce((a, w) => a + w.entities.length, 0);
      if (r.moved) console.log(C.y(`Re-pinned ${r.moved} code reference(s) that moved; updated the world files.`));
      console.log(C.g(`Built .codequest/world.json — ${r.world.worlds.length} worlds, ${n} entities, at ${String(r.world.repo.commit).slice(0, 7)}`));
      break;
    }
    case 'status': {
      const W = readWorld(repo);
      if (!W) { console.log('No map yet. Map this repo first (the codequest-map skill).'); process.exitCode = 1; break; }
      const S = syncReport(W, repo, { fetchRemote: !!flags.fetch });
      if (flags.json) console.log(JSON.stringify(S, null, 1)); else printStatus(W, S);
      break;
    }
    case 'play': {
      const W = readWorld(repo);
      if (!W) { console.log('No map yet. Map this repo first (the codequest-map skill).'); process.exitCode = 1; break; }
      printStatus(W, syncReport(W, repo));
      const { startServer } = await import('../server/server.mjs');
      const opts = { agent: flags.agent, model: flags.model, player: flags.player, test: typeof flags.test === 'string' ? flags.test : undefined, noTests: !!flags['no-tests'] };
      const { url, config } = await startServer({ repo, port: Number(flags.port ?? 4477), opts });
      if (config.ignored.length) console.log(C.y(`Ignored ${config.ignored.join(', ')} in this repo's .codequest/config.json — a repo may not choose what runs on your machine. Use flags or ${'~/.config/codequest/config.json'}.`));
      console.log(C.d(`  agent: ${config.agent.kind}   tests: ${config.testCommand ? `${config.testCommand} (${config.testSource})` : 'none — pass --test "<command>" to enable real runs'}`));
      console.log('\n' + C.b('CodeQuest is running: ') + url + C.d('   (Ctrl+C to stop)'));
      console.log(C.d('  The link carries a one-time key for this run. Do not share it.'));
      if (!flags['no-open']) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        try { spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {}).unref(); } catch {}
      }
      break;
    }
    case 'export': {
      // One self-contained HTML file: the game + this map, no server, no live sync.
      let W = readWorld(repo);
      if (!W) { const a = assemble(repo); const r = validate(a); if (r.errors.length) throw new Error(r.errors.join('\n')); W = enrich(a, repo); }
      const out = path.resolve(flags.out || path.join(cwDir(repo), `${W.repo.name}-codequest.html`));
      fs.writeFileSync(out, exportHtml(W, { title: typeof flags.title === 'string' ? flags.title : undefined, fragment: !!flags.artifact }));
      console.log(C.g('Wrote ') + out + C.d(`  (${Math.round(fs.statSync(out).size / 1024)} KB)`));
      console.log(C.y('This file contains code snippets from the repo. Share it only with people who may read that code.'));
      break;
    }
    case 'format': {
      // The world format, for any agent that is about to map a repo.
      process.stdout.write(fs.readFileSync(path.join(ROOT, 'schema', 'WORLD_FORMAT.md'), 'utf8'));
      break;
    }
    case 'where': { console.log(ROOT); break; }
    case 'doctor': {
      const has = (cmd) => { try { spawnSync(cmd, ['--version'], { stdio: 'ignore' }); return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
      const row = (ok, text) => console.log((ok ? C.g('ok   ') : C.y('miss ')) + text);
      row(true, `Node.js ${process.versions.node}`);
      row(has('git'), 'git');
      row(has('claude'), 'Claude Code CLI (claude) — default agent for Ask / Simulate / tasks');
      row(has('codex'), 'OpenAI Codex CLI (codex) — optional, use --agent codex');
      row(fs.existsSync(path.join(cwDir(repo), 'worlds')), `.codequest/ map in ${repo}`);
      break;
    }
    case 'version': case '--version': case '-v': {
      console.log(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
      break;
    }
    default:
      console.log(`codequest <command> [repo]

  init       create .codequest/ in a repo
  validate   check .codequest/worlds/*.json against the format
  build      validate + attach code snippets → .codequest/world.json
  status     is the map in sync with the code? (--fetch to check the remote too)
  play       start the game for this repo
               --port 4477  --no-open  --agent claude|codex  --model <id>
               --test "<command>" (tests for real runs)  --no-tests
  export     write one shareable HTML snapshot (--out file.html, --artifact for a claude.ai page)
  format     print the world format (for the agent that maps)
  doctor     check what is installed
  version`);
  }
}

export function exportHtml(W, { title, fragment } = {}) {
  const game = path.join(ROOT, 'game');
  let html = fs.readFileSync(path.join(game, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(game, 'style.css'), 'utf8');
  const scripts = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map((m) => fs.readFileSync(path.join(game, m[1]), 'utf8'));
  const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
  const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  html = html.replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${css}\n</style>`);
  html = html.replace(/<!--CW:SCRIPTS-->[\s\S]*<!--\/CW:SCRIPTS-->/, () =>
    `<script>window.CODEQUEST_WORLD=${safeJson(W)};</script>\n<script>\n${safe(scripts.join('\n;\n'))}\n</script>`);
  if (title) html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escHtml(title)}</title>`);
  if (fragment) {
    // claude.ai artifact form: the host adds doctype/html/head/body itself
    const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>')).replace(/<meta [^>]*>\n?/g, '');
    const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
    html = head.trim() + '\n' + body.trim() + '\n';
  }
  return html;
}

main().catch((e) => { console.error(C.r(e.message || e)); process.exitCode = 1; });
