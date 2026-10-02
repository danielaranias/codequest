/* CodeQuest — turns world.json into positions: an overworld of islands, and one island per world.
   Pure functions of the world data and a seeded RNG, so the same repo always gets the same map.
   Must not draw, read game state or touch the DOM. */
(function (CW) {
  'use strict';

  // A wobbly ellipse of n points: the coastline of an island.
  function blob(seed, rx, ry, n) {
    const r = CW.rng(seed);
    const a = r() * 6.28, b = r() * 6.28, c = r() * 6.28;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const k = 1 + 0.07 * Math.sin(3 * t + a) + 0.045 * Math.sin(5 * t + b) + 0.025 * Math.sin(11 * t + c);
      pts.push({ x: Math.cos(t) * rx * k, y: Math.sin(t) * ry * k });
    }
    return pts;
  }
  CW.blob = blob;

  // One island: districts become columns, buildings are placed down each column with a little jitter.
  CW.layoutWorld = function (w) {
    const r = CW.rng('layout:' + w.id);
    const districts = (w.districts || []).slice();
    const byD = new Map(districts.map((d) => [d.id, []]));
    const loose = [];
    for (const en of w.entities || []) (byD.get(en.district) || loose).push(en);
    if (loose.length) { districts.push({ id: '__else', name: 'Elsewhere' }); byD.set('__else', loose); }
    const cols = districts.filter((d) => byD.get(d.id).length);
    const colW = 310, rowH = 175;
    const maxRows = Math.max(1, ...cols.map((d) => byD.get(d.id).length));
    const cw = cols.length * colW, ch = maxRows * rowH + rowH * 0.4;
    const pos = {};
    const labels = [];
    cols.forEach((d, ci) => {
      const list = byD.get(d.id);
      const x0 = -cw / 2 + colW * (ci + 0.5);
      const colH = list.length * rowH;
      const y0 = -colH / 2 + rowH / 2 + (ci % 2 ? rowH * 0.22 : -rowH * 0.12);
      list.forEach((en, ri) => {
        pos[en.id] = { x: x0 + (r() - 0.5) * 70, y: y0 + ri * rowH + (r() - 0.5) * 34 };
      });
      labels.push({ id: d.id, name: d.name, x: x0, y: -ch / 2 - 58 });
    });
    const rx = cw / 2 + 190, ry = ch / 2 + 175;
    const poly = blob('island:' + w.id, rx, ry, 120);

    // Roads: one per pair of entities joined by any flow edge.
    const roads = new Map();
    for (const f of w.flows || []) {
      const at = Object.fromEntries((f.steps || []).map((s) => [s.id, s.at]));
      for (const s of f.steps || []) {
        for (const n of s.next || []) {
          if (n.to.startsWith('outcome:')) continue;
          const a = s.at, b = at[n.to];
          if (!a || !b || a === b || !pos[a] || !pos[b]) continue;
          const key = a < b ? a + '|' + b : b + '|' + a;
          if (!roads.has(key)) {
            const rr = CW.rng('road:' + w.id + key);
            const pa = pos[a < b ? a : b], pb = pos[a < b ? b : a];
            roads.set(key, { key, a: a < b ? a : b, b: a < b ? b : a, flows: new Set(), ctrl: CW.curveCtrl(pa, pb, (rr() - 0.5) * 120) });
          }
          roads.get(key).flows.add(f.id);
        }
      }
    }
    // Trees / rocks for texture, kept away from buildings and roads' ends.
    const deco = [];
    for (let i = 0; i < 70; i++) {
      const p = { x: (r() - 0.5) * rx * 2, y: (r() - 0.5) * ry * 2 };
      if (!CW.pointInPoly(p, poly)) continue;
      if (Object.values(pos).some((q) => CW.dist(p, q) < 95)) continue;
      if (labels.some((l) => Math.abs(l.x - p.x) < 90 && Math.abs(l.y - p.y) < 40)) continue;
      deco.push({ x: p.x, y: p.y, s: 0.7 + r() * 0.6, k: r() });
    }
    return {
      id: w.id, pos, labels, poly, rx, ry, roads: [...roads.values()], deco,
      dock: { x: -rx + 60, y: 0 },
      bounds: { x: -rx - 260, y: -ry - 260, w: rx * 2 + 520, h: ry * 2 + 520 },
    };
  };

  // The journey: worlds in their real order along one snaking route (rows of up to 4).
  CW.layoutOverworld = function (world) {
    const ws = world.worlds;
    const n = ws.length;
    const cols = n <= 5 ? n : Math.min(4, Math.ceil(n / 2));
    const dx = 560, dy = 520;
    const rows = Math.ceil(n / cols);
    const isl = {};
    ws.forEach((w, i) => {
      const row = Math.floor(i / cols), k = i % cols;
      const col = row % 2 ? cols - 1 - k : k;                 // snake: every other row runs back
      const rr = CW.rng('ow:' + w.id);
      const size = 112 + Math.min(16, (w.entities || []).length) * 2.6;
      const c = {
        x: (col - (cols - 1) / 2) * dx + (rr() - 0.5) * 50,
        y: (row - (rows - 1) / 2) * dy + (k % 2 ? 70 : -70) * (rows > 1 ? 0.55 : 1) + (rr() - 0.5) * 30,
      };
      isl[w.id] = { c, r: size, poly: blob('island:' + w.id, size * 1.25, size, 64).map((p) => ({ x: p.x + c.x, y: p.y + c.y })) };
    });
    const route = [];
    for (let i = 0; i + 1 < n; i++) {
      const a = isl[ws[i].id].c, b = isl[ws[i + 1].id].c;
      const br = (world.bridges || []).find((x) =>
        (x.from === ws[i].id && x.to === ws[i + 1].id) || (x.to === ws[i].id && x.from === ws[i + 1].id));
      route.push({ from: ws[i].id, to: ws[i + 1].id, ctrl: CW.curveCtrl(a, b, i % 2 ? 60 : -60), label: br?.label || '' });
    }
    const first = isl[ws[0].id];
    const w2 = ((cols - 1) / 2) * dx + 360, h2 = ((rows - 1) / 2) * dy + 340;
    return {
      isl, route, lanes: [],
      start: { x: first.c.x - first.r * 1.25 - 120, y: first.c.y + 30 },
      bounds: { x: -w2, y: -h2, w: w2 * 2, h: h2 * 2 } };
  };
})(window.CW);
