/* CodeQuest — missions: the player carries one real case through a flow and must choose
   the road the code really takes at every fork. Also: unlocking worlds in journey order.
   Owns G.mission and the stars in G.state.missions. Must not build DOM — the caption and
   the dock are drawn by the ui-*.js files after CW.ui.onMission(). */
(function (CW) {
  'use strict';
  const G = CW.game;
  const M = (CW.mission = {});
  const mkey = (wid, fid, cid) => `${wid}/${fid}/${cid}`;

  // ---------- progress ----------
  G.stars = (wid, fid, cid) => G.state.missions[mkey(wid, fid, cid)] || 0;
  G.playableFlows = (w) => w.flows.filter((f) => (f.cases || []).length);
  G.flowBeaten = (w, f) => (f.cases || []).some((c) => G.stars(w.id, f.id, c.id) > 0);
  G.worldCleared = (w) => G.playableFlows(w).every((f) => G.flowBeaten(w, f));
  G.worldIndex = (wid) => G.W.worlds.findIndex((w) => w.id === wid);
  // A world is open when every world before it is cleared (or free roam is on).
  G.unlocked = function (w) {
    const i = G.worldIndex(w.id);
    if (i <= 0 || G.state.freeRoam) return true;
    const prev = G.W.worlds[i - 1];
    return G.unlocked(prev) && G.worldCleared(prev);
  };
  G.worldStars = function (w) {
    let got = 0, max = 0;
    for (const f of w.flows) for (const c of f.cases || []) { got += G.stars(w.id, f.id, c.id); max += 3; }
    return { got, max };
  };
  G.missionCount = function (w) {
    let done = 0, total = 0;
    for (const f of w.flows) for (const c of f.cases || []) { total++; if (G.stars(w.id, f.id, c.id)) done++; }
    return { done, total };
  };
  // The next thing to play: first an unbeaten flow (that is what opens the next world), then the rest.
  G.nextMission = function (w) {
    for (const f of G.playableFlows(w)) if (!G.flowBeaten(w, f)) return { flow: f, kase: f.cases[0] };
    for (const f of G.playableFlows(w)) for (const c of f.cases) if (!G.stars(w.id, f.id, c.id)) return { flow: f, kase: c };
    return null;
  };
  G.isSeen = (wid, eid) => !!(G.state.freeRoam || G.state.seen[wid]?.[eid] || G.state.visited[wid]?.[eid]);
  // Lift the fog from one building. Returns false if it was already seen.
  G.reveal = function (eid) {
    const bag = (G.state.seen[G.wid] = G.state.seen[G.wid] || {});
    if (bag[eid]) return false;
    bag[eid] = 1;
    const p = G.L.pos[eid];
    if (p) CW.fx.burst(p.x, p.y - 20, '#eaf4f4', 10);
    G.save();
    return true;
  };

  // ---------- one mission ----------
  const cur = () => G.stepById(G.mission.flow, G.mission.kase.path[G.mission.i]);
  M.currentStep = () => (G.mission && G.mission.phase !== 'goto' ? cur() : null);
  // Where the mission caption should point: the building of the current step.
  M.anchor = function () {
    const m = G.mission; if (!m) return null;
    const s = cur();
    return G.L.pos[s.at] || G.L.dock;
  };

  M.start = function (flow, kase) {
    if (!kase?.path?.length) return;
    G.stopPacket(); G.flowSel = null; G.lab = false;
    CW.ui.closeDrawer();
    G.mission = {
      flow, kase, i: 0, hearts: 3, mistakes: 0, phase: 'goto',
      signs: [], trail: [], age: 0, combo: 0, lastWrong: null, result: null };
    const first = G.stepById(flow, kase.path[0]);
    G.reveal(first.at);
    CW.sfx('start');
    CW.ui.onMission();
  };
  M.quit = function () { G.mission = null; CW.ui.onMission(); };

  // The road signs at a fork: one per way out of `step`, shuffled, placed around the building.
  function signsFor(step) {
    const m = G.mission;
    const correctTo = m.i + 1 < m.kase.path.length ? m.kase.path[m.i + 1] : 'outcome:' + m.kase.outcome;
    let edges = (step.next || []).map((n) => ({ to: n.to, when: n.when }));
    if (!edges.some((e) => e.to === correctTo)) edges.push({ to: correctTo, when: 'this case' }); // map gap: never strand the player
    const r = CW.rng(step.id + m.kase.id + m.flow.id);
    for (let i = edges.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]]; }
    const base = G.L.pos[step.at] || G.L.dock;
    const n = edges.length;
    // Try a few arcs around the building and keep the one that stays on land and clear of other buildings.
    const others = Object.entries(G.L.pos).filter(([id]) => id !== step.at).map(([, q]) => q);
    const arcs = [
      (a) => ({ x: base.x + Math.cos(a) * 190, y: base.y + 60 + Math.sin(a) * 105 }),   // below
      (a) => ({ x: base.x + Math.cos(a) * 190, y: base.y - 70 - Math.sin(a) * 95 }),    // above
      (a) => ({ x: base.x + 120 + Math.sin(a) * 110, y: base.y - Math.cos(a) * 150 }),  // right
      (a) => ({ x: base.x - 120 - Math.sin(a) * 110, y: base.y - Math.cos(a) * 150 }),  // left
    ];
    let bestPts = null, bestScore = -Infinity;
    arcs.forEach((arc, ai) => {
      const pts = edges.map((_, k) => arc(Math.PI * (0.12 + 0.76 * ((k + 0.5) / n))));
      let score = ai === 0 ? 120 : 0;                       // below is best: the caption sits above
      for (const q of pts) {
        if (!CW.pointInPoly(q, G.L.poly)) score -= 1000;
        if (q.y < base.y - 30) score -= 90;
        score += Math.min(160, ...others.map((o) => CW.dist(q, o)));
      }
      if (score > bestScore) { bestScore = score; bestPts = pts; }
    });
    return edges.map((e, k) => {
      const p = bestPts[k];
      let label, end = false;
      if (e.to.startsWith('outcome:')) {
        const o = m.flow.outcomes.find((x) => x.id === e.to.slice(8));
        label = 'End: ' + (o?.label || e.to.slice(8)); end = true;
      } else {
        const ns = G.stepById(m.flow, e.to);
        const en = G.entity(ns?.at);
        label = (ns?.at === step.at ? 'Stay at ' : 'Go to ') + (en?.name || e.to);
      }
      return { to: e.to, when: e.when, label, end, x: p.x, y: p.y, correct: e.to === correctTo, dead: false, only: n === 1 };
    });
  }

  // The player reached the current step: put up the signs and ask which road.
  function arrive() {
    const m = G.mission, step = cur();
    G.reveal(step.at);
    m.phase = 'choose'; m.age = 0; m.lastWrong = null;
    m.signs = signsFor(step);
    const p = G.L.pos[step.at];
    if (p) { G.player.x = p.x - 58; G.player.y = p.y + 26; G.player.target = null; }
    CW.sfx('step');
    CW.ui.onMission();
  }

  // The player picked sign `k`. Wrong costs a heart; right travels to the next step or wins.
  M.choose = function (k) {
    const m = G.mission;
    if (!m || m.phase !== 'choose') return;
    const s = m.signs[k];
    if (!s || s.dead) return;
    if (!s.correct) {
      s.dead = true; m.hearts--; m.mistakes++; m.combo = 0; m.lastWrong = s;
      G.shake = 0.35; CW.sfx('wrong'); CW.fx.text(s.x, s.y - 30, '✕', CW.C.block);
      if (m.hearts <= 0) { m.phase = 'lost'; m.age = 0; m.answer = m.signs.find((x) => x.correct); m.signs = []; CW.sfx('lose'); }
      CW.ui.onMission();
      return;
    }
    m.combo++;
    CW.sfx('right'); CW.fx.burst(s.x, s.y - 20, CW.C.lantern, 14);
    if (s.end) return win();
    const step = cur(), next = G.stepById(m.flow, s.to);
    const a = G.L.pos[step.at], b = G.L.pos[next.at] || a;
    const key = step.at < next.at ? step.at + '|' + next.at : next.at + '|' + step.at;
    const road = G.L.roads.find((r) => r.key === key);
    m.travel = { a, b, ctrl: road ? road.ctrl : CW.curveCtrl(a, b, 40), t: 0, same: step.at === next.at };
    if (!m.travel.same) m.trail.push(key);
    m.phase = 'travel'; m.signs = [];
    G.reveal(next.at);
    CW.ui.onMission();
  };

  // Record stars (3 minus mistakes, at least 1), award XP, and unlock the next world if this cleared the world.
  function win() {
    const m = G.mission, w = G.world();
    m.phase = 'won'; m.age = 0; m.signs = [];
    const stars = Math.max(1, 3 - m.mistakes);
    const k = mkey(w.id, m.flow.id, m.kase.id);
    const before = G.state.missions[k] || 0;
    const wasCleared = G.worldCleared(w);
    const outcome = m.flow.outcomes.find((o) => o.id === m.kase.outcome);
    m.result = { stars, outcome, kind: outcome?.kind || 'success', best: Math.max(before, stars), first: !before };
    if (stars > before) {
      G.state.missions[k] = stars;
      G.award((stars - before) * 10 + (before ? 0 : 5), before ? 'better run' : 'mission complete');
    }
    G.markTraced(m.flow);
    CW.sfx(stars === 3 ? 'win3' : 'win');
    const p = M.anchor();
    CW.fx.burst(p.x, p.y - 40, CW.C.lantern, 26);
    if (!wasCleared && G.worldCleared(w)) {
      const next = G.W.worlds[G.worldIndex(w.id) + 1];
      m.result.unlocked = next || null;
      m.result.cleared = true;
      if (next) { G.unlockFx = { wid: next.id, t: G.t }; CW.ui.toast(`World unlocked: ${next.name}`, 'badge'); }
      else CW.ui.toast('You reached the end of the journey', 'badge');
      setTimeout(() => CW.sfx('unlock'), 500);
    }
    G.checkBadges(); G.save();
    CW.ui.onMission();
  }

  M.retry = function () { const m = G.mission; if (m) M.start(m.flow, m.kase); };
  M.next = function () {
    const n = G.nextMission(G.world());
    if (n) M.start(n.flow, n.kase); else M.quit();
  };

  // Per frame: detect arriving at the start, walking into a sign, and animate travel along the road.
  M.tick = function (dt) {
    const m = G.mission; if (!m) return;
    m.age += dt;
    if (m.phase === 'goto') {
      const p = G.L.pos[cur().at];
      if (p && CW.dist(G.player, p) < 90) arrive();
    } else if (m.phase === 'choose') {
      if (m.age > 0.5 && G.player.moving) {
        for (let k = 0; k < m.signs.length; k++) {
          const s = m.signs[k];
          if (!s.dead && CW.dist(G.player, s) < 36) { M.choose(k); break; }
        }
      }
    } else if (m.phase === 'travel') {
      const tr = m.travel;
      const len = Math.max(160, CW.dist(tr.a, tr.b));
      tr.t += (dt * 560) / len;
      const k = CW.ease(Math.min(1, tr.t));
      const q = tr.same ? { x: tr.a.x, y: tr.a.y - Math.sin(k * Math.PI) * 40 } : CW.qpoint(tr.a, tr.ctrl, tr.b, k);
      const before = { x: G.player.x, y: G.player.y };
      G.player.x = q.x - 58 * (tr.same ? 1 : Math.abs(2 * k - 1)); G.player.y = q.y + 26; G.player.moving = true;
      G.player.dir = Math.atan2(G.player.y - before.y, G.player.x - before.x);
      if (tr.t >= 1) { m.i++; arrive(); }
    }
  };

  // ---------- drawing (called from the world renderer) ----------
  M.drawUnder = function (ctx, t, th) {
    const m = G.mission; if (!m) return;
    for (const key of m.trail) {
      const r = G.L.roads.find((x) => x.key === key);
      if (r) CW.drawRoad(ctx, G.L.pos[r.a], r.ctrl, G.L.pos[r.b], th, { hi: true, t });
    }
    if (m.phase === 'goto') {
      const p = G.L.pos[cur().at];
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.7 + i / 3) % 1);
        ctx.strokeStyle = `rgba(255,200,87,${0.7 * (1 - k)})`; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 8, 40 + k * 70, 16 + k * 28, 0, 0, 7); ctx.stroke();
      }
      // dotted guide from the player
      ctx.setLineDash([4, 14]); ctx.lineDashOffset = -t * 40; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,200,87,0.85)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(G.player.x, G.player.y); ctx.lineTo(p.x, p.y + 30); ctx.stroke();
      ctx.restore();
    }
    if (m.phase === 'choose') {
      const base = M.anchor();
      for (const s of m.signs) {
        ctx.save(); ctx.lineCap = 'round'; ctx.setLineDash([3, 11]); ctx.lineDashOffset = -t * 24;
        ctx.strokeStyle = s.dead ? 'rgba(255,107,107,0.35)' : 'rgba(255,246,214,0.9)'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(base.x, base.y + 30); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.restore();
      }
    }
  };
  M.drawOver = function (ctx, t) {
    const m = G.mission; if (!m) return;
    if (m.phase === 'choose') m.signs.forEach((s, k) => CW.drawSign(ctx, s, k + 1, t, CW.dist(G.player, s) < 80));
    if (m.phase === 'won') CW.drawStamp(ctx, M.anchor(), 'success', m.age);
    if (m.phase !== 'won' && m.phase !== 'lost') CW.drawPacket(ctx, { x: G.player.x, y: G.player.y - 34 }, t, CW.C.lantern, 0.8);
  };
})(window.CW);
