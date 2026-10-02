/* CodeQuest — UI core: toasts, the side drawer, the modal, and the state every ui-*.js file shares.
   Loads first of the ui-*.js files. It creates the public `CW.ui` (called `U`) and the internal
   `CW.ui._` (called `shared`): each ui-*.js file adds the helpers it owns to `shared`, and reaches
   the others through it at call time. Must not build any pane's content or touch game rules. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;

  const U = (CW.ui = {});
  const shared = (U._ = {
    pane: null, // the open drawer pane: {type, id, tab?}
    speed: 1, // packet playback speed in the Lab
    follow: true, // camera follows the packet
    stepMode: false, // packet waits for "Next step"
    results: {}, // key -> html for last challenge/simulation result
  });

  U.speed = () => shared.speed;
  U.followPacket = () => shared.follow;

  // ---------- toasts ----------
  U.toast = function (msg, kind) {
    const t = el('div', { class: 'toast ' + (kind || ''), text: msg });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 3300);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  };
  // Show any backend/AI error as a red toast.
  shared.fail = (e) => U.toast(e?.message || (e?.code ? shared.aiError(e.code) : 'Something went wrong'), 'err');
  shared.aiError = function (code) {
    return ({
      not_granted: 'Claude is not allowed on this page — AI features are off',
      rate_limited: 'Too many AI calls right now — try again in a minute',
      invalid_json: 'The AI answer could not be read — try again',
      refused: 'Claude declined that one — try rewording',
    })[code] || 'The AI call failed (' + code + ')';
  };
  shared.aiOffText = () => G.backend.mode === 'offline'
    ? 'AI is off in this snapshot. Open the game from your coding agent (codequest play) or on claude.ai to ask, inject cases and challenge.'
    : 'Not available here.';

  // ---------- drawer ----------
  // Open the side drawer on one pane; `build(body)` fills it.
  shared.openDrawer = function (type, id, build) {
    shared.pane = { type, id };
    const body = $('#drawer-body');
    body.innerHTML = '';
    build(body);
    $('#drawer').hidden = false;
    document.body.classList.add('drawer-open');
  };
  shared.closeDrawer = function () {
    shared.pane = null;
    $('#drawer').hidden = true;
    document.body.classList.remove('drawer-open');
    G.selected = null;
  };
  U.closeDrawer = shared.closeDrawer;
  // Rebuild whatever pane is open, keeping its scroll position.
  shared.rerender = function () {
    if (!shared.pane) return;
    const p = shared.pane;
    const scroll = $('#drawer').scrollTop;
    if (p.type === 'entity') U.openEntity(G.entity(p.id));
    else if (p.type === 'change') shared.openChange(G.flow(p.id));
    else U.togglePane(p.type, true);
    $('#drawer').scrollTop = scroll;
  };
  // Open a top-bar pane, or close it if it is already open (`force` re-opens it instead).
  U.togglePane = function (type, force) {
    if (shared.pane && shared.pane.type === type && !force) return shared.closeDrawer();
    const builders = {
      quests: shared.buildQuests,
      notes: shared.buildNotes,
      badges: shared.buildBadges,
      sync: shared.buildSync,
    };
    if (builders[type]) shared.openDrawer(type, null, builders[type]);
  };

  // ---------- modal ----------
  shared.openModal = function (build) {
    const m = $('#modal');
    m.innerHTML = '';
    const box = el('div', { class: 'box', role: 'dialog', 'aria-modal': 'true' });
    build(box);
    m.append(box);
    m.hidden = false;
    m.onclick = (e) => { if (e.target === m) shared.closeModal(); };
    setTimeout(() => box.querySelector('button, textarea, input')?.focus(), 30);
  };
  shared.closeModal = function () { $('#modal').hidden = true; $('#stage').focus(); };
  // Ask yes/no in a modal; resolves true only when the `yes` button is pressed.
  shared.confirmBox = function (title, text, yes) {
    return new Promise((res) => shared.openModal((box) => {
      box.append(el('h2', { text: title }), el('p', { class: 'lead', text }));
      box.append(el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: yes, onclick: () => { shared.closeModal(); res(true); } }),
        el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => { shared.closeModal(); res(false); } })));
    }));
  };

  // Copy to the clipboard; if the browser refuses, show the text in a modal to copy by hand.
  shared.copy = async function (text) {
    try { await navigator.clipboard.writeText(text); U.toast('Copied'); }
    catch {
      shared.openModal((box) => {
        box.append(
          el('h2', { text: 'Copy this' }),
          el('textarea', { rows: 12, text: text }),
          el('div', { class: 'row' }, el('button', { class: 'btn', text: 'Done', onclick: shared.closeModal })));
      });
    }
  };
})(window.CW);
