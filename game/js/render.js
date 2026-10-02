/* CodeQuest — canvas drawing. Everything is drawn from code; no image assets.
   Each CW.draw* function draws one thing at the place it is given.
   Must not read or change game state: the engine decides what to draw and where. */
(function (CW) {
  'use strict';

  CW.THEMES = {
    meadow: { land: '#86b56a', edge: '#5f8f4b', sand: '#e9d79e', road: '#efe2b4', tree: '#4f7d3c' },
    desert: { land: '#dcb067', edge: '#b88b46', sand: '#f1dca6', road: '#fff0c8', tree: '#8a9a4a' },
    tundra: { land: '#dce9ee', edge: '#a6c1cd', sand: '#f2f8fa', road: '#9fb9c6', tree: '#6f8f86' },
    volcano: { land: '#74504a', edge: '#4c332e', sand: '#b07a62', road: '#f08a4b', tree: '#3a2522' },
    ocean: { land: '#62b8aa', edge: '#3f8d82', sand: '#f0e2b2', road: '#fbf1cf', tree: '#2f7a62' },
    forest: { land: '#4f8250', edge: '#365c35', sand: '#d3c38c', road: '#e6d6a0', tree: '#2c5530' },
    city: { land: '#8d99aa', edge: '#677382', sand: '#cdd3db', road: '#e9edf2', tree: '#5e7d6a' },
    crystal: { land: '#9585c9', edge: '#6c5ca3', sand: '#ddd4f3', road: '#fbf8ff', tree: '#5c4b94' },
  };
  CW.theme = (name) => CW.THEMES[name] || CW.THEMES.meadow;

  CW.KIND = {
    entry: { label: 'Entry', color: '#ffd166', glyph: '◎' },
    ui: { label: 'Screen', color: '#7cc8ff', glyph: '▭' },
    module: { label: 'Logic', color: '#f3ead7', glyph: '⚙' },
    agent: { label: 'Agent', color: '#ff9d6c', glyph: '☺' },
    skill: { label: 'Skill / tool', color: '#c3a8ff', glyph: '✦' },
    guardrail: { label: 'Guardrail', color: '#ff6f6f', glyph: '⛨' },
    store: { label: 'Store', color: '#66e0aa', glyph: '◫' },
    external: { label: 'External', color: '#8ff0ff', glyph: '◇' },
    config: { label: 'Config / prompt', color: '#f3c77a', glyph: '≡' },
  };

  CW.C = {
    sea: '#123a4f', sea2: '#18475f', ink: '#eaf4f4', dark: '#0d2230',
    lantern: '#ffc857', pass: '#5fe0a3', block: '#ff6b6b', error: '#ffa24c', drift: '#f5b84a', fog: '#d7e2e8',
  };

  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
  // The same outline scaled by k around centre c.
  function scaled(pts, k, c) {
    c = c || { x: 0, y: 0 };
    return pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
  }

  CW.drawSea = function (ctx, view, t) {
    ctx.fillStyle = CW.C.sea;
    ctx.fillRect(view.x, view.y, view.w, view.h);
    // drifting swell lines, like a chart's sea pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 2;
    const step = 46;
    const y0 = Math.floor(view.y / step) * step;
    for (let y = y0; y < view.y + view.h + step; y += step) {
      ctx.beginPath();
      for (let x = view.x - 40; x < view.x + view.w + 40; x += 24) {
        const yy = y + Math.sin(x * 0.012 + y * 0.07 + t * 0.6) * 5;
        x === view.x - 40 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  };

  CW.drawIsland = function (ctx, pts, th, t, center) {
    center = center || { x: 0, y: 0 };
    // surf ring
    ctx.save();
    poly(ctx, scaled(pts, 1.06 + Math.sin(t * 1.2) * 0.004, center));
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    poly(ctx, scaled(pts, 1.025, center));
    ctx.fillStyle = th.sand;
    ctx.fill();
    poly(ctx, pts);
    ctx.fillStyle = th.land;
    ctx.fill();
    // contour lines
    ctx.strokeStyle = th.edge;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    for (const k of [0.86, 0.7]) { poly(ctx, scaled(pts, k, center)); ctx.stroke(); }
    ctx.restore();
  };

  CW.drawDeco = function (ctx, d, th) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.scale(d.s, d.s);
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    ctx.beginPath(); ctx.ellipse(4, 10, 16, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = th.tree;
    if (d.k < 0.7) {
      ctx.beginPath(); ctx.arc(0, -6, 14, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(-4, -10, 6, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.moveTo(-12, 6); ctx.lineTo(-4, -8); ctx.lineTo(8, -4); ctx.lineTo(13, 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };

  CW.drawRoad = function (ctx, a, c, b, th, opts) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = opts.hi ? 20 : 15;
    ctx.stroke();
    ctx.strokeStyle = opts.hi ? '#fff6d6' : th.road;
    ctx.globalAlpha = opts.dim ? 0.35 : 1;
    ctx.lineWidth = opts.hi ? 13 : 9;
    ctx.stroke();
    if (opts.hi) {
      ctx.setLineDash([2, 16]);
      ctx.lineDashOffset = -opts.t * 30;
      ctx.strokeStyle = CW.C.lantern;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.restore();
  };

  // ---- buildings by kind ----
  const DRAW = {
    entry(ctx, t) {
      ctx.lineWidth = 9; ctx.strokeStyle = '#3b2f2a';
      ctx.beginPath(); ctx.arc(0, -18, 26, Math.PI, 0); ctx.lineTo(26, 12); ctx.moveTo(-26, 12); ctx.lineTo(-26, -18); ctx.stroke();
      ctx.lineWidth = 5; ctx.strokeStyle = CW.KIND.entry.color; ctx.stroke();
      ctx.fillStyle = `rgba(255,209,102,${0.35 + Math.sin(t * 3) * 0.15})`;
      ctx.beginPath(); ctx.ellipse(0, -6, 17, 20, 0, 0, 7); ctx.fill();
    },
    ui(ctx) {
      ctx.fillStyle = '#e9f2f8'; ctx.fillRect(-30, -26, 60, 40);
      ctx.fillStyle = CW.KIND.ui.color; ctx.fillRect(-34, -34, 68, 12);
      ctx.fillStyle = '#ffffff'; for (let i = 0; i < 4; i++) ctx.fillRect(-34 + i * 17, -22, 9, 5);
      ctx.fillStyle = '#2a4d63'; ctx.fillRect(-22, -14, 22, 14); ctx.fillRect(6, -14, 14, 28);
    },
    module(ctx, t) {
      ctx.fillStyle = '#efe4cf'; ctx.fillRect(-28, -22, 56, 36);
      ctx.fillStyle = '#9b5d43'; ctx.beginPath(); ctx.moveTo(-34, -20);
      ctx.lineTo(0, -44); ctx.lineTo(34, -20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5b4a3a'; ctx.fillRect(-7, -4, 14, 18);
      ctx.save(); ctx.translate(20, -36); ctx.rotate(t * 0.8); ctx.fillStyle = '#d9d2c3';
      for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.fillRect(-2.5, -11, 5, 6); }
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, 7); ctx.fill(); ctx.restore();
    },
    agent(ctx, t) {
      const bob = Math.sin(t * 2.4) * 2.5;
      ctx.translate(0, bob);
      ctx.fillStyle = CW.KIND.agent.color;
      ctx.beginPath(); ctx.moveTo(-18, 14); ctx.quadraticCurveTo(0, -28, 18, 14); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffe2c6'; ctx.beginPath(); ctx.arc(0, -20, 12, 0, 7); ctx.fill();
      ctx.fillStyle = '#2b2b33'; ctx.fillRect(-6, -22, 3, 3); ctx.fillRect(3, -22, 3, 3);
      // thinking dots
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const a = (Math.sin(t * 3 - i) + 1) / 2;
        ctx.globalAlpha = 0.3 + a * 0.7;
        ctx.beginPath(); ctx.arc(16 + i * 7, -40, 2.6, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    skill(ctx, t) {
      ctx.fillStyle = '#d8d0ea'; ctx.fillRect(-20, 4, 40, 10);
      ctx.fillStyle = '#ece6f8'; ctx.beginPath(); ctx.moveTo(-11, 6); ctx.lineTo(-6, -34);
      ctx.lineTo(6, -34); ctx.lineTo(11, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = `rgba(195,168,255,${0.55 + Math.sin(t * 2.2) * 0.3})`;
      ctx.beginPath(); ctx.moveTo(0, -54); ctx.lineTo(8, -42); ctx.lineTo(0, -32); ctx.lineTo(-8, -42); ctx.closePath(); ctx.fill();
    },
    guardrail(ctx, t) {
      ctx.fillStyle = '#cfc8bd'; ctx.fillRect(-16, -40, 32, 54);
      ctx.fillStyle = '#b8b0a3'; for (let i = 0; i < 3; i++) ctx.fillRect(-16 + i * 12, -48, 8, 9);
      ctx.fillStyle = '#4a3f39'; ctx.beginPath(); ctx.arc(0, 2, 8, Math.PI, 0); ctx.fillRect(-8, 2, 16, 12); ctx.fill();
      ctx.strokeStyle = '#6b5e55'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, -48); ctx.lineTo(14, -70); ctx.stroke();
      ctx.fillStyle = CW.C.block; ctx.beginPath(); ctx.moveTo(14, -70);
      ctx.lineTo(32 + Math.sin(t * 4) * 3, -64); ctx.lineTo(14, -58); ctx.fill();
    },
    store(ctx) {
      ctx.fillStyle = '#3f8f72'; ctx.fillRect(-24, -26, 48, 36);
      ctx.fillStyle = CW.KIND.store.color; ctx.beginPath(); ctx.ellipse(0, -26, 24, 9, 0, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0, 10, 24, 9, 0, 0, Math.PI); ctx.fillStyle = '#3f8f72'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
      for (const y of [-12, 0]) { ctx.beginPath(); ctx.ellipse(0, y, 24, 9, 0, 0, Math.PI); ctx.stroke(); }
    },
    external(ctx, t) {
      const f = Math.sin(t * 1.8) * 5;
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.ellipse(0, 12, 18, 6, 0, 0, 7); ctx.fill();
      ctx.translate(0, -26 + f); ctx.rotate(Math.sin(t) * 0.1);
      ctx.fillStyle = '#2b6f86'; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(22, 0);
      ctx.lineTo(0, 26); ctx.lineTo(-22, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = CW.KIND.external.color; ctx.beginPath(); ctx.moveTo(0, -17);
      ctx.lineTo(13, 0); ctx.lineTo(0, 17); ctx.lineTo(-13, 0); ctx.closePath(); ctx.fill();
    },
    config(ctx) {
      const cols = ['#c9784f', '#5f8fb3', '#e2b65c', '#7aa66a'];
      ctx.fillStyle = '#6d5440'; ctx.fillRect(-30, -40, 60, 54);
      for (let s = 0; s < 3; s++) {
        for (let i = 0; i < 6; i++) { ctx.fillStyle = cols[(i + s) % 4]; ctx.fillRect(-26 + i * 9, -36 + s * 17, 7, 14); }
      }
    },
  };

  CW.drawEntity = function (ctx, en, p, t, st) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (st.dimmed) ctx.globalAlpha = 0.42;
    // highlight disc
    if (st.active) {
      ctx.fillStyle = `rgba(255,200,87,${0.28 + Math.sin(t * 5) * 0.12})`;
      ctx.beginPath(); ctx.ellipse(0, 8, 56, 24, 0, 0, 7); ctx.fill();
    } else if (st.near || st.selected) {
      ctx.strokeStyle = st.selected ? '#ffffff' : 'rgba(255,255,255,0.7)';
      ctx.setLineDash([6, 6]); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(0, 8, 54, 22, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(3, 13, 34, 10, 0, 0, 7); ctx.fill();
    if (st.status === 'lost') {
      ctx.fillStyle = '#7f7f7f'; ctx.fillRect(-24, -6, 14, 18); ctx.fillRect(2, -14, 10, 26); ctx.fillRect(-6, 4, 24, 8);
    } else {
      ctx.save(); (DRAW[en.kind] || DRAW.module)(ctx, t + (p.x % 7)); ctx.restore();
    }
    // crack shimmer
    if (st.crack) {
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + Math.sin(t * 6) * 0.4})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-30, -44); ctx.lineTo(-22, -34); ctx.lineTo(-28, -26); ctx.lineTo(-18, -16); ctx.stroke();
      ctx.fillStyle = CW.C.lantern; ctx.font = '700 15px ui-rounded, system-ui'; ctx.fillText('?', -42, -42);
    }
    // status pip
    if (st.status === 'drifted') { ctx.fillStyle = CW.C.drift; ctx.beginPath(); ctx.arc(30, -40, 6, 0, 7); ctx.fill(); }
    if (st.visited) {
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(-34, 12); ctx.lineTo(-34, -6); ctx.stroke();
      ctx.fillStyle = CW.C.pass; ctx.beginPath(); ctx.moveTo(-34, -8); ctx.lineTo(-22, -4); ctx.lineTo(-34, 0); ctx.fill();
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-34, -8); ctx.lineTo(-34, 14); ctx.stroke();
    }
    if (st.badge) {
      ctx.fillStyle = CW.C.lantern; ctx.beginPath(); ctx.arc(34, -10, 11, 0, 7); ctx.fill();
      ctx.fillStyle = '#2a1d00'; ctx.font = '700 12px ui-rounded, system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(st.badge, 34, -10);
    }
    // label
    ctx.font = '600 13px ui-rounded, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const name = en.name.length > 26 ? en.name.slice(0, 25) + '…' : en.name;
    const w = ctx.measureText(name).width + 16;
    ctx.fillStyle = st.status === 'stale' ? 'rgba(80,96,108,0.85)' : 'rgba(13,34,48,0.82)';
    roundRect(ctx, -w / 2, 26, w, 22, 11); ctx.fill();
    ctx.fillStyle = '#eaf4f4'; ctx.fillText(name, 0, 37.5);
    ctx.restore();
  };

  CW.drawFog = function (ctx, c, rad, t, alpha) {
    ctx.save();
    const r = CW.rng('fog' + Math.round(c.x) + ':' + Math.round(c.y));
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28, d = r() * rad * 0.6;
      const x = c.x + Math.cos(a) * d + Math.sin(t * 0.3 + i) * 6;
      const y = c.y + Math.sin(a) * d * 0.6 - rad * 0.15;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad * (0.45 + r() * 0.3));
      g.addColorStop(0, `rgba(215,226,232,${0.75 * alpha})`);
      g.addColorStop(1, 'rgba(215,226,232,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
    }
    ctx.restore();
  };

  CW.drawPlayer = function (ctx, p, dir, t, onBoat, moving) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (onBoat) {
      ctx.rotate(dir);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.ellipse(-26, 0, 22, 9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#7a4a2f'; ctx.beginPath(); ctx.moveTo(22, 0); ctx.quadraticCurveTo(8, 13, -16, 10);
      ctx.lineTo(-16, -10); ctx.quadraticCurveTo(8, -13, 22, 0); ctx.fill();
      ctx.rotate(-dir);
      ctx.fillStyle = '#fbf6ea'; ctx.beginPath(); ctx.moveTo(0, -38); ctx.lineTo(16, -6); ctx.lineTo(0, -6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#4a3326'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = CW.C.lantern; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(-10, -36); ctx.lineTo(0, -32); ctx.fill();
    } else {
      const step = moving ? Math.sin(t * 14) * 3 : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0, 12, 13, 5, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#2d3b4a'; ctx.fillRect(-7, 2 + step, 5, 10); ctx.fillRect(2, 2 - step, 5, 10);
      ctx.fillStyle = '#ffc857'; roundRect(ctx, -11, -18, 22, 22, 7); ctx.fill();
      ctx.fillStyle = '#ffe2c6'; ctx.beginPath(); ctx.arc(0, -26, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#8a5a2b'; ctx.beginPath(); ctx.ellipse(0, -32, 14, 4, 0, 0, 7); ctx.fill(); ctx.fillRect(-7, -40, 14, 8);
      const ex = Math.cos(dir) * 3, ey = Math.sin(dir) * 2;
      ctx.fillStyle = '#222'; ctx.fillRect(-4 + ex, -27 + ey, 2.5, 2.5); ctx.fillRect(2 + ex, -27 + ey, 2.5, 2.5);
    }
    ctx.restore();
  };

  CW.drawPacket = function (ctx, p, t, color, scale) {
    ctx.save();
    ctx.translate(p.x, p.y - 30);
    ctx.scale(scale || 1, scale || 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    g.addColorStop(0, color + 'cc'); g.addColorStop(1, color + '00');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill();
    ctx.fillStyle = '#3a2a12'; ctx.fillRect(-2, -18, 4, 6);
    ctx.fillStyle = color; roundRect(ctx, -9, -12, 18, 22, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(-4, -7, 3, 11);
    ctx.restore();
  };

  CW.drawStamp = function (ctx, p, kind, age) {
    const k = Math.min(1, age * 4);
    const s = 1.6 - 0.6 * CW.ease(k);
    ctx.save();
    ctx.translate(p.x, p.y - 70);
    ctx.scale(s, s);
    ctx.globalAlpha = Math.min(1, k * 1.5);
    const col = kind === 'success' ? CW.C.pass : kind === 'blocked' ? CW.C.block : CW.C.error;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 22, 0, 7); ctx.fill();
    ctx.strokeStyle = '#0d2230'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    if (kind === 'success') { ctx.moveTo(-9, 1); ctx.lineTo(-3, 8); ctx.lineTo(10, -7); }
    else if (kind === 'blocked') { ctx.moveTo(-8, -8); ctx.lineTo(8, 8); ctx.moveTo(8, -8); ctx.lineTo(-8, 8); }
    else { ctx.moveTo(0, -10); ctx.lineTo(0, 3); ctx.moveTo(0, 10); ctx.lineTo(0, 10.5); }
    ctx.stroke();
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  CW.roundRect = roundRect;

  // Overworld island (small). st: {n, locked, reveal(0..1), cleared, stars:{got,max}, fog, near, k}
  CW.drawMiniIsland = function (ctx, w, I, t, st) {
    const th = CW.theme(w.theme);
    const k = st.k || 1;
    if (st.locked) {
      // an unknown shore: dark land under cloud, no name
      ctx.save();
      poly(ctx, scaled(I.poly, 1.03, I.c)); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
      poly(ctx, I.poly); ctx.fillStyle = '#1f4a5e'; ctx.fill();
      ctx.restore();
      CW.drawFog(ctx, I.c, I.r * 1.15, t, 0.75);
      ctx.save(); ctx.translate(I.c.x, I.c.y - 6);
      ctx.fillStyle = 'rgba(13,34,48,0.9)'; ctx.beginPath(); ctx.arc(0, 0, 30, 0, 7); ctx.fill();
      ctx.strokeStyle = '#d7e2e8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -6, 9, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#d7e2e8'; roundRect(ctx, -12, -6, 24, 19, 4); ctx.fill();
      ctx.restore();
    } else {
      CW.drawIsland(ctx, I.poly, th, t, I.c);
      const r = CW.rng('mini' + w.id);
      (w.entities || []).slice(0, 14).forEach((en) => {
        const a = r() * 6.28, d = r() * I.r * 0.62;
        const x = I.c.x + Math.cos(a) * d * 1.2, y = I.c.y + Math.sin(a) * d * 0.8;
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x - 6, y + 2, 14, 5);
        ctx.fillStyle = CW.KIND[en.kind]?.color || '#fff'; ctx.fillRect(x - 7, y - 9, 14, 12);
      });
      if (st.fog && st.fog !== 'drifted') CW.drawFog(ctx, I.c, I.r * 1.1, t, 0.85);
      if (st.reveal < 1) CW.drawFog(ctx, I.c, I.r * 1.15, t, 1 - st.reveal);
      if (st.cleared) {
        ctx.save(); ctx.translate(I.c.x + I.r * 0.9, I.c.y - I.r * 0.75); ctx.scale(k, k);
        ctx.fillStyle = CW.C.pass; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill();
        ctx.strokeStyle = '#0d2230'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-7, 1); ctx.lineTo(-2, 6); ctx.lineTo(8, -6); ctx.stroke(); ctx.restore();
      }
    }
    // number plate
    ctx.save(); ctx.translate(I.c.x - I.r * 0.95, I.c.y - I.r * 0.8); ctx.scale(k, k);
    ctx.fillStyle = st.locked ? '#35596b' : CW.C.lantern; ctx.beginPath(); ctx.arc(0, 0, 19, 0, 7); ctx.fill();
    ctx.fillStyle = st.locked ? '#d7e2e8' : '#2a1d00'; ctx.font = '800 19px ui-rounded, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(st.n), 0, 1); ctx.restore();
    // banner
    ctx.save();
    const title = st.locked ? 'Locked' : w.name;
    ctx.font = `800 ${Math.round(19 * k)}px ui-rounded, system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bw = ctx.measureText(title).width + 30 * k;
    const by = I.c.y + I.r + 32 * k;
    ctx.fillStyle = st.near && !st.locked ? '#ffc857' : 'rgba(13,34,48,0.9)';
    roundRect(ctx, I.c.x - bw / 2, by - 16 * k, bw, 32 * k, 16 * k); ctx.fill();
    ctx.fillStyle = st.near && !st.locked ? '#2a1d00' : st.locked ? '#9dbac6' : '#eaf4f4';
    ctx.fillText(title, I.c.x, by);
    ctx.font = `600 ${Math.round(12.5 * k)}px ui-rounded, system-ui`;
    ctx.fillStyle = '#d7e2e8';
    let sub = '';
    if (st.locked) sub = st.lockHint || '';
    else if (st.fog && st.fog !== 'drifted') sub = 'code changed since mapping';
    else if (st.stars.max) sub = `★ ${st.stars.got} / ${st.stars.max}`;
    if (sub) ctx.fillText(sub, I.c.x, by + 27 * k);
    ctx.restore();
  };

  // The journey route between two consecutive worlds.
  CW.drawRoute = function (ctx, a, c, b, t, open) {
    ctx.save(); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 16; ctx.stroke();
    ctx.strokeStyle = open ? 'rgba(255,200,87,0.9)' : 'rgba(234,244,244,0.22)';
    ctx.setLineDash(open ? [18, 14] : [4, 16]); ctx.lineDashOffset = open ? -t * 22 : 0; ctx.lineWidth = open ? 8 : 6; ctx.stroke();
    ctx.restore();
  };

  // A building the player has not reached yet.
  CW.drawHidden = function (ctx, p, t) {
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(13,34,48,0.16)'; ctx.beginPath(); ctx.ellipse(0, 10, 34, 11, 0, 0, 7); ctx.fill();
    ctx.setLineDash([5, 7]); ctx.strokeStyle = 'rgba(13,34,48,0.38)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-26, 12); ctx.lineTo(-26, -18); ctx.lineTo(0, -40);
    ctx.lineTo(26, -18); ctx.lineTo(26, 12); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(13,34,48,0.45)'; ctx.font = '800 24px ui-rounded, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, -8 + Math.sin(t * 2 + p.x) * 1.5);
    ctx.restore();
  };

  // A numbered signpost the player walks to (or clicks) to choose a road.
  CW.drawSign = function (ctx, s, n, t, hot) {
    ctx.save(); ctx.translate(s.x, s.y);
    const bob = s.dead ? 0 : Math.sin(t * 3 + n) * 2.5;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(0, 12, 20, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6b4a33'; ctx.fillRect(-3, -16, 6, 28);
    ctx.translate(0, -30 + bob);
    if (s.dead) ctx.rotate(0.35);
    ctx.fillStyle = s.dead ? '#7a5a5a' : hot ? '#fff6d6' : CW.C.lantern;
    ctx.strokeStyle = '#3a2a12'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-24, -15); ctx.lineTo(16, -15); ctx.lineTo(28, 0);
    ctx.lineTo(16, 15); ctx.lineTo(-24, 15); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = s.dead ? '#2b1c1c' : '#2a1d00'; ctx.font = '800 19px ui-rounded, system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s.dead ? '✕' : s.only ? '→' : String(n), -2, 1);
    if (hot && !s.dead) {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(0, 0, 40, 0, 7); ctx.stroke();
    }
    ctx.restore();
  };
})(window.CW);
