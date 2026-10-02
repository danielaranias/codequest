/* CodeQuest — the caption: the speech bubble that follows the packet (Lab) or the mission
   (road choices, win and lose cards). The engine and mission.js call U.onPacket / U.onMission
   when their state changes and U.frame every frame.
   Must not decide outcomes: it only shows state and calls back into G and CW.mission. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;
  const U = CW.ui, shared = U._;

  // Redraw the caption for the Lab packet: the current step, a branch choice, or the ending.
  U.onPacket = function () {
    shared.renderDock(); CW.guide.onPacket();
    const cap = $('#caption');
    const P = G.packet;
    if (!P) { cap.hidden = true; return; }
    cap.hidden = false;
    cap.className = 'caption';
    cap.innerHTML = '';
    const f = P.flow;
    if (P.done) {
      const o = f.outcomes.find((x) => x.id === P.outcome);
      cap.classList.add('end', P.outcomeKind);
      cap.append(el('div', { class: 'cap-step' },
        el('span', { text: P.label || f.name }),
        P.source === 'ai' ? el('span', { class: 'tag-ai', text: 'AI simulation' }) : null));
      cap.append(el('div', {
        class: 'cap-act',
        text: (P.meta?.isNew ? 'New ending: ' : 'Ends: ') + (o?.label || P.meta?.label || P.outcome || '') }));
      const why = P.explain || P.meta?.risk || P.meta?.assumptions;
      if (why) cap.append(el('div', { class: 'small', text: why }));
      cap.append(el('div', { class: 'cap-next' }, el('button', { text: 'Close', onclick: () => G.stopPacket() })));
      return;
    }
    const s = G.activeStep();
    const en = G.entity(s.at);
    if (P.phase === 'move') {
      cap.append(el('div', { class: 'cap-step' }, el('span', { text: 'Moving to ' + (en?.name || s.at) })));
      return;
    }
    cap.append(el('div', { class: 'cap-step' },
      el('span', { text: P.manual ? `Step ${P.i + 1}` : `Step ${P.i + 1} of ${P.path.length}` }),
      el('span', { text: en?.name || s.at })));
    cap.append(el('div', { class: 'cap-act', text: s.action }));
    if (P.input) cap.append(el('div', { class: 'cap-carry cap-input', text: 'Case: ' + P.input }));
    if (P.narration[P.i]) cap.append(el('div', { class: 'cap-ai', text: P.narration[P.i] }));
    else if (s.carries) cap.append(el('div', { class: 'cap-carry', text: 'Data here, for example: ' + s.carries }));
    if (P.manual) {
      const ch = el('div', { class: 'cap-choices' });
      for (const n of s.next || []) {
        const target = n.to.startsWith('outcome:')
          ? 'End: ' + (f.outcomes.find((o) => 'outcome:' + o.id === n.to)?.label || n.to)
          : 'Go to ' + (G.entity(G.stepById(f, n.to)?.at)?.name || n.to);
        ch.append(el('button', { onclick: () => G.chooseBranch(n.to) },
          el('span', { class: 'to', text: target }), el('br'), el('span', { text: 'when ' + n.when })));
      }
      cap.append(ch);
    } else if (P.stepMode) {
      cap.append(el('div', { class: 'cap-next' },
        el('button', { text: 'Next step', onclick: () => G.nextStep() }),
        el('span', { class: 'small', style: 'color:#5c6f79;align-self:center', text: 'or press Space' })));
    }
  };

  // Redraw the caption for the mission: one card per phase (goto, choose, won, lost).
  U.onMission = function () {
    const firstWin = G.mission?.phase === 'won' && Object.keys(G.state.missions).length === 1 && !G.state.counters.toldMenus;
    shared.renderDock(); CW.guide.onMission(); U.showHint(null);
    if (firstWin) { G.state.counters.toldMenus = 1; U.toast('New: Quests, Notes, Badges and the Lab are now open', 'badge'); }
    const cap = $('#caption');
    const m = G.mission;
    if (!m) { cap.hidden = true; U.updateHUD(); return; }
    cap.className = 'caption mission';
    cap.innerHTML = '';
    setTimeout(() => U.updateHUD(), 0);
    cap.hidden = m.phase === 'travel';
    if (m.phase === 'goto') gotoCard(cap, m);
    else if (m.phase === 'choose') chooseCard(cap, m);
    else if (m.phase === 'won') wonCard(cap, m);
    else if (m.phase === 'lost') lostCard(cap, m);
  };

  function gotoCard(cap, m) {
    const f = m.flow;
    const en = G.entity(G.stepById(f, m.kase.path[0]).at);
    cap.append(
      el('div', { class: 'cap-step' }, el('span', { text: 'Mission start' })),
      el('div', { class: 'cap-act', text: 'Bring the case to ' + (en?.name || 'the start') }),
      el('div', { class: 'cap-carry', text: f.trigger }));
  }

  // The fork: one button per road sign. A sign already tried and wrong is "dead".
  function chooseCard(cap, m) {
    const s = CW.mission.currentStep(), en = G.entity(s.at);
    cap.append(el('div', { class: 'cap-step' }, el('span', { text: en?.name || s.at }), el('span', { text: 'Stop ' + (m.i + 1) })));
    cap.append(el('div', { class: 'cap-act', text: s.action }));
    if (m.lastWrong) {
      cap.append(el('div', {
        class: 'cap-wrong',
        text: `Not that road. It is only taken when ${m.lastWrong.when}. Look at what you carry.` }));
    }
    const only = m.signs.length === 1;
    cap.append(el('div', { class: 'cap-q', text: only ? 'One road from here.' : 'Which road does the code take?' }));
    const ch = el('div', { class: 'cap-choices' });
    m.signs.forEach((sg, k) => {
      ch.append(el('button', { disabled: sg.dead, class: sg.dead ? 'dead' : '', onclick: () => CW.mission.choose(k) },
        el('span', { class: 'num', text: sg.dead ? '✕' : only ? '→' : String(k + 1) }),
        el('span', {},
          el('span', { class: 'to', text: sg.label }),
          only && /^always$/i.test(sg.when) ? null : el('span', { class: 'when', text: 'when ' + sg.when }))));
    });
    cap.append(ch);
  }

  function wonCard(cap, m) {
    const r = m.result;
    cap.classList.add('end', 'win');
    cap.append(el('div', { class: 'cap-stars', text: shared.starText(r.stars) }));
    cap.append(el('div', { class: 'cap-step' }, el('span', { text: 'Delivered: ' + m.kase.name })));
    const kindWord = { success: 'goes through', blocked: 'is stopped', error: 'fails' }[r.kind] || '';
    cap.append(el('div', { class: 'cap-act' },
      'The case ' + kindWord + ': ',
      el('span', { class: 'kindword ' + r.kind, text: r.outcome?.label || m.kase.outcome })));
    if (m.kase.explain) cap.append(el('div', { class: 'small', text: m.kase.explain }));
    if (r.cleared) {
      cap.append(el('div', { class: 'cap-unlock', text: r.unlocked ? `World unlocked: ${r.unlocked.name}` : 'Journey complete' }));
    }
    const row = el('div', { class: 'cap-next' });
    const nx = G.nextMission(G.world());
    if (r.unlocked) {
      // back to the overworld, then head for the newly opened island
      const sail = () => {
        const id = r.unlocked.id;
        G.setSail();
        const I = G.OW.isl[id];
        G.player.target = { x: I.c.x, y: I.c.y, land: id };
      };
      row.append(el('button', { class: 'gold', text: 'Sail to ' + r.unlocked.name, onclick: sail }));
    }
    if (nx) row.append(el('button', { class: r.unlocked ? '' : 'gold', text: 'Next mission', onclick: () => CW.mission.next() }));
    if (r.stars < 3) row.append(el('button', { text: 'Try for 3 stars', onclick: () => CW.mission.retry() }));
    row.append(el('button', { text: 'Done', onclick: () => CW.mission.quit() }));
    cap.append(row);
  }

  function lostCard(cap, m) {
    cap.classList.add('end', 'blocked');
    cap.append(el('div', { class: 'cap-step' }, el('span', { text: 'Out of hearts' })));
    cap.append(el('div', { class: 'cap-act', text: m.answer ? `Here the code takes: ${m.answer.label}` : 'The case got lost.' }));
    if (m.answer && !/^always$/i.test(m.answer.when)) cap.append(el('div', { class: 'small', text: 'Because ' + m.answer.when + '.' }));
    const s = CW.mission.currentStep();
    cap.append(el('div', { class: 'cap-next' },
      el('button', { class: 'gold', text: 'Try again', onclick: () => CW.mission.retry() }),
      el('button', { text: 'Read the code', onclick: () => { const en = G.entity(s.at); if (en) U.openEntity(en, 'code'); } }),
      el('button', { text: 'Quit', onclick: () => CW.mission.quit() })));
  }

  // Every frame: keep the caption pinned above the mission anchor or the packet, inside the screen.
  U.frame = function () {
    CW.guide.frame();
    const cap = $('#caption');
    if (G.mission && !cap.hidden && G.scene === 'world') {
      const m = G.mission;
      const a = m.phase === 'goto' ? G.L.pos[G.stepById(m.flow, m.kase.path[0]).at] : CW.mission.anchor();
      const sc = G.toScreen(a);
      const half = Math.min(205, G.W_ / 2 - 8);
      // leave room for the "What the user sees" panel on the left when it is showing
      const leftEdge = !$('#screen').hidden && G.W_ > 760 ? 292 + half : half;
      const end = m.phase === 'won' || m.phase === 'lost';
      cap.style.left = CW.clamp(sc.x, Math.min(leftEdge, G.W_ - half), G.W_ - half) + 'px';
      cap.style.top = CW.clamp(sc.y - (m.phase === 'won' ? 40 : 0), cap.offsetHeight + (end ? 268 : 232), G.H_ + 40) + 'px';
      return;
    }
    if (!G.packet || cap.hidden || G.scene !== 'world') return;
    const p = G.packetPos();
    if (!p) return;
    const s = G.toScreen(p);
    const half = Math.min(190, G.W_ / 2 - 8);
    const x = CW.clamp(s.x, half, G.W_ - half);
    const y = CW.clamp(s.y, cap.offsetHeight + (cap.classList.contains('end') ? 190 : 150), G.H_ + 40);
    cap.style.left = x + 'px';
    cap.style.top = y + 'px';
  };
})(window.CW);
