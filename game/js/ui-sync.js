/* CodeQuest — the badges pane and the sync pane ("Is the map up to date?"): how the mapped
   worlds compare with the live code, pulling, and re-mapping worlds with the agent.
   Must not compute sync status itself — it only shows what the backend reports in G.sync. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el } = CW;
  const U = CW.ui, shared = U._;

  const plural = (n) => (n > 1 ? 's' : '');

  // ---------- badges ----------
  shared.buildBadges = function (b) {
    b.append(el('h2', { text: 'Badges' }));
    b.append(el('p', {
      class: 'lead',
      text: `${Object.keys(G.state.badges).length} earned. Level ${G.level()} ${G.title()}, ${G.state.xp} XP.` }));
    const grid = el('div', { class: 'badges' });
    for (const x of G.badgeList()) {
      grid.append(el('div', { class: 'badge' + (G.state.badges[x.id] ? ' on' : '') },
        el('b', { text: x.name }), el('span', { text: x.desc })));
    }
    b.append(grid);
    b.append(el('h3', { text: 'Free roam' }));
    b.append(el('p', {
      class: 'small muted',
      text: 'Worlds open one by one as you clear them. Turn this on to open every world and reveal every building at once. Your stars stay.',
    }));
    const onRoam = (e) => { G.state.freeRoam = e.target.checked; G.save(); U.updateHUD(); shared.renderDock(); };
    b.append(el('label', { class: 'toggle' },
      el('input', { type: 'checkbox', checked: G.state.freeRoam, onchange: onRoam }),
      'Open everything'));
    b.append(el('h3', { text: 'How XP works' }));
    b.append(el('div', { html: CW.md([
      '- Finish a mission: 15, and 10 more per extra star',
      `- Discover a building: ${CW.XP.visit}`,
      `- First time through a flow: ${CW.XP.trace}`,
      `- Quiz right first time: ${CW.XP.quiz}`,
      `- Find a hidden crack: ${CW.XP.crack}`,
      `- Inject a case or simulate a change: ${CW.XP.sim}`,
      `- Win a challenge: ${CW.XP.challengeHit}`,
      `- Real sandbox run: ${CW.XP.run}`,
      `- Master a world: ${CW.XP.mastery}`,
    ].join('\n')) }));
  };

  // ---------- sync ----------
  shared.buildSync = function (b) {
    const S = G.sync;
    b.append(el('h2', { text: 'Is the map up to date?' }));
    if (!S) {
      // an exported snapshot has no live repo to compare with
      b.append(el('p', {
        class: 'lead',
        text: `This is a snapshot of ${G.W.repo.name} at commit ${CW.shortSha(G.W.repo.commit)}, mapped ${CW.timeAgo(G.W.repo.mappedAt)}.`,
      }));
      b.append(el('p', {
        text: 'A snapshot cannot see newer code. Run the game inside the repo (codequest play) to check every building'
          + ' against the live code, see fog where things changed, and re-map only those worlds.',
      }));
      if (G.W.uncharted?.length) b.append(el('p', { class: 'small muted', text: 'Not mapped yet: ' + G.W.uncharted.join(', ') }));
      return;
    }
    const later = S.commitsSinceMap ? ` · ${S.commitsSinceMap} commit${plural(S.commitsSinceMap)} later` : '';
    const dirty = S.dirtyFiles ? ` · ${S.dirtyFiles} uncommitted file${plural(S.dirtyFiles)}` : '';
    let remote = 'Not checked yet';
    if (S.remote) {
      if (!S.remote.upstream) remote = 'No upstream branch';
      else remote = S.remote.behind ? `${S.remote.behind} new on ${S.remote.upstream}` : `Up to date with ${S.remote.upstream}`;
    }
    const facts = el('dl', { class: 'facts' },
      el('dt', { text: 'Mapped at' }), el('dd', { text: `${CW.shortSha(S.mappedCommit)} · ${CW.timeAgo(G.W.repo.mappedAt)}` }),
      el('dt', { text: 'Your code' }), el('dd', { text: `${CW.shortSha(S.head)}${later}${dirty}` }),
      el('dt', { text: 'Remote' }), el('dd', { text: remote }),
      el('dt', { text: 'Checked' }), el('dd', { text: CW.timeAgo(S.checkedAt) }));
    b.append(facts);
    const row = el('div', { class: 'row' });
    const check = async (e) => {
      e.target.disabled = true;
      try { G.sync = await G.backend.refresh({ fetch: true }); U.updateHUD(); shared.rerender(); } catch (er) { shared.fail(er); }
      e.target.disabled = false;
    };
    row.append(el('button', { class: 'btn', text: 'Check the remote', onclick: check }));
    if (S.remote?.behind) {
      const pull = async () => {
        try { const r = await G.backend.pull(); U.toast(r.message || 'Pulled'); await reloadWorld(); } catch (er) { shared.fail(er); }
      };
      row.append(el('button', { class: 'btn primary', text: `Pull ${S.remote.behind} commit${plural(S.remote.behind)}`, onclick: pull }));
    }
    b.append(row);

    b.append(el('h3', { text: 'Worlds' }));
    const stale = [];
    for (const w of G.W.worlds) {
      const ws = S.worlds[w.id];
      if (ws.status === 'stale' || ws.status === 'lost') stale.push(w.id);
      const gone = ws.counts.stale + ws.counts.lost;
      const label = {
        synced: 'Matches the code',
        drifted: `${ws.counts.drifted} building${plural(ws.counts.drifted)} moved a little`,
        stale: `${gone} building${plural(gone)} out of date`,
        lost: 'Files are gone',
      }[ws.status];
      b.append(el('div', { class: 'syncworld' },
        el('span', { class: 'dot ' + ws.status }), el('b', { text: w.name }), el('span', { class: 'small muted', text: label }),
        ws.staleFiles.length ? el('div', { class: 'files', text: ws.staleFiles.join('\n') }) : null));
    }
    if (S.uncharted?.newSinceMap?.length) {
      b.append(el('p', { class: 'small' }, el('b', { text: 'New code no world covers yet: ' }), S.uncharted.newSinceMap.join(', ')));
    }
    b.append(el('p', {
      class: 'small muted',
      text: 'Drifted means the file changed but the key line is still there — the map is probably still right.'
        + ' Out of date means the key code is gone or rewritten: that world shows fog until you re-map it.'
        + ` ${S.uncharted?.count || 0} source files are not in any world.`,
    }));
    const rm = el('div', { class: 'row' });
    if (stale.length) {
      rm.append(el('button', {
        class: 'btn primary',
        text: `Re-map ${stale.length} out-of-date world${plural(stale.length)}`,
        onclick: () => remap(stale) }));
    }
    rm.append(el('button', { class: 'btn', text: 'Re-map everything', onclick: () => remap(G.W.worlds.map((w) => w.id)) }));
    b.append(rm);
    const jobBox = el('div', { id: 'remap-job' });
    b.append(jobBox);
  };

  // Ask the agent to map the given worlds again (after a confirm), and show the job log in the pane.
  async function remap(ids) {
    const ok = await shared.confirmBox(
      'Re-map with your agent?',
      `Your agent will read the code again and rewrite ${ids.length} world${plural(ids.length)}. This can take a few minutes. Your progress stays.`,
      'Re-map');
    if (!ok) return;
    try {
      const { jobId } = await G.backend.remap(ids);
      U.toast('Re-mapping started');
      shared.watchJob(jobId, async (j) => {
        const box = $('#remap-job');
        if (box) {
          box.innerHTML = '';
          box.append(
            el('p', {}, el('span', { class: 'status ' + j.status, text: j.status })),
            el('pre', { class: 'log', text: (j.log || []).slice(-30).join('\n') }));
        }
        if (j.status === 'done') { G.count('remaps'); await reloadWorld(); U.toast('Map updated — the fog has lifted', 'badge'); }
      });
    } catch (e) { shared.fail(e); }
  }

  // Fetch the world again and reload it in place, keeping the player's progress and current world.
  async function reloadWorld() {
    const r = await G.backend.getWorld();
    const keepScene = G.scene, keepW = G.wid;
    G.load({ world: r.world, sync: r.sync, state: G.state });
    if (keepScene === 'world' && G.worldById(keepW)) G.land(keepW); else U.onScene();
    U.updateHUD();
    if (shared.pane) shared.rerender();
  }
  U.reloadWorld = reloadWorld;
})(window.CW);
