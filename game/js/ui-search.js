/* CodeQuest — search and jump: find a world, a building or a flow by words, and go straight to it.
   For the player who is stuck on one piece of logic and does not want to clear worlds in order.
   Owns the search box, its result list, and the "jump into a locked world" question.
   Loads after ui-init.js because it adds its wiring to U.init.
   Must not award XP or stars — jumping in opens a world, it does not beat it. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;
  const U = CW.ui, shared = U._;

  const KIND = { world: 'World', flow: 'Flow', entity: 'Building' };
  let index = null, hits = [], cursor = 0;

  // One flat list of everything a player can jump to, with the words that find it.
  // `name` counts most, `text` is everything else worth matching (summaries, step actions, file paths).
  function build() {
    const out = [];
    for (const w of G.W.worlds) {
      out.push({ type: 'world', wid: w.id, name: w.name, where: '', text: w.summary || '' });
      for (const en of w.entities || []) {
        const files = (en.source || []).map((r) => r.file).join(' ');
        out.push({
          type: 'entity', wid: w.id, id: en.id, name: en.name, where: w.name, sub: en.kind,
          text: [en.kind, en.summary, en.details, en.guard?.rule, en.guard?.checks, en.guard?.onFail, en.agent?.role, files].filter(Boolean).join(' '),
        });
      }
      for (const f of w.flows || []) {
        const steps = (f.steps || []).map((s) => [s.action, ...(s.next || []).map((n) => n.when)].join(' ')).join(' ');
        const cases = (f.cases || []).map((c) => [c.name, c.brief, c.input].filter(Boolean).join(' ')).join(' ');
        const ends = (f.outcomes || []).map((o) => o.label).join(' ');
        out.push({
          type: 'flow', wid: w.id, id: f.id, name: f.name, where: w.name, sub: f.trigger || '',
          text: [f.summary, f.trigger, steps, cases, ends].filter(Boolean).join(' '),
        });
      }
    }
    for (const it of out) { it.n = it.name.toLowerCase(); it.t = it.text.toLowerCase(); }
    return out;
  }

  // Every word must be found. A hit in the name beats a hit in the text; flows and buildings beat worlds on a tie.
  function search(q) {
    index = index || build();
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const res = [];
    for (const it of index) {
      let score = 0;
      for (const w of words) {
        if (it.n.includes(w)) score += it.n.startsWith(w) ? 12 : 8;
        else if (it.t.includes(w)) score += 2;
        else { score = -1; break; }
      }
      if (score > 0) res.push({ it, score: score + (it.type === 'world' ? 0 : 1) });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, 8).map((r) => r.it);
  }
  U.search = search; // for tests and for other panes

  // A few words around the first match, so the player sees why this result came up.
  function excerpt(it, q) {
    const w = q.toLowerCase().split(/\s+/).find((x) => x && !it.n.includes(x) && it.t.includes(x));
    if (!w) return it.sub || it.text.slice(0, 90);
    const i = it.t.indexOf(w), a = Math.max(0, i - 30);
    return (a ? '…' : '') + it.text.slice(a, i + 60).trim() + (i + 60 < it.text.length ? '…' : '');
  }

  function paint(q) {
    const box = $('#search-results');
    box.innerHTML = '';
    if (!q.trim()) { box.hidden = true; return; }
    box.hidden = false;
    if (!hits.length) { box.append(el('div', { class: 'none', text: 'Nothing mapped matches that. Try a function, file or screen name.' })); return; }
    hits.forEach((it, i) => {
      const locked = !G.unlocked(G.worldById(it.wid));
      box.append(el('button', {
        class: 'res' + (i === cursor ? ' on' : ''), role: 'option', type: 'button',
        onclick: () => go(it),
      },
      el('span', { class: 'k k-' + it.type, text: KIND[it.type] }),
      el('span', { class: 'm' },
        el('b', { text: it.name }),
        el('small', { text: (it.where ? it.where + ' · ' : '') + excerpt(it, q) })),
      locked ? el('span', { class: 'lock', text: 'locked · jump in' }) : null));
    });
  }

  function close() {
    const inp = $('#search');
    inp.value = ''; hits = []; $('#search-results').hidden = true; inp.blur(); $('#stage').focus();
  }

  // Go to a search result: open its world if needed, land there, and put the player on the thing itself.
  function go(it) {
    close();
    G.jump({ wid: it.wid, entityId: it.type === 'entity' ? it.id : null, flowId: it.type === 'flow' ? it.id : null });
  }

  // The one way to go straight to a piece of logic. Opens the world for good (see G.openWorld).
  G.jump = function ({ wid, entityId, flowId }) {
    const w = G.worldById(wid);
    if (!w) return;
    if (G.mission) CW.mission.quit();
    const wasLocked = !G.unlocked(w);
    const first = G.openWorld(wid);
    if (wasLocked) U.toast(`Opened ${w.name}. Its missions still count for stars.`);
    if (G.scene !== 'world' || G.wid !== wid) G.land(wid);
    else if (first) { shared.renderDock(); U.updateHUD(); }
    const stand = (eid) => { const q = G.L.pos[eid]; if (q) { G.player.x = q.x; G.player.y = q.y + 56; G.player.target = null; } };
    if (entityId) {
      const en = w.entities.find((e) => e.id === entityId);
      if (!en) return;
      stand(en.id); G.selected = en.id; U.openEntity(en);
    } else if (flowId) {
      const f = w.flows.find((x) => x.id === flowId);
      if (!f) return;
      const start = G.stepById(f, f.start);
      if (start) stand(start.at);
      G.lab = true; shared.selectFlow(f.id); CW.guide.update();
    }
    U.updateHUD();
  };

  // A locked island was picked: say what the order is for, and let the player skip it.
  U.askOpen = async function (w) {
    CW.sfx('step');
    const yes = await shared.confirmBox(
      `${w.name} is still locked`,
      `${G.lockHint(w)} to unlock it the usual way. Stuck on something in here? You can jump in now: `
        + 'the fog lifts, the lab opens, and its missions still count for stars later.',
      'Jump in');
    if (yes) G.jump({ wid: w.id });
  };

  U.focusSearch = function () { const i = $('#search'); i.focus(); i.select(); };

  const init = U.init;
  U.init = function () {
    init();
    const inp = $('#search');
    inp.addEventListener('input', () => { hits = search(inp.value); cursor = 0; paint(inp.value); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (hits.length) { cursor = (cursor + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; paint(inp.value); }
      } else if (e.key === 'Enter') { e.preventDefault(); if (hits[cursor]) go(hits[cursor]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) $('#search-results').hidden = true; }, 150));
    inp.addEventListener('focus', () => { if (inp.value.trim()) { hits = search(inp.value); paint(inp.value); } });
  };
})(window.CW);
