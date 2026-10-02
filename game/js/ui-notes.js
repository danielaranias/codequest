/* CodeQuest — notes and tasks (press N): write notes, turn them into tasks, copy a task as a
   prompt or send it to the agent, and poll backend jobs until they end.
   Also defines G.addNote, which the rest of the game uses to save a note.
   Must not run anything itself: dispatching a task always goes through a confirm box and the backend. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { el } = CW;
  const U = CW.ui, shared = U._;

  // `silent` saves without awarding XP (used for notes the game writes for you).
  G.addNote = function (text, at, silent) {
    G.state.notes.unshift({ id: CW.uid(), text, at, created: new Date().toISOString() });
    if (!silent) G.award(CW.XP.note, 'note saved');
    else G.save();
    G.checkBadges();
    if (shared.pane && (shared.pane.type === 'notes' || shared.pane.type === 'entity')) shared.rerender();
  };
  shared.addTask = function ({ title, detail, at, noteId }) {
    G.state.tasks.unshift({ id: CW.uid(), title, detail, at, noteId, status: 'open', created: new Date().toISOString() });
    G.award(CW.XP.task, 'task created');
    U.toast('Added to your tasks (N)');
    if (shared.pane) shared.rerender();
  };
  shared.noteEl = function (n) {
    const toTask = () => shared.addTask({ title: n.text.split('\n')[0].slice(0, 90), detail: n.text, at: n.at, noteId: n.id });
    const remove = () => { G.state.notes = G.state.notes.filter((x) => x.id !== n.id); G.save(); shared.rerender(); };
    return el('div', { class: 'note' },
      el('div', { class: 'meta' }, el('span', { text: n.at?.label || '' }), el('span', { text: CW.timeAgo(n.created) })),
      el('div', { text: n.text }),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', text: 'Make it a task', onclick: toTask }),
        el('button', { class: 'btn ghost', text: 'Delete', onclick: remove })));
  };
  // The text handed to a coding agent for one task.
  function taskPrompt(t) {
    return `CodeQuest task from exploring ${G.W.repo.name}${t.at?.label ? ' (' + t.at.label + ')' : ''}:\n\n${t.title}\n\n${t.detail || ''}\n\n`
      + 'Work on a new branch. Keep the change small, add or update tests, and explain what you changed.';
  }

  shared.buildNotes = function (b) {
    b.append(el('h2', { text: 'Notes & tasks' }));
    b.append(el('p', {
      class: 'lead',
      text: G.backend.can.dispatch
        ? 'Turn notes into tasks, then hand a task to your agent. It works on its own branch.'
        : 'Turn notes into tasks. Copy a task as a ready prompt for Claude Code.',
    }));
    b.append(el('h3', { text: `Tasks (${G.state.tasks.length})` }));
    if (!G.state.tasks.length) {
      b.append(el('p', { class: 'small muted', text: 'No tasks yet. Found a crack, won a challenge or wrote a note? Make it a task.' }));
    }
    for (const t of G.state.tasks) {
      const statusCls = t.status === 'running' ? 'running' : t.status === 'done' ? 'done' : t.status === 'failed' ? 'failed' : '';
      const row = el('div', { class: 'task' },
        el('div', { class: 'meta small muted', text: t.at?.label || '' }),
        el('b', { text: t.title }),
        t.detail ? el('div', { class: 'small', text: t.detail.slice(0, 400) }) : null,
        el('div', { class: 'row' },
          el('span', { class: 'status ' + statusCls, text: t.status === 'open' ? 'Open' : t.status }),
          t.branch ? el('span', { class: 'small mono', text: 'branch ' + t.branch }) : null));
      const actions = el('div', { class: 'row' });
      if (G.backend.can.dispatch && (t.status === 'open' || t.status === 'failed')) {
        actions.append(el('button', { class: 'btn ai', text: 'Send to agent', onclick: () => dispatchTask(t) }));
      }
      actions.append(el('button', { class: 'btn ghost', text: 'Copy as prompt', onclick: () => shared.copy(taskPrompt(t)) }));
      if (t.status !== 'running') {
        const remove = () => { G.state.tasks = G.state.tasks.filter((x) => x.id !== t.id); G.save(); shared.rerender(); };
        actions.append(el('button', { class: 'btn ghost', text: 'Remove', onclick: remove }));
      }
      if (t.summary) row.append(el('p', { class: 'small', text: t.summary }));
      row.append(actions);
      b.append(row);
    }
    b.append(el('h3', { text: `Notes (${G.state.notes.length})` }));
    const ta = el('textarea', { rows: 2, placeholder: 'A thought about the codebase…' });
    const save = () => {
      if (ta.value.trim()) {
        G.addNote(ta.value.trim(), G.scene === 'world' ? { wid: G.wid, label: G.world().name } : { label: G.W.repo.name });
      }
    };
    b.append(ta, el('div', { class: 'row' },
      el('button', { class: 'btn', text: 'Save note', onclick: save }),
      el('button', { class: 'btn ghost', text: 'Copy all as Markdown', onclick: () => shared.copy(exportMd()) })));
    G.state.notes.forEach((n) => b.append(shared.noteEl(n)));
  };

  // All tasks and notes as one Markdown document.
  function exportMd() {
    const L = [`# CodeQuest notes — ${G.W.repo.name}`, '', '## Tasks', ''];
    for (const t of G.state.tasks) {
      const where = t.at?.label ? ` _(${t.at.label})_` : '';
      const branch = t.branch ? ` — branch \`${t.branch}\`` : '';
      L.push(
        `- [${t.status === 'done' ? 'x' : ' '}] **${t.title}**${where}${branch}`,
        ...(t.detail ? ['  ' + t.detail.replace(/\n/g, '\n  ')] : []));
    }
    L.push('', '## Notes', '');
    for (const n of G.state.notes) L.push(`- ${n.at?.label ? `_${n.at.label}_: ` : ''}${n.text.replace(/\n/g, ' ')}`);
    return L.join('\n');
  }

  // Hand one task to the agent (after a confirm), then follow the job and record how it ended.
  async function dispatchTask(t) {
    const tc = (window.CODEQUEST_CONFIG || {}).testCommand;
    const ok = await shared.confirmBox(
      'Send this task to your agent?',
      `Your agent will work in a separate git worktree on a new branch (codequest/task-${t.id}). `
        + `${tc ? `Then this command runs there: ${tc}. ` : ''}`
        + 'Your current files and branch are not edited. Review the branch before merging.',
      'Send it');
    if (!ok) return;
    try {
      const { jobId, branch } = await G.backend.dispatch({ id: t.id, title: t.title, detail: t.detail, at: t.at, prompt: taskPrompt(t) });
      t.status = 'running'; t.branch = branch; t.jobId = jobId; G.save(); shared.rerender();
      shared.watchJob(jobId, (j) => {
        if (j.status === 'done' || j.status === 'failed') {
          t.status = j.status; t.summary = j.result?.summary || (j.log || []).slice(-1)[0]; G.save();
          U.toast(j.status === 'done' ? `Task done on ${t.branch}` : 'Task failed — see notes', j.status === 'done' ? 'badge' : 'err');
          if (shared.pane?.type === 'notes') shared.rerender();
        }
      });
    } catch (e) { shared.fail(e); }
  }

  // Poll a backend job every 2 seconds, calling `onUpdate(job)` each time, until it is no longer running.
  shared.watchJob = function (id, onUpdate) {
    const tick = async () => {
      try {
        const j = await G.backend.job(id);
        onUpdate(j);
        if (j.status === 'running' || j.status === 'queued') setTimeout(tick, 2000);
      } catch (e) { shared.fail(e); }
    };
    tick();
  };
  U.watchJob = shared.watchJob;
})(window.CW);
