/* CodeQuest — the "Change this flow" pane: switch steps off, force a branch or describe a change,
   then simulate it with AI or run it for real in a sandbox.
   Must not edit the world data: a change is only ever a text description sent to the backend. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { el } = CW;
  const U = CW.ui, shared = U._;

  shared.openChange = function (f) {
    if (!f) return;
    G.flowSel = f.id; shared.renderDock();
    shared.openDrawer('change', f.id, (b) => {
      b.append(el('p', { class: 'small muted', text: 'What if…' }));
      b.append(el('h2', { text: 'Change “' + f.name + '”' }));
      b.append(el('p', {
        class: 'lead',
        text: 'Switch steps off, force a branch, or describe your own change. Then run a case through the changed flow.',
      }));
      // one dropdown per step; picks = stepId -> '' | 'skip' | 'off' | 'force:<target>'
      const edits = el('div', { class: 'edits' });
      const picks = {};
      const outcomeLabel = (to) => f.outcomes.find((o) => 'outcome:' + o.id === to)?.label || to;
      f.steps.forEach((s, i) => {
        const en = G.entity(s.at);
        const sel = el('select');
        sel.append(el('option', { value: '', text: 'Keep as is' }), el('option', { value: 'skip', text: 'Skip this step' }));
        if (en?.kind === 'guardrail') sel.append(el('option', { value: 'off', text: 'Turn this check off' }));
        if ((s.next || []).length > 1) {
          for (const n of s.next) {
            const target = n.to.startsWith('outcome:') ? 'end: ' + outcomeLabel(n.to) : n.to;
            sel.append(el('option', { value: 'force:' + n.to, text: 'Always go → ' + target + ` (${n.when})` }));
          }
        }
        sel.onchange = () => (picks[s.id] = sel.value);
        edits.append(el('label', {}, el('span', {}, el('b', { text: `${i + 1}. ${en?.name || s.at}` }), ' — ' + s.action), sel));
      });
      b.append(edits);
      const free = el('textarea', {
        rows: 3,
        placeholder: 'Or describe a change in your words, e.g. “retry the API call 3 times before giving up”' });
      b.append(el('h3', { text: 'Your own change' }), free);
      b.append(el('h3', { text: 'Run it with' }));
      const csel = el('select', { style: 'width:100%' });
      for (const c of f.cases || []) csel.append(el('option', { value: c.id, text: c.name + ' — ' + c.input }));
      csel.append(el('option', { value: '__custom', text: 'My own input…' }));
      const cin = el('input', { type: 'text', placeholder: 'Describe the input', hidden: true });
      csel.onchange = () => (cin.hidden = csel.value !== '__custom');
      b.append(csel, cin);
      const res = el('div', { html: shared.results['chg:' + f.id] || '' });
      // The picks and the free text as one plain-English change, one line each. Empty if nothing is picked.
      const describe = () => {
        const lines = [];
        for (const s of f.steps) {
          const v = picks[s.id]; if (!v) continue;
          const en = G.entity(s.at);
          if (v === 'skip') lines.push(`Remove step ${s.id} (${en?.name}: ${s.action}) — the flow goes straight past it.`);
          if (v === 'off') lines.push(`Turn off the guardrail check at step ${s.id} (${en?.name}): it always lets everything through.`);
          if (v.startsWith('force:')) lines.push(`At step ${s.id} (${en?.name}) always take the branch to ${v.slice(6)}, whatever the condition.`);
        }
        if (free.value.trim()) lines.push(free.value.trim());
        return lines.join('\n');
      };
      // The case to run: `expected` is the mapped case (to compare endings), or null for a typed input.
      const inputNow = () => {
        if (csel.value === '__custom') return { input: cin.value.trim(), expected: null };
        const c = f.cases.find((x) => x.id === csel.value);
        return { input: c?.input || '', expected: c || null };
      };
      const sim = el('button', { class: 'btn ai', text: 'Simulate with AI' });
      sim.disabled = !G.backend.can.simulate;
      sim.onclick = async () => {
        const change = describe();
        if (!change) return U.toast('Pick or describe a change first', 'err');
        const { input, expected } = inputNow();
        sim.disabled = true;
        await shared.runSimulation(f, input, change, res, expected);
        shared.results['chg:' + f.id] = res.innerHTML;
        sim.disabled = false;
      };
      const run = el('button', { class: 'btn', text: 'Run it for real' });
      run.hidden = !G.backend.can.run;
      run.title = 'Your agent makes the change in a throwaway copy of the repo and runs your tests. Your files are not touched.';
      run.onclick = async () => {
        const change = describe();
        if (!change) return U.toast('Pick or describe a change first', 'err');
        const tc = (window.CODEQUEST_CONFIG || {}).testCommand;
        const tests = tc ? `Then this command runs in that copy: ${tc}` : 'No test command is set, so no tests will run.';
        const ok = await shared.confirmBox(
          'Run it for real?',
          `Your agent will copy the repo into a temporary git worktree and make this change there. ${tests}`
            + ` Tests are this repo's own code: only do this on a repo you trust.`
            + ` Your working files are not edited, and the copy is deleted afterwards.`,
          'Start the run');
        if (!ok) return;
        const { input } = inputNow();
        try {
          const { jobId } = await G.backend.run({ worldId: G.wid, flowId: f.id, change, input });
          res.innerHTML = '<p class="muted">Sandbox run started…</p>';
          shared.watchJob(jobId, (j) => showJob(j, res, f));
        } catch (e) { shared.fail(e); }
      };
      const saveTask = () => {
        const c = describe();
        if (c) {
          shared.addTask({ title: `Change “${f.name}”`, detail: c, at: { wid: G.wid, fid: f.id, label: `${G.world().name} › ${f.name}` } });
        }
      };
      b.append(el('div', { class: 'row' }, sim, run, el('button', { class: 'btn ghost', text: 'Save as task', onclick: saveTask })));
      if (!G.backend.can.simulate) b.append(el('p', { class: 'small muted', text: shared.aiOffText() }));
      b.append(res);
    });
  };

  // Draw the state of a sandbox job into `res`; called again on every poll until it ends.
  function showJob(j, res, f) {
    const cls = j.status === 'done' ? (j.result?.passed ? 'success' : 'blocked') : j.status === 'failed' ? 'error' : '';
    res.innerHTML = '';
    res.append(el('div', { class: 'result ' + cls },
      el('p', {},
        el('b', { text: 'Sandbox run: ' }),
        el('span', { class: 'status ' + j.status, text: j.status }),
        j.result ? (j.result.passed ? ' Tests passed' : ' Tests failed') : ''),
      j.result?.summary ? el('p', { class: 'small', text: j.result.summary }) : null,
      j.result?.diff
        ? el('details', { class: 'code' }, el('summary', { text: 'The change it made' }), el('pre', { class: 'log', text: j.result.diff }))
        : null,
      el('pre', { class: 'log', text: (j.log || []).slice(-60).join('\n') })));
    if (j.status === 'done' && !j._counted) { j._counted = 1; G.award(CW.XP.run, 'ran a real experiment'); }
    shared.results['chg:' + f.id] = res.innerHTML;
  }
})(window.CW);
