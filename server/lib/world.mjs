// Core world tooling: assemble fragments, validate, enrich with code, check sync.
// Zero dependencies — Node 18+.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const KINDS = ['entry', 'ui', 'module', 'agent', 'skill', 'guardrail', 'store', 'external', 'config'];
export const THEMES = ['meadow', 'desert', 'tundra', 'volcano', 'ocean', 'forest', 'city', 'crystal'];
const SNIPPET_MAX = 60;

export const cwDir = (repo) => path.join(repo, '.codequest');
const cleanText = (v) => (typeof v === 'string' ? v.slice(0, 120) : '');
const isHttpUrl = (v) => typeof v === 'string' && /^https?:\/\/[^\s<>"']+$/.test(v);
export const isSha = (v) => typeof v === 'string' && /^[0-9a-f]{7,40}$/.test(v);
// A map path must be a plain relative path inside the repo: no absolute paths, no "..", no NUL.
export const isRepoPath = (f) => typeof f === 'string' && f.length > 0 && f.length < 400 && !path.isAbsolute(f) && !/^[A-Za-z]:/.test(f) && !f.split(/[\\/]/).includes('..') && !f.includes('\0');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

export function git(repo, args, { allowFail = true } = {}) {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

// ---------- assemble ----------
// .codequest/meta.json   { repo, summary, bridges, uncharted }
// .codequest/worlds/*.json  one World each
export function assemble(repo) {
  const dir = cwDir(repo);
  const metaPath = path.join(dir, 'meta.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const wdir = path.join(dir, 'worlds');
  const files = fs.existsSync(wdir) ? fs.readdirSync(wdir).filter((f) => f.endsWith('.json')).sort() : [];
  const worlds = files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(wdir, f), 'utf8'));
    } catch (e) {
      throw new Error(`worlds/${f}: invalid JSON — ${e.message}`);
    }
  });
  const order = meta.worldOrder || [];
  worlds.sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999));
  const head = git(repo, ['rev-parse', 'HEAD']);
  const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    schemaVersion: 1,
    // only display fields come from the (untrusted) map; commit and branch are always read from git
    repo: { name: cleanText(meta.repo?.name) || path.basename(path.resolve(repo)), ...(isHttpUrl(meta.repo?.url) ? { url: meta.repo.url } : {}), branch, commit: head, mappedAt: new Date().toISOString() },
    summary: meta.summary || '',
    worlds,
    worldOrder: Array.isArray(meta.worldOrder) ? meta.worldOrder : [],
    bridges: meta.bridges || [],
    uncharted: meta.uncharted || [],
  };
}

