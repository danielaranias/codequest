/* CodeQuest — the quests pane (press Q) and the quiz / predict modal.
   Marks a quest done and awards its XP when a quiz is answered right; visit and trace quests
   are completed by the engine, this file only points the player at them. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { el } = CW;
  const U = CW.ui, shared = U._;

  U.refreshQuests = function () { if (shared.pane?.type === 'quests') shared.rerender(); U.updateHUD(); };

  // Inside a world: that world's quests. On the overworld: every world's.
  shared.buildQuests = function (b) {
    const worlds = G.scene === 'world' ? [G.world()] : G.W.worlds;
    b.append(el('h2', { text: G.scene === 'world' ? 'Quests in ' + G.world().name : 'Quests' }));
    b.append(el('p', { class: 'lead', text: 'Prove you understand the code. Quizzes are built from the real logic.' }));
    for (const w of worlds) {
      if (worlds.length > 1) b.append(el('h3', { text: `${w.name} · ${Math.round(G.mastery(w) * 100)}%` }));
      for (const q of w.quests || []) {
        const done = G.state.quests[w.id]?.[q.id];
        const desc = {
          visit: 'Find it on the map',
          trace: 'Watch this flow end to end',
          quiz: 'Answer a question',
          predict: 'Predict where a case ends',
        }[q.type];
        b.append(el('button', { class: 'quest' + (done ? ' done' : ''), onclick: () => openQuest(w, q) },
          el('span', { class: 'box', text: done ? '✓' : '' }),
          el('span', {}, el('span', { class: 'qt', text: q.title }), el('br'), el('span', { class: 'qd', text: desc })),
          el('span', { class: 'xpv', text: (q.xp || 10) + ' XP' })));
      }
      const found = Object.keys(G.state.cracks[w.id] || {}).length;
      b.append(el('p', {
        class: 'small muted',
        text: `Hidden cracks found: ${found} of ${(w.cracks || []).length}. Look for a shimmering “?” on buildings.`,
      }));
    }
  };

  // visit / trace: send the player there. quiz / predict: ask in a modal.
  function openQuest(w, q) {
    if (G.wid !== w.id && (q.type === 'visit' || q.type === 'trace')) { G.land(w.id); }
    if (q.type === 'visit') {
      shared.closeDrawer();
      const p = G.layout(w.id).pos[q.target];
      if (p) G.player.target = { x: p.x - 60, y: p.y + 40 };
      U.toast('Head to the marked building');
      G.selected = q.target;
      return;
    }
    if (q.type === 'trace') { shared.closeDrawer(); shared.selectFlow(q.target); U.toast('Press Play to watch it'); return; }
    const key = 'qa:' + w.id + '/' + q.id;
    const attempts = G.state.counters[key] || 0;
    const done = G.state.quests[w.id]?.[q.id];
    shared.openModal((box) => {
      box.append(el('p', { class: 'small muted', text: `${w.name} · ${q.type === 'predict' ? 'Predict the ending' : 'Quiz'}` }));
      box.append(el('h2', { text: q.title }));
      box.append(el('p', { class: 'lead', text: q.prompt }));
      // a predict quest targets "flowId/caseId" and can replay that case afterwards
      let flow = null, kase = null;
      if (q.type === 'predict') {
        const [fid, cid] = String(q.target).split('/');
        flow = G.flow(fid, w); kase = flow?.cases.find((c) => c.id === cid);
        if (kase) box.append(el('div', { class: 'card small' }, el('b', { text: 'Input: ' }), kase.input));
      }
      const watch = () => {
        shared.closeModal(); shared.closeDrawer();
        if (G.wid !== w.id) G.land(w.id);
        G.startPacket(flow, {
          path: kase.path, outcome: kase.outcome, explain: kase.explain, label: kase.name, caseId: kase.id,
          source: 'case', stepMode: shared.stepMode,
        });
        G.packet.input = kase.input;
      };
      const exp = el('div');
      (q.options || []).forEach((o, i) => {
        const btn = el('button', { class: 'opt', text: o });
        btn.onclick = () => {
          CW.$$('.opt', box).forEach((x) => (x.disabled = true));
          const right = i === q.answer;
          btn.classList.add(right ? 'right' : 'wrong');
          CW.$$('.opt', box)[q.answer].classList.add('right');
          exp.append(el('p', {}, el('b', { text: right ? 'Right. ' : 'Not quite. ' }), q.explain || ''));
          if (!done) {
            if (right) {
              (G.state.quests[w.id] = G.state.quests[w.id] || {})[q.id] = 1;
              // full XP only on the first try
              G.award(attempts ? CW.XP.quizRetry : q.xp || CW.XP.quiz, 'quest: ' + q.title);
            } else {
              G.state.counters[key] = attempts + 1; G.save();
              exp.append(el('p', { class: 'small muted', text: 'You can try again from the quest list.' }));
            }
          }
          if (flow && kase) {
            exp.append(el('div', { class: 'row' }, el('button', { class: 'btn primary', text: 'Watch this case', onclick: watch })));
          }
          U.refreshQuests();
        };
        box.append(btn);
      });
      box.append(exp, el('div', { class: 'row' }, el('button', { class: 'btn ghost', text: 'Close', onclick: shared.closeModal })));
    });
  }
})(window.CW);
