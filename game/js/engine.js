/* CodeQuest — the engine: game state (CW.game, called `G`), XP and badges, scenes, the frame
   loop, movement, camera, keyboard and mouse input, and flow packets (animated runs in the Lab).
   Must not build DOM — it tells the UI what changed through CW.ui.* (toast, onScene, onPacket…).
   Mission rules live in mission.js; canvas drawing primitives live in render.js. */
(function (CW) {
  'use strict';

  const G = (CW.game = {
    W: null, sync: null, backend: null,
    scene: 'over', wid: null, L: null, OW: null, layouts: {},
    player: { x: 0, y: 0, dir: 0, target: null, moving: false },
    cam: { x: 0, y: 0, z: 1 }, zoomMul: 1, baseZoom: 1,
    keys: {}, near: null, selected: null, flowSel: null, packet: null,
    mission: null, lab: false, shake: 0, unlockFx: null,
    t: 0, dpr: 1, W_: 0, H_: 0,
    state: null,
  });

  const XP = {
    visit: 5, land: 10, trace: 15, caseRun: 5, quiz: 20, quizRetry: 5, crack: 50,
    note: 5, task: 10, sim: 15, challenge: 10, challengeHit: 40, run: 30, mastery: 100 };
  CW.XP = XP;
  const TITLES = ['Deckhand', 'Explorer', 'Pathfinder', 'Cartographer', 'Code Ranger', 'Archivist', 'Architect', 'Oracle'];

  CW.freshState = () => ({
    v: 1, xp: 0, visited: {}, landed: {}, traced: {}, cases: {}, missions: {}, seen: {}, freeRoam: false,
    quests: {}, cracks: {}, crackMiss: {}, notes: [], tasks: [], badges: {}, counters: {}, updatedAt: null });

  // ---------- helpers ----------
  G.world = () => G.W.worlds.find((w) => w.id === G.wid);
  G.worldById = (id) => G.W.worlds.find((w) => w.id === id);
  G.entity = (id, w) => (w || G.world())?.entities.find((e) => e.id === id);
  G.flow = (id, w) => (w || G.world())?.flows.find((f) => f.id === id);
  G.level = () => 1 + Math.floor(G.state.xp / 150);
  G.title = () => TITLES[Math.min(TITLES.length - 1, G.level() - 1)];
  G.entityStatus = (wid, eid) => G.sync?.entities?.[`${wid}/${eid}`] || 'synced';
  G.worldStatus = (wid) => G.sync?.worlds?.[wid]?.status || 'synced';
  const bag = (o, k) => (o[k] = o[k] || {});

  // 0..1: buildings seen + missions done + quests done + cracks found, over everything there is in world `w`.
  G.mastery = function (w) {
    const s = G.state;
    const mc = G.missionCount(w);
    const total = w.entities.length + mc.total + (w.quests || []).length + (w.cracks || []).length;
    const seen = w.entities.filter((e) => s.seen[w.id]?.[e.id] || s.visited[w.id]?.[e.id]).length;
    const done = seen + mc.done + Object.keys(s.quests[w.id] || {}).length + Object.keys(s.cracks[w.id] || {}).length;
    return total ? Math.min(1, done / total) : 0;
  };
  G.overallMastery = () => G.W.worlds.reduce((a, w) => a + G.mastery(w), 0) / G.W.worlds.length;

  let saveTimer = null;
  // Saves are debounced: many changes in a row become one write.
  G.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { G.state.updatedAt = new Date().toISOString(); G.backend.saveState(G.state); }, 600);
  };

  G.award = function (amount, why) {
    if (!amount) return;
    const before = G.level();
    G.state.xp += amount;
    CW.ui.toast(`+${amount} XP · ${why}`, 'xp');
    if (G.level() > before) CW.ui.toast(`Level ${G.level()} — you are now a ${G.title()}`, 'level');
    G.checkBadges();
    G.save();
    CW.ui.updateHUD();
  };
  G.count = (k) => { G.state.counters[k] = (G.state.counters[k] || 0) + 1; };

  const BADGES = [
    { id: 'landfall', name: 'First delivery', desc: 'Carry your first case to its end', test: (s) => Object.keys(s.missions).length >= 1 },
    { id: 'flawless', name: 'Flawless', desc: 'Finish 5 missions without a wrong turn',
      test: (s) => Object.values(s.missions).filter((v) => v === 3).length >= 5 },
    { id: 'cartographer', name: 'Journey complete', desc: 'Clear every world', test: () => G.W.worlds.every((w) => G.worldCleared(w)) },
    { id: 'gatekeeper', name: 'Gatekeeper', desc: 'Inspect every guardrail in the codebase',
      test: (s) => G.W.worlds.every((w) => w.entities.filter((e) => e.kind === 'guardrail').every((e) => s.visited[w.id]?.[e.id])) },
    { id: 'bug-hunter', name: 'Bug hunter', desc: 'Find 3 hidden cracks',
      test: (s) => Object.values(s.cracks).reduce((a, o) => a + Object.keys(o).length, 0) >= 3 },
    { id: 'what-if', name: 'What if…', desc: 'Inject your own case into a flow', test: (s) => (s.counters.sim || 0) >= 1 },
    { id: 'saboteur', name: 'Saboteur', desc: 'Change a flow and watch it break', test: (s) => (s.counters.breaks || 0) >= 1 },
    { id: 'referee', name: 'Referee', desc: 'Win a challenge against the code', test: (s) => (s.counters.challengeHit || 0) >= 1 },
    { id: 'scribe', name: 'Scribe', desc: 'Write 5 notes', test: (s) => s.notes.length >= 5 },
    { id: 'quartermaster', name: 'Quartermaster', desc: 'Turn 3 notes into tasks', test: (s) => s.tasks.length >= 3 },
  ];
  G.badgeList = () => BADGES.concat(G.W.worlds.map((w) => ({
    id: 'master:' + w.id, name: 'Master of ' + w.name, desc: 'Reach 100% in ' + w.name, test: () => G.mastery(w) >= 0.999 })));
  // Award any badge whose test now passes. A world-mastery badge also gives XP.
  G.checkBadges = function () {
    for (const b of G.badgeList()) {
      if (!G.state.badges[b.id] && b.test(G.state)) {
        G.state.badges[b.id] = new Date().toISOString();
        CW.ui.toast(`Badge earned: ${b.name}`, 'badge');
        if (b.id.startsWith('master:')) { G.state.xp += XP.mastery; CW.ui.toast(`+${XP.mastery} XP · world mastered`, 'xp'); }
      }
    }
  };

  // progress events
  G.markVisit = function (en) {
    const v = bag(G.state.visited, G.wid);
    if (!v[en.id]) { v[en.id] = 1; G.award(XP.visit, 'discovered ' + en.name); G.completeQuests('visit', en.id); }
  };
  G.markTraced = function (flow) {
    const v = bag(G.state.traced, G.wid);
    if (!v[flow.id]) { v[flow.id] = 1; G.award(XP.trace, 'traced ' + flow.name); }
    G.completeQuests('trace', flow.id);
  };
  // Tick off every open quest of this type that points at `target` (a building id or flow id).
  G.completeQuests = function (type, target) {
    const w = G.world();
    for (const q of w.quests || []) {
      if (q.type === type && q.target === target && !G.state.quests[w.id]?.[q.id]) {
        bag(G.state.quests, w.id)[q.id] = 1;
        G.award(q.xp || 10, 'quest: ' + q.title);
      }
    }
    CW.ui.refreshQuests();
  };

  // ---------- scenes ----------
  G.layout = function (wid) {
    if (!G.layouts[wid]) G.layouts[wid] = CW.layoutWorld(G.worldById(wid));
    return G.layouts[wid];
  };
  G.lockHint = function (w) {
    const prev = G.W.worlds[G.worldIndex(w.id) - 1];
    return prev ? `Clear ${prev.name} first` : '';
  };
  // Enter a world from the overworld (refused if it is still locked).
  G.land = function (wid) {
    const target = G.worldById(wid);
    if (!G.unlocked(target)) {
      CW.ui.toast(`Locked. ${G.lockHint(target)}: beat one mission in each of its flows.`, 'err');
      CW.sfx('wrong');
      return;
    }
    G.mission = null; G.lab = false;
    G.scene = 'world'; G.wid = wid; G.L = G.layout(wid);
    G.player.x = G.L.dock.x + 30; G.player.y = G.L.dock.y; G.player.target = null; G.player.dir = 0;
    // establishing shot: open on the whole island, then ease in to the player
    const b = G.L.bounds;
    G.cam.x = 0; G.cam.y = 0;
    G.cam.z = Math.min(G.W_ / b.w, G.H_ / b.h) * 0.95; G.selected = null; G.packet = null; G.flowSel = null;
    if (!G.state.landed[wid]) { G.state.landed[wid] = new Date().toISOString(); G.award(XP.land, 'landed on ' + G.world().name); }
    CW.ui.onScene();
  };
  // Leave the world and go back to the overworld, next to the island just left.
  G.setSail = function () {
    const from = G.wid;
    G.scene = 'over'; G.L = null; G.packet = null; G.flowSel = null; G.selected = null; G.mission = null; G.lab = false;
    const I = from && G.OW.isl[from];
    if (I) { G.player.x = I.c.x; G.player.y = I.c.y + I.r + 95; }
    else { G.player.x = G.OW.start.x; G.player.y = G.OW.start.y; }
    G.player.target = null; G.wid = null;
    CW.ui.onScene();
  };

  // ---------- packets (animated flow runs) ----------
  G.stepById = (flow, id) => flow.steps.find((s) => s.id === id);
  G.startPacket = function (flow, opts) {
    // opts: {path, outcome, outcomeKind, narration[], label, source:'case'|'ai'|'manual', explain, caseId, stepMode}
    const path = (opts.path || [flow.start]).filter((id) => G.stepById(flow, id));
    if (!path.length) path.push(flow.start);
    G.flowSel = flow.id;
    G.packet = {
      flow, path, i: 0, t: 0, phase: 'arrive', hold: 0,
      outcome: opts.outcome, outcomeKind: opts.outcomeKind, narration: opts.narration || [], explain: opts.explain || '',
      source: opts.source || 'case', label: opts.label || '', caseId: opts.caseId, stepMode: !!opts.stepMode,
      manual: opts.source === 'manual', done: false, doneAge: 0, meta: opts.meta || null,
    };
    CW.ui.onPacket();
  };
  G.stopPacket = function () { G.packet = null; CW.ui.onPacket(); };
  // Step mode: let the packet move on from the step it is waiting at.
  G.nextStep = function () { if (G.packet && G.packet.phase === 'hold') G.packet.advance = true; };
  // Manual walk: the player picked the next step, or an ending (`outcome:<id>`).
  G.chooseBranch = function (to) {
    const P = G.packet; if (!P || !P.manual) return;
    if (to.startsWith('outcome:')) {
      const o = P.flow.outcomes.find((x) => x.id === to.slice(8));
      P.outcome = o?.id; P.outcomeKind = o?.kind || 'success';
      P.phase = 'end'; P.done = true; P.doneAge = 0; finishPacket(P);
    } else { P.path.push(to); P.advance = true; }
    CW.ui.onPacket();
  };

  // The packet reached its ending: award the first run of a case and mark the flow as traced.
  function finishPacket(P) {
    const outcome = P.flow.outcomes.find((o) => o.id === P.outcome);
    if (!P.outcomeKind) P.outcomeKind = outcome?.kind || 'success';
    if (P.source === 'case' && P.caseId) {
      const k = `${G.wid}/${P.flow.id}/${P.caseId}`;
      if (!G.state.cases[k]) { G.state.cases[k] = 1; G.award(XP.caseRun, 'ran case ' + P.label); }
    }
    if (P.source !== 'ai' || P.path.length > 1) G.markTraced(P.flow);
    CW.ui.onPacket();
  }

  function stepPos(P, idx) {
    const s = G.stepById(P.flow, P.path[idx]);
    return (s && G.L.pos[s.at]) || G.L.dock;
  }
  function roadBetween(a, b) {
    const key = a < b ? a + '|' + b : b + '|' + a;
    return G.L.roads.find((r) => r.key === key);
  }
  // Where the packet is right now, in world coordinates (it rides the road curve while moving).
  G.packetPos = function () {
    const P = G.packet; if (!P) return null;
    if (P.phase !== 'move') return stepPos(P, P.i);
    const s0 = G.stepById(P.flow, P.path[P.i - 1]), s1 = G.stepById(P.flow, P.path[P.i]);
    const a = G.L.pos[s0.at], b = G.L.pos[s1.at];
    if (!a || !b) return b || a || G.L.dock;
    const k = CW.ease(Math.min(1, P.t));
    if (s0.at === s1.at) return { x: a.x, y: a.y - Math.sin(k * Math.PI) * 50 };
    const road = roadBetween(s0.at, s1.at);
    const ctrl = road ? road.ctrl : CW.curveCtrl(a, b, 40);
    return CW.qpoint(a, ctrl, b, k);
  };

  // Packet state machine: arrive -> hold (show the step) -> move (to the next step) -> … -> end.
  function tickPacket(dt) {
    const P = G.packet; if (!P || P.done) { if (P) P.doneAge += dt; return; }
    const speed = CW.ui.speed();
    if (P.phase === 'arrive') { P.phase = 'hold'; P.hold = 0; CW.ui.onPacket(); return; }
    if (P.phase === 'hold') {
      P.hold += dt * speed;
      const holdFor = P.stepMode || P.manual ? Infinity : 2.3;
      if (P.hold < holdFor && !P.advance) return;
      P.advance = false;
      if (P.i + 1 < P.path.length) { P.i++; P.phase = 'move'; P.t = 0; CW.ui.onPacket(); }
      else if (!P.manual) { P.phase = 'end'; P.done = true; P.doneAge = 0; finishPacket(P); }
      return;
    }
    if (P.phase === 'move') {
      const a = stepPos(P, P.i - 1), b = stepPos(P, P.i);
      const len = Math.max(120, CW.dist(a, b));
      P.t += (dt * speed * 420) / len;
      if (P.t >= 1) { P.phase = 'arrive'; }
    }
  }
  G.activeStep = function () {
    const P = G.packet; if (!P) return null;
    return G.stepById(P.flow, P.path[P.i]);
  };

  // ---------- input ----------
  G.toWorld = function (sx, sy) {
    return { x: (sx - G.W_ / 2) / G.cam.z + G.cam.x, y: (sy - G.H_ / 2) / G.cam.z + G.cam.y };
  };
  G.toScreen = function (p) {
    return { x: (p.x - G.cam.x) * G.cam.z + G.W_ / 2, y: (p.y - G.cam.y) * G.cam.z + G.H_ / 2 };
  };
  // A click on the canvas: pick an island, a road sign or a building, otherwise walk there.
  G.click = function (sx, sy) {
    const p = G.toWorld(sx, sy);
    if (G.scene === 'over') {
      for (const w of G.W.worlds) {
        const I = G.OW.isl[w.id];
        if (CW.pointInPoly(p, I.poly) || CW.dist(p, { x: I.c.x, y: I.c.y + I.r + 30 }) < 60) {
          if (!G.unlocked(w)) { CW.ui.toast(`Locked. ${G.lockHint(w)}.`, 'err'); return; }
          G.player.target = { x: I.c.x, y: I.c.y, land: w.id }; return;
        }
      }
      G.player.target = p;
      return;
    }
    if (G.mission) {
      if (G.mission.phase === 'travel') return;
      if (G.mission.phase === 'choose') {
        const k = G.mission.signs.findIndex((sg) => !sg.dead && CW.dist(p, { x: sg.x, y: sg.y - 25 }) < 46);
        if (k >= 0) { CW.mission.choose(k); return; }
      }
    }
    let best = null, bd = 70;
    for (const en of G.world().entities) {
      const q = G.L.pos[en.id]; if (!q || !G.isSeen(G.wid, en.id)) continue;
      const d = Math.min(CW.dist(p, q), CW.dist(p, { x: q.x, y: q.y - 25 }));
      if (d < bd) { bd = d; best = en; }
    }
    if (best) {
      G.selected = best.id;
      CW.ui.openEntity(best);
      const q = G.L.pos[best.id];
      G.player.target = { x: q.x - 60, y: q.y + 40 };
      return;
    }
    G.player.target = p;
  };
  G.interact = function () {
    if (!G.near) return;
    if (G.scene === 'over') G.land(G.near.id);
    else if (G.mission && G.mission.phase === 'travel') return;
    else { G.selected = G.near.id; CW.ui.openEntity(G.near); }
  };

  // Move the player from the keys or towards the click target; stay on the island, or off islands at sea.
  function moveTick(dt) {
    const pl = G.player;
    if (G.mission && G.mission.phase === 'travel') return;
    let dx = 0, dy = 0;
    const k = G.keys;
    if (k.ArrowLeft || k.a) dx -= 1;
    if (k.ArrowRight || k.d) dx += 1;
    if (k.ArrowUp || k.w) dy -= 1;
    if (k.ArrowDown || k.s) dy += 1;
    if (dx || dy) pl.target = null;
    if (!dx && !dy && pl.target) {
      const tx = pl.target.x - pl.x, ty = pl.target.y - pl.y, d = Math.hypot(tx, ty);
      if (d < 8) {
        if (pl.target.land) { const id = pl.target.land; pl.target = null; G.land(id); return; }
        pl.target = null;
      } else { dx = tx / d; dy = ty / d; }
    }
    const len = Math.hypot(dx, dy);
    pl.moving = len > 0;
    if (!len) return;
    dx /= len; dy /= len;
    pl.dir = Math.atan2(dy, dx);
    const sp = (G.scene === 'over' ? 470 : 340) * dt;
    const nx = pl.x + dx * sp, ny = pl.y + dy * sp;
    if (G.scene === 'world') {
      const inside = (x, y) => CW.pointInPoly({ x, y }, G.L.poly);
      if (inside(nx, ny)) { pl.x = nx; pl.y = ny; }
      else if (inside(nx, pl.y)) pl.x = nx;
      else if (inside(pl.x, ny)) pl.y = ny;
      else if (pl.target) pl.target = null;
    } else {
      const blocked = G.W.worlds.some((w) => CW.pointInPoly({ x: nx, y: ny }, G.OW.isl[w.id].poly));
      if (blocked) {
        const tgt = pl.target?.land;
        const hit = G.W.worlds.find((w) => CW.pointInPoly({ x: nx, y: ny }, G.OW.isl[w.id].poly));
        if (tgt && hit && hit.id === tgt) { pl.target = null; G.land(tgt); return; }
        pl.target = null;
        return;
      }
      const b = G.OW.bounds;
      pl.x = CW.clamp(nx, b.x, b.x + b.w); pl.y = CW.clamp(ny, b.y, b.y + b.h);
    }
  }

  // Find what the player stands next to (for the E hint) and reveal buildings that come into range.
  function nearTick() {
    const pl = G.player;
    let near = null;
    if (G.scene === 'over') {
      let bd = Infinity;
      for (const w of G.W.worlds) {
        const I = G.OW.isl[w.id];
        const d = CW.dist(pl, I.c) - I.r * 1.25;
        if (d < 110 && d < bd) { bd = d; near = w; }
      }
    } else {
      let bd = 95;
      for (const en of G.world().entities) {
        const q = G.L.pos[en.id]; if (!q) continue;
        const d = CW.dist(pl, q);
        if (d < 175 && !G.isSeen(G.wid, en.id)) { G.reveal(en.id); CW.sfx('step'); }
        if (d < bd && G.isSeen(G.wid, en.id)) { bd = d; near = en; }
      }
    }
    if (near !== G.near) { G.near = near; CW.ui.showHint(near); }
  }

  // Ease the camera and zoom towards the player, or the packet when "Camera follows" is on.
  function camTick(dt) {
    let target = G.player;
    if (G.packet && CW.ui.followPacket()) target = G.packetPos() || target;
    if (G.scene === 'over') {
      // if the whole journey fits, hold it still; on a small screen follow the boat
      const b = G.OW.bounds;
      const follow = Math.min(G.W_ / b.w, (G.H_ - 90) / b.h) < 0.3 ? 0.9 : 0.1;
      target = { x: G.player.x * follow, y: G.player.y * follow - 24 / G.cam.z };
    }
    const lead = G.scene === 'world' && !G.packet ? 0 : 0;
    const k = 1 - Math.pow(0.0025, dt);
    G.cam.x = CW.lerp(G.cam.x, target.x + lead, k);
    G.cam.y = CW.lerp(G.cam.y, target.y, k);
    let zt = G.baseZoom * G.zoomMul * 0.9;
    if (G.scene === 'world' && G.L) {
      const b = G.L.bounds;
      zt = CW.clamp(Math.min(G.W_ / b.w, G.H_ / b.h) * 1.9, 0.52, 0.95) * G.zoomMul;
    }
    if (G.scene === 'over') {
      const b = G.OW.bounds;
      const fit = Math.min(G.W_ / b.w, (G.H_ - 90) / b.h);
      zt = CW.clamp(fit, 0.3, 0.7) * G.zoomMul;
    }
    G.cam.z = CW.lerp(G.cam.z, zt, 1 - Math.pow(0.001, dt));
  }

  // ---------- render ----------
  function render() {
    const ctx = G.ctx, t = G.t;
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.clearRect(0, 0, G.W_, G.H_);
    const z = G.cam.z;
    const sh = G.shake > 0 ? G.shake * 22 : 0;
    const sx = sh ? (Math.random() - 0.5) * sh : 0, sy = sh ? (Math.random() - 0.5) * sh : 0;
    ctx.setTransform(G.dpr * z, 0, 0, G.dpr * z, G.dpr * (G.W_ / 2 - G.cam.x * z + sx), G.dpr * (G.H_ / 2 - G.cam.y * z + sy));
    const view = { x: G.cam.x - G.W_ / 2 / z, y: G.cam.y - G.H_ / 2 / z, w: G.W_ / z, h: G.H_ / z };
    CW.drawSea(ctx, view, t);
    if (G.scene === 'over') renderOver(ctx, t);
    else renderWorld(ctx, t);
  }

  function renderOver(ctx, t) {
    const ws = G.W.worlds;
    const k = Math.max(1, 0.5 / G.cam.z);
    for (const r of G.OW.route) {
      const a = G.OW.isl[r.from].c, b = G.OW.isl[r.to].c;
      const open = G.unlocked(G.worldById(r.to));
      CW.drawRoute(ctx, a, r.ctrl, b, t, open);
      const m = CW.qpoint(a, r.ctrl, b, 0.5);
      if (open && r.label && CW.dist(G.player, m) < 260) {
        ctx.save(); ctx.font = `600 ${Math.round(14 * k)}px ui-rounded, system-ui`; ctx.textAlign = 'center';
        const tw = Math.min(ctx.measureText(r.label).width, 520 * k) + 22 * k;
        ctx.fillStyle = 'rgba(13,34,48,0.88)'; CW.roundRect(ctx, m.x - tw / 2, m.y - 16 * k, tw, 30 * k, 15 * k); ctx.fill();
        ctx.fillStyle = '#d7e6ea'; ctx.fillText(r.label, m.x, m.y + 4 * k, 520 * k); ctx.restore();
      }
    }
    ws.forEach((w, i) => {
      const st = G.worldStatus(w.id);
      const locked = !G.unlocked(w);
      let reveal = 1;
      if (G.unlockFx && G.unlockFx.wid === w.id) reveal = Math.min(1, (G.t - G.unlockFx.t) / 2.5);
      CW.drawMiniIsland(ctx, w, G.OW.isl[w.id], t, {
        n: i + 1, locked, reveal, cleared: !locked && G.worldCleared(w), stars: G.worldStars(w), lockHint: locked ? G.lockHint(w) : '',
        fog: st === 'synced' ? null : st, near: G.near?.id === w.id, k,
      });
    });
    CW.drawPlayer(ctx, G.player, G.player.dir, t, true, G.player.moving);
    CW.guide.draw(ctx, t);
    CW.fx.draw(ctx);
  }

  function renderWorld(ctx, t) {
    const w = G.world(), L = G.L, th = CW.theme(w.theme);
    CW.drawIsland(ctx, L.poly, th, t);
    // dock
    ctx.save(); ctx.fillStyle = '#8a5a3b'; ctx.fillRect(L.dock.x - 130, L.dock.y - 14, 120, 28);
    ctx.fillStyle = '#6b4329'; for (let i = 0; i < 6; i++) ctx.fillRect(L.dock.x - 128 + i * 20, L.dock.y - 14, 3, 28); ctx.restore();
    for (const d of L.deco) CW.drawDeco(ctx, d, th);
    // district labels
    ctx.save(); ctx.font = '700 15px ui-rounded, system-ui'; ctx.textAlign = 'center';
    for (const lb of L.labels) { ctx.fillStyle = 'rgba(13,34,48,0.55)'; ctx.fillText(lb.name, lb.x, lb.y); }
    ctx.restore();
    const flow = G.flowSel ? G.flow(G.flowSel) : null;
    const inFlow = new Set(flow ? flow.steps.map((s) => s.at) : []);
    for (const r of L.roads) {
      if (!G.isSeen(w.id, r.a) || !G.isSeen(w.id, r.b)) continue;
      const hi = flow && r.flows.has(flow.id);
      CW.drawRoad(ctx, L.pos[r.a], r.ctrl, L.pos[r.b], th, { hi, dim: flow && !hi, t });
    }
    CW.mission.drawUnder(ctx, t, th);
    const act = G.activeStep() || CW.mission.currentStep();
    const badges = {};
    if (flow) flow.steps.forEach((s, i) => { if (!(s.at in badges)) badges[s.at] = String(i + 1); });
    const cracks = w.cracks || [];
    const order = w.entities.slice().sort((a, b) => (L.pos[a.id]?.y || 0) - (L.pos[b.id]?.y || 0));
    for (const en of order) {
      const p = L.pos[en.id]; if (!p) continue;
      if (!G.isSeen(w.id, en.id)) { CW.drawHidden(ctx, p, t); continue; }
      const status = G.entityStatus(w.id, en.id);
      const crack = cracks.some((k) => k.at === en.id && !G.state.cracks[w.id]?.[k.id]) && CW.dist(G.player, p) < 260;
      CW.drawEntity(ctx, en, p, t, {
        active: act && act.at === en.id, near: G.near?.id === en.id, selected: G.selected === en.id,
        dimmed: flow && !inFlow.has(en.id), visited: G.state.visited[w.id]?.[en.id], status, crack, badge: badges[en.id],
      });
      if (status === 'stale' || status === 'lost') CW.drawFog(ctx, { x: p.x, y: p.y - 10 }, 75, t, 0.9);
    }
    // packet
    const P = G.packet;
    if (P) {
      const pp = G.packetPos();
      const col = P.done
        ? (P.outcomeKind === 'success' ? CW.C.pass : P.outcomeKind === 'blocked' ? CW.C.block : CW.C.error)
        : P.source === 'ai' ? '#8ff0ff' : CW.C.lantern;
      let bounce = 0;
      if (P.done && P.outcomeKind !== 'success') bounce = Math.max(0, 1 - P.doneAge * 1.5) * Math.sin(P.doneAge * 22) * 10;
      CW.drawPacket(ctx, { x: pp.x + bounce, y: pp.y }, t, col, 1);
      if (P.done) CW.drawStamp(ctx, pp, P.outcomeKind, P.doneAge);
    }
    CW.drawPlayer(ctx, G.player, G.player.dir, t, false, G.player.moving);
    CW.mission.drawOver(ctx, t);
    CW.guide.draw(ctx, t);
    CW.fx.draw(ctx);
  }

  // ---------- loop ----------
  let last = 0;
  function frame(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    G.t += dt;
    if (G.W) {
      moveTick(dt); if (G.scene === 'world') CW.mission.tick(dt); nearTick(); tickPacket(dt); camTick(dt);
      CW.fx.tick(dt); if (G.shake > 0) G.shake = Math.max(0, G.shake - dt);
      render();
      CW.ui.frame();
    }
    requestAnimationFrame(frame);
  }

  G.resize = function () {
    const c = G.canvas;
    G.dpr = Math.min(2, window.devicePixelRatio || 1);
    G.W_ = c.clientWidth; G.H_ = c.clientHeight;
    c.width = Math.round(G.W_ * G.dpr); c.height = Math.round(G.H_ * G.dpr);
    G.baseZoom = CW.clamp(Math.min(G.W_, G.H_) / 820, 0.42, 1.05);
  };

  // Wire keyboard, mouse and resize once, then start the frame loop.
  G.start = function (canvas) {
    G.canvas = canvas; G.ctx = canvas.getContext('2d');
    G.resize();
    window.addEventListener('resize', G.resize);
    const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    window.addEventListener('keydown', (e) => {
      if (typing()) { if (e.key === 'Escape') document.activeElement.blur(); return; }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
      G.keys[k] = true;
      if (k === 'e' || k === 'Enter') G.interact();
      if (k === ' ') { if (G.mission?.phase === 'choose' && G.mission.signs.length === 1) CW.mission.choose(0); else G.nextStep(); }
      if (/^[1-9]$/.test(k) && G.mission?.phase === 'choose') CW.mission.choose(Number(k) - 1);
      if (k === 'Escape') CW.ui.escape();
      if (k === 'm' && G.scene === 'world') G.setSail();
      if (k === 'q') CW.ui.togglePane('quests');
      if (k === 'n') CW.ui.togglePane('notes');
      if (k === '+' || k === '=') G.zoomMul = CW.clamp(G.zoomMul * 1.15, 0.4, 2.2);
      if (k === '-') G.zoomMul = CW.clamp(G.zoomMul / 1.15, 0.4, 2.2);
    });
    window.addEventListener('keyup', (e) => { G.keys[e.key.length === 1 ? e.key.toLowerCase() : e.key] = false; });
    window.addEventListener('blur', () => { G.keys = {}; });
    canvas.addEventListener('pointerdown', (e) => { canvas.focus(); G.click(e.offsetX, e.offsetY); });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      G.zoomMul = CW.clamp(G.zoomMul * (e.deltaY > 0 ? 0.9 : 1.1), 0.4, 2.2);
    }, { passive: false });
    requestAnimationFrame(frame);
  };

  // Load (or reload) a world and saved progress. Keeps the current scene if that world still exists.
  G.load = function ({ world, sync, state }) {
    G.W = world; G.sync = sync || null;
    G.state = Object.assign(CW.freshState(), state || {});
    G.OW = CW.layoutOverworld(world);
    G.layouts = {};
    if (G.scene === 'world' && G.wid && G.worldById(G.wid)) { G.L = G.layout(G.wid); }
    else { G.scene = 'over'; G.player.x = G.OW.start.x; G.player.y = G.OW.start.y; G.cam.x = 0; G.cam.y = 0; }
  };
})(window.CW);