// ---------- validate ----------
// Never throws: a map is untrusted input, so a malformed one is reported, not crashed on.
export function validate(world) {
  try {
    return check(world);
  } catch (err) {
    return { errors: [`the map is malformed and could not be checked (${err.message})`], warnings: [] };
  }
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function check(world) {
  const errs = [];
  const warn = [];
  const e = (m) => errs.push(m);
  // every list in a world must hold objects; say which one does not, instead of crashing later
  for (const w of Array.isArray(world.worlds) ? world.worlds : []) {
    if (!isObj(w)) { e('a world is not an object'); continue; }
    for (const key of ['districts', 'entities', 'flows', 'quests', 'cracks']) {
      if (w[key] != null && (!Array.isArray(w[key]) || !w[key].every(isObj))) e(`world "${w.id}": ${key} must be a list of objects`);
    }
    for (const f of Array.isArray(w.flows) ? w.flows.filter(isObj) : []) {
      for (const key of ['steps', 'outcomes', 'cases']) {
        if (f[key] != null && (!Array.isArray(f[key]) || !f[key].every(isObj))) e(`world "${w.id}"/flow "${f.id}": ${key} must be a list of objects`);
      }
    }
  }
  if (errs.length) return { errors: errs, warnings: warn };
  if (world.schemaVersion !== 1) e('schemaVersion must be 1');
  if (!Array.isArray(world.worlds) || !world.worlds.length) e('worlds must be a non-empty array');
  const wids = new Set();
  for (const w of world.worlds || []) {
    const W = `world "${w.id}"`;
    if (!w.id || wids.has(w.id)) e(`${W}: missing or duplicate id`);
    wids.add(w.id);
    if (!THEMES.includes(w.theme)) warn.push(`${W}: unknown theme "${w.theme}" (falls back to meadow)`);
    const dids = new Set((w.districts || []).map((d) => d.id));
    const eids = new Set();
    for (const en of w.entities || []) {
      if (!en.id || eids.has(en.id)) e(`${W}: missing/duplicate entity id "${en.id}"`);
      eids.add(en.id);
      if (!KINDS.includes(en.kind)) e(`${W}/${en.id}: bad kind "${en.kind}"`);
      if (en.district && !dids.has(en.district)) e(`${W}/${en.id}: unknown district "${en.district}"`);
      if (!Array.isArray(en.source) || !en.source.length) warn.push(`${W}/${en.id}: no source refs`);
      for (const r of en.source || []) if (!isRepoPath(r.file)) e(`${W}/${en.id}: source file must be a relative path inside the repo ("${String(r.file).slice(0, 60)}")`);
    }
    for (const en of w.entities || []) {
      if (en.agent) for (const t of en.agent.tools || []) if (!eids.has(t)) e(`${W}/${en.id}: agent tool "${t}" is not an entity`);
    }
    const fids = new Set();
    for (const f of w.flows || []) {
      const F = `${W}/flow "${f.id}"`;
      if (!f.id || fids.has(f.id)) e(`${F}: missing/duplicate id`);
      fids.add(f.id);
      const sids = new Set((f.steps || []).map((s) => s.id));
      const oids = new Set((f.outcomes || []).map((o) => o.id));
      if (!sids.has(f.start)) e(`${F}: start "${f.start}" is not a step`);
      const edges = {};
      for (const s of f.steps || []) {
        if (!eids.has(s.at)) e(`${F}/${s.id}: at "${s.at}" is not an entity`);
        edges[s.id] = new Set();
        for (const n of s.next || []) {
          if (!isObj(n) || typeof n.to !== 'string' || !n.to) { e(`${F}/${s.id}: every road in "next" needs a "to"`); continue; }
          edges[s.id].add(n.to);
          if (n.to.startsWith('outcome:')) {
            if (!oids.has(n.to.slice(8))) e(`${F}/${s.id}: unknown ${n.to}`);
          } else if (!sids.has(n.to)) e(`${F}/${s.id}: next "${n.to}" is not a step`);
        }
      }
      for (const c of f.cases || []) {
        const C = `${F}/case "${c.id}"`;
        if (!c.path?.length) { e(`${C}: empty path`); continue; }
        if (c.path[0] !== f.start) e(`${C}: path must begin at start "${f.start}"`);
        for (let i = 0; i + 1 < c.path.length; i++) {
          if (!edges[c.path[i]]?.has(c.path[i + 1])) e(`${C}: no edge ${c.path[i]} → ${c.path[i + 1]}`);
        }
        const forks = c.path.filter((id) => (edges[id]?.size || 0) > 1).length;
        if (forks < 2) warn.push(`${C}: crosses ${forks} fork(s) — a mission needs at least 2 to be worth playing`);
        if (!oids.has(c.outcome)) e(`${C}: unknown outcome "${c.outcome}"`);
        else if (!edges[c.path.at(-1)]?.has('outcome:' + c.outcome)) warn.push(`${C}: last step does not point to outcome:${c.outcome}`);
      }
    }
    for (const q of w.quests || []) {
      const Q = `${W}/quest "${q.id}"`;
      if (q.type === 'visit' && !eids.has(q.target)) e(`${Q}: target not an entity`);
      if (q.type === 'trace' && !fids.has(q.target)) e(`${Q}: target not a flow`);
      if (['quiz', 'predict'].includes(q.type) && !(q.options?.length > q.answer)) e(`${Q}: answer index out of range`);
    }
    for (const k of w.cracks || []) if (!eids.has(k.at)) e(`${W}/crack "${k.id}": at not an entity`);
    for (const f of w.flows || []) for (const st of f.steps || []) if (st.source && !isRepoPath(st.source.file)) e(`${W}/flow "${f.id}"/${st.id}: source file must be a relative path inside the repo`);
    for (const k of w.cracks || []) if (k.source && !isRepoPath(k.source.file)) e(`${W}/crack "${k.id}": source file must be a relative path inside the repo`);
  }
  for (const id of world.worldOrder || []) if (!wids.has(id)) e(`worldOrder names "${id}", which is not a world`);
  for (const id of wids) if (world.worldOrder?.length && !world.worldOrder.includes(id)) warn.push(`world "${id}" is not in worldOrder (it goes to the end of the journey)`);
  for (const b of world.bridges || []) if (!wids.has(b.from) || !wids.has(b.to)) e(`bridge ${b.from}→${b.to}: unknown world`);
  return { errors: errs, warnings: warn };
}

// ---------- refs ----------
export function* allRefs(world) {
  for (const w of world.worlds) {
    for (const en of w.entities || []) for (const r of en.source || []) yield { w, owner: { type: 'entity', id: en.id }, ref: r };
    for (const f of w.flows || []) for (const s of f.steps || []) if (s.source) yield { w, owner: { type: 'step', id: `${f.id}/${s.id}` }, ref: s.source };
    for (const k of w.cracks || []) if (k.source) yield { w, owner: { type: 'crack', id: k.id }, ref: k.source };
  }
}

// Read a file the map points at — only if it really lives inside the repo.
// Symlinks are resolved first, so a committed link to ~/.ssh or a sibling folder is refused.
export function readFileSafe(repo, file) {
  if (!isRepoPath(file)) return null;
  try {
    const root = fs.realpathSync(path.resolve(repo));
    const real = fs.realpathSync(path.join(root, file));
    if (real !== root && !real.startsWith(root + path.sep)) return null;
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > 2_000_000) return null;
    return fs.readFileSync(real, 'utf8');
  } catch { return null; }
}

