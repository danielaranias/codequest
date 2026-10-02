/* CodeQuest — boot: pick a backend, load the world, start the engine, show the intro.
   Loads last. Must not hold game logic — it only calls the other modules in order. */
(function (CW) {
  'use strict';
  const G = CW.game;
  async function boot() {
    const bootEl = CW.$('#boot');
    try {
      CW.ui.init();
      G.backend = await CW.pickBackend();
      const data = await G.backend.getWorld();
      G.load(data);
      G.start(CW.$('#stage'));
      CW.ui.onScene();
      bootEl.remove();
      CW.ui.intro();
      if (G.sync) {
        const fog = Object.values(G.sync.worlds).filter((w) => w.status === 'stale' || w.status === 'lost').length;
        if (fog) CW.ui.toast(`${fog} world${fog > 1 ? 's' : ''} changed since mapping — click the sync chip`, 'err');
        // look for new commits on the remote in the background
        G.backend.refresh({ fetch: true }).then((s) => {
          G.sync = s; CW.ui.updateHUD();
          if (s.remote?.behind) {
            CW.ui.toast(`${s.remote.behind} new commit${s.remote.behind > 1 ? 's' : ''} on ${s.remote.upstream} — open the sync chip to pull`);
          }
        }).catch(() => {});
      }
      CW.watchForClaude((b) => {
        G.backend = b; CW.ui.onBackendChange();
        CW.ui.toast('Claude is here — ask, challenge and simulate are on');
      });
      window.__codequest = G; // handy for debugging and tests
    } catch (e) {
      bootEl.classList.add('err');
      bootEl.textContent = 'Could not load the world: ' + (e.message || e);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.CW);
