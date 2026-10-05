/* CodeQuest — the entity pane: what the drawer shows for one building, in four tabs
   (About / Code / Ask / More), plus the hidden "crack" cards.
   Owns the Ask chat log. Must not move the player or start missions. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { el, esc } = CW;
  const U = CW.ui, shared = U._;

  const chats = {}; // wid/eid -> [{q, a, pending}]
  const KIND = () => CW.KIND;
  // Where a note or task was made, so it can be shown as "World › Building".
  const anchor = (en) => ({ wid: G.wid, eid: en.id, label: `${G.world().name} › ${en.name}` });

  function kindChip(kind) {
    const k = KIND()[kind] || KIND().module;
    return el('span', { class: 'kind' }, el('i', { style: `background:${k.color}`, text: k.glyph }), k.label);
  }
  function statusChip(st) {
    const label = {
      synced: 'Matches the code',
      drifted: 'Code moved a little',
      stale: 'Changed since mapped',
      lost: 'File is gone',
    }[st];
    return el('span', { class: 'chip', style: 'cursor:default' }, el('span', { class: 'dot ' + st }), label);
  }
  // A folded code snippet with line numbers; `ref` is {file, lines:[from,to], snippet}.
  function codeBlock(ref) {
    const cfg = window.CODEQUEST_CONFIG || {};
    const [a, b] = ref.lines || [1, 1];
    const pre = el('pre', { class: 'src' });
    (ref.snippet || '').split('\n').forEach((line, i) => pre.append(el('span', { class: 'l', 'data-n': a + i, text: line || ' ' })));
    const open = cfg.repoPath ? el('a', { href: `vscode://file/${cfg.repoPath}/${ref.file}:${a}`, text: 'Open' }) : null;
    return el('details', { class: 'code' },
      el('summary', {}, el('span', { text: `${ref.file} : ${a}–${b}` }), open),
      ref.snippet ? pre : el('p', { class: 'muted small', style: 'padding:0 10px', text: 'Code not available in this snapshot.' }));
  }

  // Open the drawer on building `en`. `tab` forces a tab; otherwise the tab already open is kept.
  U.openEntity = function (en, tab) {
    if (!en) return;
    const pane = shared.pane;
    const keepTab = tab || (pane?.type === 'entity' && pane.id === en.id ? pane.tab : null) || 'about';
    const w = G.world();
    G.markVisit(en);
    G.selected = en.id;
    shared.openDrawer('entity', en.id, (b) => {
      const T = { about: el('div'), code: el('div'), ask: el('div'), more: el('div') };
      const st = G.entityStatus(w.id, en.id);
      b.append(el('div', { class: 'kindrow' }, kindChip(en.kind), G.sync ? statusChip(st) : null));
      b.append(el('h2', { text: en.name }));
      b.append(el('p', { class: 'lead', text: en.summary }));
      // the mission step that happens at this building, if the player is on one
      const ms = CW.mission.currentStep();
      const here = ms && ms.at === en.id ? ms : null;
      fillAbout(T.about, w, en, here);
      fillCode(T.code, en, here);
      fillAsk(T.ask, w, en);
      fillChallenge(T.ask, w, en);
      fillMore(T.more, w, en);

      const names = { about: 'About', code: 'Code', ask: 'Ask', more: 'More' };
      const bar = el('div', { class: 'ptabs', role: 'tablist' });
      const show = (k) => {
        shared.pane.tab = k;
        for (const [n, node] of Object.entries(T)) node.hidden = n !== k;
        CW.$$('button', bar).forEach((bt) => bt.classList.toggle('on', bt.dataset.k === k));
      };
      for (const k of Object.keys(T)) bar.append(el('button', { 'data-k': k, role: 'tab', text: names[k], onclick: () => show(k) }));
      b.append(bar, T.about, T.code, T.ask, T.more);
      if (!T.about.childNodes.length) {
        T.about.append(el('p', { class: 'small muted', text: 'Open Code to see the real lines, or Ask to question it.' }));
      }
      show(T[keepTab] ? keepTab : 'about');
    });
  };

  // About tab: its part in the current mission, guardrail rule, agent role, cracks.
  function fillAbout(box, w, en, here) {
    if (here) {
      box.append(el('div', { class: 'card now' },
        el('p', { class: 'small muted', text: 'Right now, in your mission' }),
        el('p', {}, el('b', { text: here.action }))));
    }
    if (en.guard) {
      box.append(el('div', { class: 'card guard' }, el('dl', {},
        el('dt', { text: 'Rule' }), el('dd', { text: en.guard.rule }),
        el('dt', { text: 'Checks' }), el('dd', { text: en.guard.checks }),
        el('dt', { text: 'If it fails' }), el('dd', { text: en.guard.onFail }))));
    }
    if (en.agent) {
      const tools = (en.agent.tools || []).map((id) => G.entity(id)).filter(Boolean);
      const card = el('div', { class: 'card' }, el('p', {}, el('b', { text: 'Role: ' }), en.agent.role));
      if (en.agent.model) card.append(el('p', { class: 'small muted', text: 'Model: ' + en.agent.model }));
      if (tools.length) {
        const link = (t) => el('a', { href: '#', onclick: (e) => { e.preventDefault(); U.openEntity(t); }, text: t.name });
        card.append(el('p', { class: 'small' }, el('b', { text: 'Can use: ' }), ...tools.map((t, i) => [i ? ', ' : '', link(t)])));
      }
      box.append(card);
    }
    // a weak-spot puzzle is a second question; never put it beside a mission's own question
    if (!G.mission) for (const k of (w.cracks || []).filter((k) => k.at === en.id)) box.append(crackCard(w, k));
  }

  // Code tab: the lines that decide the current fork come first.
  function fillCode(box, en, here) {
    const fork = here && here.source;
    if (fork) {
      box.append(el('p', { class: 'small muted', text: 'The lines that decide this fork' }));
      const blk = codeBlock(here.source);
      blk.open = true;
      box.append(blk);
    }
    if ((en.source || []).length) {
      box.append(el('p', { class: 'small muted', text: fork ? 'The rest of this building' : 'Where this lives in the code' }));
      en.source.forEach((r, i) => {
        const blk = codeBlock(r);
        if (i === 0 && !fork) blk.open = true;
        box.append(blk);
      });
    }
  }

  // Ask tab, first half: a chat with Claude about this building.
  function fillAsk(box, w, en) {
    box.append(el('h3', { style: 'margin-top:6px' },
      'Ask about it ',
      G.backend.can.ask ? el('span', { class: 'tag-ai', text: 'AI' }) : null));
    const key = w.id + '/' + en.id;
    const log = el('div');
    (chats[key] || []).forEach((m) => log.append(answerEl(m)));
    box.append(log);
    if (!G.backend.can.ask) { box.append(el('p', { class: 'small muted', text: shared.aiOffText() })); return; }
    const ta = el('textarea', { rows: 2, placeholder: `e.g. Why does ${en.name} work this way?` });
    const go = el('button', { class: 'btn ai', text: 'Ask Claude' });
    go.onclick = async () => {
      const q = ta.value.trim(); if (!q) return;
      ta.value = '';
      const m = { q, a: '', pending: true };
      (chats[key] = chats[key] || []).push(m);
      let node = answerEl(m); log.append(node);
      const upd = () => { const n2 = answerEl(m); node.replaceWith(n2); node = n2; };
      try {
        m.a = await G.backend.ask({ worldId: w.id, entityId: en.id, question: q }, (txt) => { m.a = txt; upd(); });
      } catch (e) { m.a = 'Could not get an answer. ' + (e.message || shared.aiError(e.code)); }
      m.pending = false; upd();
    };
    box.append(ta, el('div', { class: 'row' }, go));
  }

  // Ask tab, second half: claim something is wrong; Claude referees against the code.
  function fillChallenge(box, w, en) {
    const key = w.id + '/' + en.id;
    box.append(el('h3', {}, 'Challenge it ', G.backend.can.challenge ? el('span', { class: 'tag-ai', text: 'AI' }) : null));
    box.append(el('p', {
      class: 'small muted',
      text: 'Think something here is wrong, risky or missing? Say why. If you are right, you earn XP and a ready-made task.',
    }));
    const cta = el('textarea', { rows: 2, placeholder: 'I think this breaks when…' });
    const cres = el('div', { html: shared.results['ch:' + key] || '' });
    const cbtn = el('button', { class: 'btn ai', text: 'Challenge' });
    cbtn.disabled = !G.backend.can.challenge;
    cbtn.onclick = async () => {
      const claim = cta.value.trim(); if (!claim) return;
      cbtn.disabled = true; cres.innerHTML = '<p class="muted">Claude is checking your claim against the code…</p>';
      try {
        const r = await G.backend.challenge({ worldId: w.id, entityId: en.id, claim });
        G.count('challenges');
        const hit = r.verdict === 'confirmed' || r.verdict === 'partly';
        if (hit) G.count('challengeHit');
        G.award(hit ? CW.XP.challengeHit : CW.XP.challenge, hit ? 'challenge won' : 'challenge made');
        const verdict = {
          confirmed: 'You are right.',
          partly: 'Partly right.',
          'not-a-problem': 'Not a problem.',
          'cannot-tell': 'Cannot tell from the code.',
        }[r.verdict] || r.verdict;
        const fix = r.suggestion ? `<p class="small"><b>Fix:</b> ${esc(r.suggestion)}</p>` : '';
        shared.results['ch:' + key] = `<div class="card"><p class="verdict ${esc(r.verdict)}">${esc(verdict)}</p>`
          + `<div>${CW.md(r.explanation || '')}</div>${fix}</div>`;
        cres.innerHTML = shared.results['ch:' + key];
        if (hit) {
          cres.append(el('button', {
            class: 'btn',
            text: 'Make it a task',
            onclick: () => shared.addTask({
              title: r.taskTitle || claim.slice(0, 80),
              detail: `${claim}\n\nReferee: ${r.explanation}\nFix: ${r.suggestion}`,
              at: anchor(en),
            }),
          }));
        }
        G.addNote(`Challenge on ${en.name}: ${claim} → ${r.verdict}`, anchor(en), true);
      } catch (e) { cres.innerHTML = ''; shared.fail(e); }
      cbtn.disabled = false;
    };
    box.append(cta, el('div', { class: 'row' }, cbtn), cres);
    if (!G.backend.can.challenge) box.append(el('p', { class: 'small muted', text: shared.aiOffText() }));
  }

  // More tab: long details, the flows that pass through here, and the player's own notes.
  function fillMore(box, w, en) {
    if (en.details) box.append(el('div', { html: CW.md(en.details) }));

    const steps = [];
    for (const f of w.flows) f.steps.forEach((s, i) => { if (s.at === en.id) steps.push({ f, s, i }); });
    if (steps.length) {
      box.append(el('h3', { text: 'Flows that pass through here' }));
      const seen = new Set();
      for (const { f, s, i } of steps) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        box.append(el('button', { class: 'flowlink', onclick: () => { if (G.mission) return; G.lab = true; shared.selectFlow(f.id); } },
          el('b', { text: f.name }), el('span', { text: `Step ${i + 1}: ${s.action}` })));
      }
    }

    box.append(el('h3', { text: 'Note to self' }));
    const nta = el('textarea', { rows: 2, placeholder: 'Something to remember or improve here…' });
    const save = () => { if (nta.value.trim()) { G.addNote(nta.value.trim(), anchor(en)); nta.value = ''; } };
    box.append(nta, el('div', { class: 'row' }, el('button', { class: 'btn', text: 'Save note', onclick: save })));
    const mine = G.state.notes.filter((n) => n.at?.wid === w.id && n.at?.eid === en.id);
    mine.forEach((n) => box.append(shared.noteEl(n)));
  }

  function answerEl(m) {
    return el('div', { class: 'answer' + (m.pending && !m.a ? ' pending' : '') },
      el('div', { class: 'q', text: m.q }),
      el('div', { html: m.a ? CW.md(m.a) : '<p>Claude is reading the code…</p>' }));
  }

  // A hidden problem at a building: a multiple-choice guess until found, then the finding itself.
  function crackCard(w, k) {
    const found = G.state.cracks[w.id]?.[k.id];
    if (found) {
      const task = () => shared.addTask({
        title: k.suggestion.slice(0, 90),
        detail: `${k.title}\n${k.finding}\nFix: ${k.suggestion}${k.source ? `\nCode: ${k.source.file}:${k.source.lines?.[0]}` : ''}`,
        at: { wid: w.id, eid: k.at, label: `${w.name} › ${G.entity(k.at, w)?.name}` },
      });
      return el('div', { class: 'card found' },
        el('p', {}, el('b', { text: 'Crack found: ' + k.title }), ` (${k.severity})`),
        el('p', { class: 'small', text: k.finding }),
        el('p', { class: 'small' }, el('b', { text: 'Better: ' }), k.suggestion),
        el('div', { class: 'row' }, el('button', { class: 'btn', text: 'Make it a task', onclick: task })),
        k.source ? codeBlock(k.source) : null);
    }
    const missKey = w.id + '/' + k.id;
    const missedAt = G.state.crackMiss[missKey] || 0;
    // a wrong guess locks the options for 20 seconds
    const wait = Math.max(0, 20 - (Date.now() - missedAt) / 1000);
    const card = el('div', { class: 'card crack' },
      el('p', {}, el('b', { text: 'Something here does not sit right.' })),
      el('p', { class: 'small', text: 'Hint: ' + k.hint }));
    const opts = shuffle([k.title, ...(k.decoys || [])], k.id);
    const box = el('div');
    if (wait > 0) {
      box.append(el('p', { class: 'small muted', text: `Wrong guess — look at the code and try again in ${Math.ceil(wait)}s.` }));
    } else opts.forEach((o) => box.append(el('button', { class: 'opt', text: o, onclick: () => {
      if (o === k.title) {
        CW.game.state.cracks[w.id] = CW.game.state.cracks[w.id] || {};
        G.state.cracks[w.id][k.id] = 1;
        G.award(CW.XP.crack, 'found a crack');
        G.checkBadges(); shared.rerender();
      } else {
        G.state.crackMiss[missKey] = Date.now(); G.save();
        U.toast('Not that one', 'err');
        shared.rerender(); setTimeout(shared.rerender, 20500);
      }
    } })));
    card.append(el('p', { class: 'small', text: 'What is the problem?' }), box);
    return card;
  }
  // Same seed, same order: the options do not jump around between re-renders.
  function shuffle(arr, seed) {
    const r = CW.rng(seed), a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
})(window.CW);