// If code moved (lines added above), follow the anchor so the pin stays on the same code.
function relocate(ref, lines) {
  if (!ref.anchor || !ref.lines) return;
  const [a, b] = ref.lines;
  const cur = lines.slice(a - 1, b).findIndex((l) => l.includes(ref.anchor));
  const old = ref.snippet ? ref.snippet.split('\n').findIndex((l) => l.includes(ref.anchor)) : -1;
  if (cur >= 0 && (old < 0 || old === cur)) return;
  const hits = [];
  lines.forEach((l, i) => { if (l.includes(ref.anchor)) hits.push(i + 1); });
  if (!hits.length) return; // anchor gone: sync will call this stale
  let offset = 0;
  if (ref.snippet) { const k = ref.snippet.split('\n').findIndex((l) => l.includes(ref.anchor)); if (k >= 0) offset = k; }
  const best = hits.reduce((p, h) => (Math.abs(h - offset - a) < Math.abs(p - offset - a) ? h : p));
  const na = Math.max(1, best - offset);
  ref.lines = [na, Math.min(lines.length, na + (b - a))];
  ref.moved = true;
}

// Add snippet + file hash to every ref (mutates and returns world).
export function enrich(world, repo) {
  const cache = new Map();
  for (const { ref } of allRefs(world)) {
    if (!cache.has(ref.file)) cache.set(ref.file, readFileSafe(repo, ref.file));
    const text = cache.get(ref.file);
    if (text == null) { ref.missing = true; continue; }
    const lines = text.split('\n');
    relocate(ref, lines);
    const [a, b] = ref.lines || [1, Math.min(lines.length, 20)];
    // a pin that starts past the end of the file points at nothing: say so instead of storing an empty snippet
    if (!(a >= 1 && a <= lines.length && b >= a)) { ref.outOfRange = true; ref.snippet = ''; ref.fileHash = sha1(text); delete ref.missing; continue; }
    delete ref.outOfRange;
    ref.snippet = lines.slice(a - 1, Math.min(b, a - 1 + SNIPPET_MAX)).join('\n');
    if (b - a + 1 > SNIPPET_MAX) ref.snippetCut = true;
    ref.fileHash = sha1(text);
    delete ref.missing;
  }
  return world;
}

