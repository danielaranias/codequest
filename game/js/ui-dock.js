/* CodeQuest — the bottom dock. It shows one of three things: the mission board (what to play
   next), the mission bar (hearts and the case you carry), or the Lab (free play on beaten flows,
   including AI simulation of your own case).
   Must not decide mission rules — it only calls CW.mission and G.startPacket. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;
  const U = CW.ui, shared = U._;

  const caseChoice = {}; // flowId -> value picked in the Lab's case list
  let showAll = false; // mission board: the full list of missions is unfolded
  let showFull = false; // mission bar: the full case text is shown under the facts

  shared.selectFlow = function (fid) {
    G.flowSel = fid;
    if (G.packet && G.packet.flow.id !== fid) G.stopPacket();
    renderDock();
  };
  U.selectFlow = shared.selectFlow;

  shared.starText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  // Redraw the dock from scratch, and tell the CSS how tall it is now.
  function renderDock() {
    const d = $('#dock');
    if (G.scene !== 'world') { d.hidden = true; return; }
    d.hidden = false;
    d.innerHTML = '';
    d.className = 'dock';
    if (G.mission) renderMissionBar(d);
    else if (G.lab) renderLab(d);
    else renderBoard(d);
    document.body.style.setProperty('--dockh', d.offsetHeight + 'px');
  }
  shared.renderDock = renderDock;

  // The mission board: one clear next thing, everything else folded away.
  function renderBoard(d) {
    const w = G.world();
    const flows = G.playableFlows(w);
    const beaten = flows.filter((f) => G.flowBeaten(w, f)).length;
    const next = G.nextMission(w);
    const nextWorld = G.W.worlds[G.worldIndex(w.id) + 1];
    const cleared = G.worldCleared(w);
    const mc = G.missionCount(w);
    let goal;
    if (!flows.length) goal = 'No missions mapped in this world yet.';
    else if (!cleared) goal = `${beaten} of ${flows.length} flows beaten. Beat them all to ${nextWorld ? 'open ' + nextWorld.name : 'finish the journey'}.`;
    else if (nextWorld) goal = `${nextWorld.name} is open.`;
    else goal = 'Last world cleared.';
    const left = el('div', { class: 'mnext' });
    if (next) {
      left.append(
        el('div', { class: 'mn-top', text: `Mission ${mc.done + 1} of ${mc.total} · ${next.flow.name}` }),
        el('div', { class: 'mn-brief', text: next.kase.brief || next.kase.name }));
    } else left.append(el('div', { class: 'mn-brief', text: 'Every mission here is done.' }));
    d.append(el('div', { class: 'mhead' }, left,
      el('div', { class: 'row', style: 'margin:0;flex:none' },
        next ? el('button', { class: 'btn primary big', text: 'Start', onclick: () => CW.mission.start(next.flow, next.kase) }) : null,
        cleared && nextWorld ? el('button', { class: 'btn', text: 'Set sail', onclick: () => G.setSail() }) : null)));
    d.append(el('div', { class: 'mfoot' }, el('span', { class: 'mgoal' + (cleared ? ' ok' : ''), text: goal }),
      el('span', { class: 'adv' },
        el('button', {
          class: 'btn ghost sm',
          text: showAll ? 'Hide missions' : 'All missions',
          onclick: () => { showAll = !showAll; renderDock(); },
        }),
        el('button', {
          class: 'btn ghost sm',
          disabled: !beaten && !G.jumped(w.id),
          title: beaten || G.jumped(w.id) ? 'Replay, inject your own case, or change a flow' : 'Beat a mission first',
          text: 'Lab',
          onclick: () => { G.lab = true; renderDock(); CW.guide.update(); },
        }))));
    if (!showAll) return;
    const list = el('div', { class: 'mflows' });
    for (const f of flows) {
      const col = el('div', { class: 'mflow' },
        el('div', { class: 'mf-name', title: f.summary }, f.name, G.flowBeaten(w, f) ? el('span', { class: 'tick', text: ' ✓' }) : null));
      for (const c of f.cases) {
        const st = G.stars(w.id, f.id, c.id);
        col.append(el('button', {
          class: 'mcase' + (st ? ' done' : '') + (next && next.kase === c ? ' next' : ''),
          title: c.brief || c.input,
          onclick: () => CW.mission.start(f, c),
        },
          el('span', { class: 'stars', text: shared.starText(st) }), el('span', { class: 'mc-name', text: c.name })));
      }
      list.append(col);
    }
    d.append(list);
  }

  // The mission bar: hearts, the case being carried, and the way out.
  function renderMissionBar(d) {
    const m = G.mission;
    d.classList.add('mission');
    const left = Math.max(0, m.hearts);
    const hearts = el('span', {
      class: 'hearts',
      'aria-label': m.hearts + ' hearts left',
      text: '♥'.repeat(left) + '♡'.repeat(3 - left) });
    const cur = CW.mission.currentStep();
    const facts = m.kase.facts || [];
    const body = el('div', { class: 'mb-case' },
      el('div', { class: 'mb-brief', text: m.kase.brief || m.kase.name }),
      facts.length
        ? el('div', { class: 'facts' },
          el('span', { class: 'f-lbl', text: 'You carry' }),
          ...facts.map((f) => el('span', { class: 'fact', text: f })))
        : el('div', { class: 'mb-input', text: m.kase.input }));
    if (showFull && facts.length) body.append(el('div', { class: 'mb-input', text: m.kase.input }));
    const readCode = () => { const en = G.entity(cur.at); if (en) U.openEntity(en, 'code'); };
    d.append(el('div', { class: 'mbar' }, hearts, body,
      el('div', { class: 'row', style: 'margin:0;flex:none' },
        cur ? el('button', { class: 'btn', id: 'btn-readcode', text: 'Read the code here', onclick: readCode }) : null,
        facts.length
          ? el('button', {
            class: 'btn ghost sm',
            text: showFull ? 'Less' : 'Full case',
            onclick: () => { showFull = !showFull; renderDock(); } })
          : null,
        el('button', { class: 'btn ghost sm', text: 'Quit', onclick: () => CW.mission.quit() }))));
  }

  // The lab: free play on flows you have already beaten.
  function renderLab(d) {
    const w = G.world();
    const back = () => { G.lab = false; G.flowSel = null; G.stopPacket(); renderDock(); };
    const bar = el('div', { class: 'flowbar' },
      el('button', { class: 'btn ghost', text: '‹ Missions', onclick: back }),
      el('span', { class: 'lbl', text: 'Lab' }));
    for (const f of w.flows) {
      const open = G.labOpen(w, f);
      bar.append(el('button', {
        class: 'fchip' + (G.flowSel === f.id ? ' on' : ''),
        disabled: !open,
        title: open ? '' : 'Beat a mission in this flow first',
        onclick: () => shared.selectFlow(G.flowSel === f.id ? null : f.id),
      }, f.name));
    }
    d.append(bar);
    const f = G.flowSel && G.flow(G.flowSel);
    if (!f) {
      d.append(el('div', {
        class: 'small muted',
        text: 'Pick a flow you have beaten. Replay a case, inject your own, or change the flow and see what breaks.',
      }));
      return;
    }

    const ctl = el('div', { class: 'flowctl' });
    ctl.append(el('div', { class: 'trigger' }, el('b', { text: 'Starts when: ' }), f.trigger));
    const sel = el('select', { 'aria-label': 'Case to run' });
    for (const c of f.cases || []) sel.append(el('option', { value: 'case:' + c.id, text: 'Case: ' + c.name }));
    sel.append(el('option', { value: 'manual', text: 'Walk it yourself — you pick each turn' }));
    sel.append(el('option', { value: 'custom', text: 'Inject your own case…' + (G.backend.can.simulate ? '' : ' (needs AI)') }));
    sel.value = caseChoice[f.id] || sel.options[0].value;
    const custom = el('input', {
      type: 'text',
      placeholder: 'Describe the input, e.g. a new user with an empty cart',
      style: 'max-width:340px;flex:1 1 220px',
    });
    custom.hidden = sel.value !== 'custom';
    sel.onchange = () => { caseChoice[f.id] = sel.value; custom.hidden = sel.value !== 'custom'; };
    const play = el('button', { class: 'btn primary', text: G.packet ? 'Replay' : 'Play' });
    play.onclick = () => playChoice(f, sel.value, custom.value);
    const onStep = (e) => { shared.stepMode = e.target.checked; if (G.packet) G.packet.stepMode = shared.stepMode; };
    const step = el('label', { class: 'toggle' },
      el('input', { type: 'checkbox', checked: shared.stepMode, onchange: onStep }),
      'Step by step');
    const fol = el('label', { class: 'toggle' },
      el('input', { type: 'checkbox', checked: shared.follow, onchange: (e) => (shared.follow = e.target.checked) }),
      'Camera follows');
    fol.classList.add('opt-desk');
    const seg = el('div', { class: 'seg opt-desk', role: 'group', 'aria-label': 'Speed' });
    for (const s of [0.5, 1, 2]) {
      seg.append(el('button', {
        class: shared.speed === s ? 'on' : '',
        text: s + '×',
        onclick: () => { shared.speed = s; renderDock(); } }));
    }
    const change = el('button', { class: 'btn', text: 'Change this flow', onclick: () => shared.openChange(f) });
    const stop = G.packet ? el('button', { class: 'btn ghost', text: 'Stop', onclick: () => G.stopPacket() }) : null;
    ctl.append(...[sel, custom, play, step, seg, fol, change, stop].filter(Boolean));
    d.append(ctl);

    // step strip
    const strip = el('div', { class: 'steps' });
    const P = G.packet && G.packet.flow.id === f.id ? G.packet : null;
    const order = P ? P.path : f.steps.map((s) => s.id);
    order.forEach((sid, i) => {
      const s = G.stepById(f, sid); if (!s) return;
      if (i) strip.append(el('span', { class: 'arr', text: '→' }));
      const cls = 'st' + (P && i === P.i ? ' on' : P && i < P.i ? ' past' : '');
      strip.append(el('span', {
        class: cls,
        title: s.action,
        text: `${i + 1}. ${G.entity(s.at)?.name || s.at}`,
        onclick: () => { const en = G.entity(s.at); if (en) U.openEntity(en); },
      }));
    });
    d.append(strip);
  }

  // Run what the Lab's case list says: a mapped case, a manual walk, or an AI-simulated custom case.
  async function playChoice(f, choice, customText) {
    if (choice.startsWith('case:')) {
      const c = f.cases.find((x) => 'case:' + x.id === choice);
      G.startPacket(f, {
        path: c.path, outcome: c.outcome, explain: c.explain, label: c.name, caseId: c.id,
        source: 'case', stepMode: shared.stepMode, input: c.input,
      });
      G.packet.input = c.input;
    } else if (choice === 'manual') {
      G.startPacket(f, { source: 'manual', label: 'Your own walk' });
    } else {
      if (!G.backend.can.simulate) return U.toast(shared.aiOffText(), 'err');
      if (!customText.trim()) return U.toast('Describe the case first', 'err');
      await shared.runSimulation(f, customText.trim(), '', null);
    }
  }

  // Keep only the part of an AI-returned path that really exists in flow `f`: it must begin at
  // the start step and every hop must be a mapped `next`. Falls back to just the start step.
  function validPath(f, path) {
    const out = [];
    for (const id of path || []) {
      if (!G.stepById(f, id)) break;
      if (out.length) {
        const prev = G.stepById(f, out[out.length - 1]);
        if (!(prev.next || []).some((n) => n.to === id)) break;
      } else if (id !== f.start) break;
      out.push(id);
    }
    return out.length ? out : [f.start];
  }

  // Ask the AI to trace `input` through flow `f` (optionally with `change` applied), then play the
  // result as a packet. `resultBox` gets a summary card; `expected` is the mapped case being compared.
  shared.runSimulation = async function (f, input, change, resultBox, expected) {
    U.toast('Claude is tracing it through the code…');
    if (resultBox) resultBox.innerHTML = '<p class="muted">Claude is tracing it through the code… (10–60s)</p>';
    try {
      const r = await G.backend.simulate({ worldId: G.wid, flowId: f.id, input, change });
      const path = validPath(f, r.path);
      const known = f.outcomes.find((o) => o.id === r.outcome);
      const kind = known?.kind || r.outcomeKind || 'success';
      G.count('sim');
      if (change && expected && (r.outcome !== expected.outcome)) G.count('breaks');
      if (change && (kind === 'blocked' || kind === 'error') && !expected) G.count('breaks');
      G.award(CW.XP.sim, change ? 'simulated a change' : 'injected a case');
      G.startPacket(f, {
        path, outcome: known ? known.id : null, outcomeKind: kind, narration: r.narration || [], source: 'ai',
        stepMode: shared.stepMode,
        label: change ? 'Changed flow' : 'Your case',
        meta: {
          label: known ? known.label : String(r.outcome || '').replace(/^new:/, ''),
          confidence: r.confidence, assumptions: r.assumptions, risk: r.risk, isNew: !known,
        },
      });
      G.packet.input = input;
      if (resultBox) {
        const ending = known ? known.label : String(r.outcome).replace(/^new:/, 'New ending: ');
        const before = expected && (f.outcomes.find((o) => o.id === expected.outcome)?.label || expected.outcome);
        const saveNote = () => G.addNote(
          `What-if on "${f.name}": ${change || input} → ${known ? known.label : r.outcome}. ${r.risk || ''}`,
          { wid: G.wid, fid: f.id, label: `${G.world().name} › ${f.name}` });
        resultBox.innerHTML = '';
        resultBox.append(el('div', { class: 'result ' + kind },
          el('p', {}, el('span', { class: 'tag-ai', text: 'AI simulation' }), ' ', el('b', { text: ending })),
          expected ? el('p', { class: 'small', text: `Before your change this case ended: ${before}` }) : null,
          el('p', { class: 'small', text: `Confidence: ${r.confidence || '?'}. ${r.assumptions || ''}` }),
          r.filesRead?.length ? el('p', { class: 'small muted', text: 'Read: ' + r.filesRead.join(', ') }) : null,
          r.risk ? el('p', { class: 'small' }, el('b', { text: 'Watch out: ' }), r.risk) : null,
          el('div', { class: 'row' }, el('button', { class: 'btn', text: 'Save as note', onclick: saveNote }))));
      }
    } catch (e) { if (resultBox) resultBox.innerHTML = ''; shared.fail(e); }
  };
})(window.CW);
