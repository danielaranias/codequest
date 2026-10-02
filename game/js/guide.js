/* CodeQuest — the guide (always says what to do next) and the screen panel
   (what the user sees while the logic runs).
   Read-only: it looks at game state and points; it must not change progress or start anything. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;
  const Gd = (CW.guide = {});

  G.novice = () => !Object.keys(G.state.missions).length && !G.state.freeRoam;

  // The world the player should be in next: first open world that is not cleared yet.
  G.nextWorld = function () {
    for (const w of G.W.worlds) if (G.unlocked(w) && !G.worldCleared(w)) return w;
    for (const w of G.W.worlds) if (G.unlocked(w) && G.nextMission(w)) return w;
    return null;
  };

  // ---------- objective ----------
  // The one next move: {text, tip?, target? (world point to mark), pulse? (CSS selector to highlight)}.
  Gd.compute = function () {
    if (!G.W || !$('#intro').hidden) return null;
    const nov = G.novice();
    if (G.scene === 'over') {
      const w = G.nextWorld();
      if (!w) return { text: 'Journey complete. Replay any world for more stars.' };
      return {
        text: `Sail to ${w.name}`,
        tip: nov ? 'Click the island, or steer with the arrow keys. Then press E to land.' : '',
        target: G.OW.isl[w.id].c };
    }
    const w = G.world(), m = G.mission;
    if (!m) {
      if (G.lab) return { text: 'Lab: pick a flow, then replay, inject a case or change it', tip: '' };
      const next = G.nextMission(w), nw = G.W.worlds[G.worldIndex(w.id) + 1];
      if (G.worldCleared(w) && nw && !G.missionCount(nw).done) {
        return { text: `${w.name} is clear. Set sail to ${nw.name}`, pulse: '#btn-sail' };
      }
      if (next) {
        return {
          text: nov ? 'Press Start to take your first case' : 'Take the next case',
          pulse: '#dock .btn.big',
          tip: nov ? 'A case is one real input. You carry it through the code.' : '' };
      }
      return { text: 'Every mission here is done. Set sail.', pulse: '#btn-sail' };
    }
    if (m.phase === 'goto') {
      const s = G.stepById(m.flow, m.kase.path[0]);
      return {
        text: `Walk to ${G.entity(s.at)?.name || 'the glowing building'}`,
        tip: nov ? 'Click the glowing building, or use the arrow keys.' : '',
        target: G.L.pos[s.at] };
    }
    if (m.phase === 'choose') {
      if (m.lastWrong) {
        return {
          text: 'Wrong road. Read the code here, then pick again',
          pulse: '#btn-readcode',
          tip: nov ? 'The code shows the exact condition for each road.' : '' };
      }
      if (m.signs.length === 1) {
        return {
          text: 'Press Space to follow the road',
          tip: nov ? 'Only one road from here. The panel on the left shows what the user sees now.' : '' };
      }
      return {
        text: 'Which road does the code take?',
        tip: nov ? 'Compare each condition with the facts you carry (bottom). Press 1, 2… or walk into a signpost.' : '' };
    }
    if (m.phase === 'travel') return { text: 'On the road…' };
    if (m.phase === 'won') {
      return m.result.unlocked
        ? { text: `New world open. Sail to ${m.result.unlocked.name}`, pulse: '.cap-next .gold' }
        : { text: G.nextMission(w) ? 'Delivered. Take the next mission' : 'Delivered. This world is done', pulse: '.cap-next .gold' };
    }
    if (m.phase === 'lost') return { text: 'Out of hearts. Try again', pulse: '.cap-next .gold' };
    return null;
  };

  let lastKey = '';
  // Recompute the objective and repaint the guide bar (only when the text changed).
  Gd.update = function () {
    const o = Gd.compute();
    const bar = $('#guide');
    CW.$$('.pulse').forEach((n) => n.classList.remove('pulse'));
    document.body.classList.toggle('novice', !!G.W && G.novice());
    if (!o) { bar.hidden = true; Gd.target = null; return; }
    bar.hidden = false;
    const key = o.text + '|' + (o.tip || '');
    if (key !== lastKey) {
      lastKey = key;
      bar.innerHTML = '';
      bar.append(el('span', { class: 'g-next', text: 'Next' }), el('span', { class: 'g-text', text: o.text }));
      if (o.tip) bar.append(el('span', { class: 'g-tip', text: o.tip }));
      bar.classList.remove('flash'); void bar.offsetWidth; bar.classList.add('flash');
    }
    Gd.target = o.target || null;
    if (o.pulse) { const n = $(o.pulse); if (n) n.classList.add('pulse'); }
  };

  // Marker over the target, or an arrow on the screen edge when it is out of view.
  Gd.draw = function (ctx, t) {
    const p = Gd.target; if (!p) return;
    const lift = G.scene === 'over' ? G.OW.isl[G.nextWorld()?.id]?.r + 70 || 150 : 95;
    const k = Math.max(1, 0.55 / G.cam.z);
    ctx.save(); ctx.translate(p.x, p.y - lift - Math.abs(Math.sin(t * 4)) * 14 * k); ctx.scale(k, k);
    ctx.fillStyle = CW.C.lantern; ctx.strokeStyle = '#2a1d00'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-17, -22); ctx.lineTo(17, -22); ctx.lineTo(17, -4);
    ctx.lineTo(0, 16); ctx.lineTo(-17, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  // Every frame: show the edge arrow when the target is off screen.
  Gd.frame = function () {
    const arrow = $('#edge-arrow');
    const p = Gd.target;
    if (!p) { arrow.hidden = true; return; }
    const s = G.toScreen(p);
    const pad = 56, top = 110, bottom = G.H_ - 150;
    const inside = s.x > pad && s.x < G.W_ - pad && s.y > top && s.y < bottom;
    arrow.hidden = inside;
    if (inside) return;
    const x = CW.clamp(s.x, pad, G.W_ - pad), y = CW.clamp(s.y, top, bottom);
    arrow.style.left = x + 'px'; arrow.style.top = y + 'px';
    arrow.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(s.y - y, s.x - x)}rad)`;
  };

  // ---------- screen panel ----------
  let shown = null; // {screen, sig[]}
  const sigOf = (b) => `${b.t}|${b.text || ''}|${(b.items || []).join('·')}|${b.state || ''}`;

  // One block of a mapped screen (title, text, input, button, list…) as a DOM node.
  function block(b, isNew) {
    const cls = `b b-${b.t}${b.state ? ' s-' + b.state : ''}${isNew ? ' is-new' : ''}`;
    const items = b.items || [];
    switch (b.t) {
      case 'title': return el('div', { class: cls, text: b.text });
      case 'text': return el('div', { class: cls, text: b.text });
      case 'input': return el('div', { class: cls, text: b.text || ' ' });
      case 'button': return el('div', { class: cls }, b.state === 'loading' ? el('i', { class: 'spin' }) : null, b.text || '');
      case 'banner': return el('div', { class: cls, text: b.text });
      case 'spinner': return el('div', { class: cls }, el('i', { class: 'spin' }), b.text || '');
      case 'toggle': return el('div', { class: cls }, el('i', { class: 'tg' }), b.text || '');
      case 'divider': return el('div', { class: cls });
      case 'chips': case 'tabs': return el('div', { class: cls }, ...items.map((x) => el('span', { text: x })));
      case 'list': return el('div', { class: cls },
        b.text ? el('div', { class: 'lt', text: b.text }) : null,
        ...items.map((x) => el('div', { class: 'li', text: x })));
      case 'console': return el('div', { class: cls },
        b.text ? el('div', { text: b.text }) : null,
        ...items.map((x) => el('div', { text: x })));
      case 'card': return el('div', { class: cls },
        b.text ? el('div', { class: 'ct', text: b.text }) : null,
        ...items.map((x) => el('div', { class: 'li', text: x })));
      default: return el('div', { class: cls, text: b.text || '' });
    }
  }

  // screen: the screen object or null. opts.same: nothing changed at this step.
  Gd.showScreen = function (screen, opts) {
    const box = $('#screen');
    opts = opts || {};
    if (!screen && !shown) {  // nothing has been shown to the user yet
      box.hidden = !opts.placeholder;
      if (opts.placeholder) {
        box.classList.remove('same');
        $('#sp-name').textContent = '';
        const dev = $('#sp-device'); dev.className = 'device k-browser'; dev.innerHTML = '';
        dev.append(
          el('div', { class: 'dv-bar' }, el('i'), el('i'), el('i')),
          el('div', { class: 'dv-body' }, el('div', { class: 'b b-text s-muted', text: 'Nothing on screen yet.' })));
        $('#sp-note').textContent = 'This panel shows the real screen as the code moves.';
      }
      return;
    }
    if (!screen) {          // nothing changes: keep the last screen, dim it and say so
      box.hidden = false;
      box.classList.add('same');
      $('#sp-note').textContent = opts.note || 'Nothing changes on screen. This step runs behind the scenes.';
      return;
    }
    box.hidden = false;
    box.classList.remove('same');
    const prev = new Set(shown ? shown.sig : []);
    const sig = (screen.blocks || []).map(sigOf);
    const first = !shown;
    shown = { screen, sig };
    const kind = screen.kind || 'browser';
    $('#sp-name').textContent = screen.name || '';
    const dev = $('#sp-device');
    dev.className = 'device k-' + kind;
    dev.innerHTML = '';
    dev.append(el('div', { class: 'dv-bar' },
      el('i'), el('i'), el('i'), el('span', { text: kind === 'terminal' ? 'terminal' : screen.name || '' })));
    const body = el('div', { class: 'dv-body' });
    if (kind === 'none' || !(screen.blocks || []).length) {
      body.append(el('div', { class: 'b b-text s-muted', text: 'No screen here. Nobody is looking at this part.' }));
    }
    // a different screen altogether: flash the frame; the same screen: mark only what changed
    const fresh = sig.filter((x) => !prev.has(x)).length;
    const swapped = !first && (fresh === sig.length);
    (screen.blocks || []).forEach((b, i) => body.append(block(b, !first && !swapped && !prev.has(sig[i]))));
    dev.append(body);
    if (swapped) dev.classList.add('swap');
    if (!first && !opts.quiet) CW.sfx('step');
    $('#sp-note').textContent = screen.note || '';
  };
  Gd.clearScreen = function () { shown = null; $('#screen').hidden = true; };

  // Called whenever the mission moves.
  Gd.onMission = function () {
    const m = G.mission;
    if (!m) { if (!G.packet) Gd.clearScreen(); return; }
    if (m.phase === 'goto') { Gd.clearScreen(); Gd.showScreen(null, { placeholder: true }); return; }
    if (m.phase === 'choose') { const s = CW.mission.currentStep(); Gd.showScreen(s.screen || null, { placeholder: true }); return; }
    if (m.phase === 'won') { if (m.result.outcome?.screen) Gd.showScreen(m.result.outcome.screen); return; }
  };
  Gd.onPacket = function () {
    const P = G.packet;
    if (!P) { if (!G.mission) Gd.clearScreen(); return; }
    if (P.done) { const o = P.flow.outcomes.find((x) => x.id === P.outcome); if (o?.screen) Gd.showScreen(o.screen); return; }
    if (P.phase === 'hold') { const s = G.activeStep(); Gd.showScreen(s?.screen || null); }
  };
})(window.CW);
