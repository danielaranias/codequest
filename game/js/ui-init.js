/* CodeQuest — the intro card and the one-time wiring of the top bar buttons.
   Loads last of the ui-*.js files. main.js calls U.init once and U.intro after the world loads.
   Keyboard and canvas input are not wired here — that is engine.js. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;
  const U = CW.ui, shared = U._;

  // ---------- intro ----------
  // The welcome card; shown only until "Start the journey" has been pressed once.
  U.intro = function () {
    if (G.state.counters.introSeen) return;
    const i = $('#intro');
    i.hidden = false;
    const n = G.W.worlds.length;
    const missions = G.W.worlds.reduce((a, w) => a + G.missionCount(w).total, 0);
    const start = () => { i.hidden = true; G.state.counters.introSeen = 1; G.save(); $('#stage').focus(); CW.sfx('start'); U.updateHUD(); };
    i.innerHTML = '';
    const box = el('div', { class: 'box' },
      el('h1', { text: G.W.repo.name }),
      el('p', {
        class: 'sub',
        text: `${n} worlds in the order the real system runs, ${missions} missions. Clear a world to open the next.` }),
      el('p', {
        class: 'sub2',
        text: 'You will be handed real cases. Carry each one through the code and pick the road the code would take.'
          + ' A guide at the top always tells you the next move.',
      }),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: 'Start the journey', onclick: start }),
        el('button', { class: 'btn', text: 'Something is broken — find it', onclick: () => { start(); U.focusSearch(); } })),
      el('p', { class: 'sub2', text: 'In a hurry? Search for the logic you need and jump straight in. Press / any time.' }),
      el('p', { class: 'ver', text: 'CodeQuest ' + (window.CODEQUEST_CONFIG?.version || window.CODEQUEST_VERSION || '') }));
    i.append(box);
  };

  // ---------- wiring ----------
  U.init = function () {
    $('#btn-sail').onclick = () => G.setSail();
    $('#sync-chip').onclick = () => U.togglePane('sync');
    $('#drawer-close').onclick = shared.closeDrawer;
    // the "what the user sees" panel folds to its title while the player decides; a click opens it again
    CW.$('#screen .sp-head').onclick = () => $('#screen').classList.toggle('open');
    CW.$$('.tabs [data-pane]').forEach((bt) => (bt.onclick = () => U.togglePane(bt.dataset.pane)));
    const snd = $('#btn-sound');
    const paint = () => { snd.textContent = CW.soundOn() ? 'Sound on' : 'Sound off'; snd.setAttribute('aria-pressed', CW.soundOn()); };
    snd.onclick = () => { CW.setSound(!CW.soundOn()); paint(); CW.sfx('step'); };
    paint();
  };
  // The backend (offline / agent / claude.ai) changed what it can do: redraw everything that shows AI buttons.
  U.onBackendChange = function () { if (shared.pane) shared.rerender(); shared.renderDock(); U.updateHUD(); };
})(window.CW);
