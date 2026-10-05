/* CodeQuest — HUD: the top bar (crumbs, level, XP, mastery, sync chip), the "press E" hint,
   and what the UI does on a scene change or the Escape key.
   Must not change game state beyond what Escape closes. */
(function (CW) {
  'use strict';
  const G = CW.game;
  const { $, el, esc } = CW;
  const U = CW.ui, shared = U._;

  U.updateHUD = function () {
    if (!G.W) return;
    $('#crumb-repo').textContent = G.W.repo.name;
    const ver = window.CODEQUEST_CONFIG?.version || window.CODEQUEST_VERSION;
    if (ver) $('#crumb-repo').title = 'CodeQuest ' + ver;
    $('#crumb-world').textContent = G.scene === 'world' ? G.world().name : '';
    $('#btn-sail').hidden = G.scene !== 'world';
    const lvl = G.level();
    $('#lvl').textContent = `Lv ${lvl} ${G.title()} · ${G.state.xp} XP`;
    $('#xpbar').style.width = ((G.state.xp % 150) / 150) * 100 + '%';
    const m = G.scene === 'world' ? G.mastery(G.world()) : G.overallMastery();
    $('#mastery').innerHTML = `<b>${Math.round(m * 100)}%</b> understood`;
    $('#mastery').title = G.scene === 'world'
      ? 'How much of this world you have explored and proven'
      : 'How much of the whole codebase you have explored and proven';
    renderSyncChip();
    CW.guide.update();
  };

  // One line for the sync chip: the worst thing first (fog, then new commits, then small drift).
  function syncSummary() {
    if (!G.sync) return { cls: 'snapshot', text: 'Snapshot ' + CW.shortSha(G.W.repo.commit) };
    const ws = Object.values(G.sync.worlds);
    const fog = ws.filter((w) => w.status === 'stale' || w.status === 'lost').length;
    const drift = ws.filter((w) => w.status === 'drifted').length;
    const behind = G.sync.remote?.behind || 0;
    if (fog) return { cls: 'stale', text: `${fog} world${fog > 1 ? 's' : ''} out of date` };
    if (behind) return { cls: 'drifted', text: `${behind} new commit${behind > 1 ? 's' : ''} on ${G.sync.remote.upstream}` };
    if (drift) return { cls: 'drifted', text: 'In sync · small edits' };
    return { cls: 'synced', text: 'In sync with code' };
  }
  function renderSyncChip() {
    const s = syncSummary();
    const chip = $('#sync-chip');
    chip.innerHTML = '';
    chip.append(el('span', { class: 'dot ' + s.cls }), s.text);
  }

  // `near` is the island or building the player stands next to, or null to hide the hint.
  U.showHint = function (near) {
    const h = $('#hint');
    if (!near) { h.hidden = true; return; }
    h.hidden = false;
    if (G.scene === 'over' && !G.unlocked(near)) { h.innerHTML = `<kbd>E</kbd>Locked · ${esc(G.lockHint(near))}, or jump in`; return; }
    if (G.scene === 'world' && G.mission && G.mission.phase !== 'won' && G.mission.phase !== 'lost') { h.hidden = true; return; }
    h.innerHTML = `<kbd>E</kbd>${G.scene === 'over' ? 'Land on ' : 'Look at '}${esc(near.name)}`;
  };

  U.onScene = function () {
    U.updateHUD();
    shared.closeDrawer();
    shared.renderDock();
    document.body.classList.toggle('no-dock', G.scene !== 'world');
    document.body.classList.toggle('in-world', G.scene === 'world');
    if (G.scene === 'world') {
      const w = G.world();
      U.toast(w.tagline || w.name);
      $('#caption').hidden = true;
      const st = G.worldStatus(w.id);
      if (st === 'stale' || st === 'lost') U.toast('Fog here: the code changed since this world was mapped', 'err');
    }
  };

  // Escape closes one thing at a time, innermost first.
  U.escape = function () {
    if (!$('#modal').hidden) return shared.closeModal();
    if (shared.pane) return shared.closeDrawer();
    if (G.mission) return CW.mission.quit();
    if (G.packet) return G.stopPacket();
    if (G.lab) { G.lab = false; G.flowSel = null; return shared.renderDock(); }
    if (G.flowSel) { G.flowSel = null; shared.renderDock(); }
  };
})(window.CW);