// ---------- sync ----------
const RANK = { synced: 0, drifted: 1, stale: 2, lost: 3 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

export function refStatus(ref, text) {
  if (text == null) return 'lost';
  if (ref.outOfRange) return 'stale';
  if (ref.fileHash && sha1(text) === ref.fileHash) return 'synced';
  if (ref.anchor && text.includes(ref.anchor)) return 'drifted';
  if (!ref.anchor && !ref.fileHash) return 'drifted';
  return 'stale';
}

// Compare the map against the code on disk (working tree, so uncommitted edits count too).
export function syncReport(world, repo, { fetchRemote = false } = {}) {
  const cache = new Map();
  const get = (f) => {
    if (!cache.has(f)) cache.set(f, readFileSafe(repo, f));
    return cache.get(f);
  };
  const entities = {}; // "world/entity" -> status
  const worlds = {};
  const changedFiles = new Set();
  for (const w of world.worlds) worlds[w.id] = { status: 'synced', counts: { synced: 0, drifted: 0, stale: 0, lost: 0 }, staleFiles: [] };
  for (const { w, owner, ref } of allRefs(world)) {
    const st = refStatus(ref, get(ref.file));
    if (st !== 'synced') changedFiles.add(ref.file);
    if (owner.type === 'entity') {
      const key = `${w.id}/${owner.id}`;
      entities[key] = worst(entities[key] || 'synced', st);
    }
    if (st === 'stale' || st === 'lost') if (!worlds[w.id].staleFiles.includes(ref.file)) worlds[w.id].staleFiles.push(ref.file);
  }
  for (const [key, st] of Object.entries(entities)) {
    const wid = key.split('/')[0];
    worlds[wid].counts[st]++;
    worlds[wid].status = worst(worlds[wid].status, st);
  }

  // git facts
  const head = git(repo, ['rev-parse', 'HEAD']);
  const mapped = isSha(world.repo?.commit) ? world.repo.commit : null; // never pass map text to git as an argument
  let commitsSinceMap = null;
  let filesChangedSinceMap = [];
  if (head && mapped && head !== mapped) {
    const n = git(repo, ['rev-list', '--count', `${mapped}..HEAD`]);
    commitsSinceMap = n == null ? null : Number(n);
    const diff = git(repo, ['diff', '--name-only', mapped, 'HEAD']);
    filesChangedSinceMap = diff ? diff.split('\n').filter(Boolean) : [];
  } else if (head && mapped) commitsSinceMap = 0;
  const dirty = (git(repo, ['status', '--porcelain']) || '').split('\n').filter((l) => l && !l.includes('.codequest/')).length;

  let remote = null;
  if (fetchRemote) {
    git(repo, ['fetch', '--quiet']);
    const upstream = git(repo, ['rev-parse', '--abbrev-ref', '@{u}']);
    if (upstream) {
      const counts = git(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
      const [ahead, behind] = (counts || '0 0').split(/\s+/).map(Number);
      remote = { upstream, ahead, behind };
    } else remote = { upstream: null };
  }

  // uncharted: tracked source files not under any world path
  const tracked = (git(repo, ['ls-files']) || '').split('\n').filter(Boolean);
  const covered = (f) => world.worlds.some((w) => (w.paths || []).some((p) => f === p || f.startsWith(p.endsWith('/') ? p : p + '/')));
  const isSource = (f) => /\.(m?[jt]sx?|py|go|rs|rb|java|kt|swift|dart|cs|php|vue|svelte|c|cc|cpp|h)$/.test(f) && !/(^|\/)(node_modules|dist|build|vendor|\.codequest)\//.test(f);
  const uncharted = tracked.filter((f) => isSource(f) && !covered(f));
  const newSinceMap = filesChangedSinceMap.filter((f) => isSource(f) && !covered(f));

  return {
    checkedAt: new Date().toISOString(),
    head,
    mappedCommit: mapped || null,
    commitsSinceMap,
    dirtyFiles: dirty,
    remote,
    worlds,
    entities,
    changedFiles: [...changedFiles],
    uncharted: { count: uncharted.length, sample: uncharted.slice(0, 30), newSinceMap },
  };
}

export function readWorld(repo) {
  const p = path.join(cwDir(repo), 'world.json');
  if (!fs.existsSync(p)) {
    // teammates get only the fragments from git: build on first use
    const wdir = path.join(cwDir(repo), 'worlds');
    if (fs.existsSync(wdir) && fs.readdirSync(wdir).some((f) => f.endsWith('.json'))) {
      const r = build(repo);
      if (r.errors.length) throw new Error('The map has errors — run codequest validate:\n' + r.errors.slice(0, 8).join('\n'));
      return r.world;
    }
    return null;
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function build(repo) {
  const world = assemble(repo);
  const report = validate(world);
  if (report.errors.length) return { world: null, ...report, moved: 0 };
  // use the previous build's snippets to follow code that moved since the fragments were written
  const prevPath = path.join(cwDir(repo), 'world.json');
  const prevSnip = new Map();
  try {
    const prev = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
    for (const { w, ref } of allRefs(prev)) {
      if (!ref.snippet) continue;
      const k = `${w.id}|${ref.file}|${ref.anchor}`;
      // two pins can share an anchor line; then the old snippet says nothing about which is which
      prevSnip.set(k, prevSnip.has(k) && prevSnip.get(k) !== ref.snippet ? null : ref.snippet);
    }
  } catch {}
  for (const { w, ref } of allRefs(world)) {
    const s = prevSnip.get(`${w.id}|${ref.file}|${ref.anchor}`);
    if (s) ref.snippet = s;
  }
  enrich(world, repo);
  for (const { w, ref } of allRefs(world)) {
    if (ref.outOfRange) report.warnings.push(`world "${w.id}": ${ref.file} lines ${ref.lines?.join('-')} are past the end of the file (shown as stale)`);
  }
  // write re-pinned line numbers back into the fragments (self-healing map)
  let moved = 0;
  const touched = new Set();
  for (const { w, ref } of allRefs(world)) if (ref.moved) { moved++; touched.add(w.id); delete ref.moved; }
  for (const wid of touched) {
    const w = world.worlds.find((x) => x.id === wid);
    const clean = JSON.parse(JSON.stringify(w, (k, v) => (['snippet', 'snippetCut', 'fileHash', 'missing', 'outOfRange'].includes(k) ? undefined : v)));
    fs.writeFileSync(path.join(cwDir(repo), 'worlds', wid + '.json'), JSON.stringify(clean, null, 2));
  }
  fs.writeFileSync(prevPath, JSON.stringify(world, null, 1));
  return { world, ...report, moved };
}
