/* CodeQuest — juice: particles, floating text and tiny synth sounds.
   Purely cosmetic: must not change game state, and the game must work the same with sound off. */
(function (CW) {
  'use strict';
  const parts = [];
  CW.fx = {
    burst(x, y, color, n) {
      for (let i = 0; i < (n || 12); i++) {
        const a = Math.random() * 6.28, v = 60 + Math.random() * 190;
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90,
          life: 0.5 + Math.random() * 0.5, age: 0, color, r: 2 + Math.random() * 3.5 });
      }
    },
    text(x, y, text, color) { parts.push({ x, y, vx: 0, vy: -55, life: 1.3, age: 0, color: color || '#ffc857', text }); },
    tick(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (!p.text) p.vy += 420 * dt;
      }
    },
    draw(ctx) {
      for (const p of parts) {
        const k = 1 - p.age / p.life;
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.fillStyle = p.color;
        if (p.text) {
          ctx.font = '800 22px ui-rounded, system-ui'; ctx.textAlign = 'center';
          ctx.strokeStyle = 'rgba(13,34,48,0.85)'; ctx.lineWidth = 4; ctx.strokeText(p.text, p.x, p.y);
          ctx.fillText(p.text, p.x, p.y);
        } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k + 0.5, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    },
  };

  // ---- sound: a few oscillator notes, no assets ----
  let ac = null;
  const SOUNDS = {
    step: [[520, 0, 0.07, 'triangle', 0.05]],
    start: [[392, 0, 0.09, 'triangle', 0.06], [523, 0.09, 0.12, 'triangle', 0.06]],
    right: [[660, 0, 0.08, 'triangle', 0.07], [880, 0.08, 0.14, 'triangle', 0.07]],
    wrong: [[196, 0, 0.16, 'sawtooth', 0.06], [147, 0.12, 0.22, 'sawtooth', 0.06]],
    lose: [[220, 0, 0.18, 'sawtooth', 0.06], [185, 0.16, 0.18, 'sawtooth', 0.06], [147, 0.32, 0.34, 'sawtooth', 0.06]],
    win: [[523, 0, 0.1, 'triangle', 0.07], [659, 0.1, 0.1, 'triangle', 0.07], [784, 0.2, 0.22, 'triangle', 0.07]],
    win3: [
      [523, 0, 0.09, 'triangle', 0.07], [659, 0.09, 0.09, 'triangle', 0.07],
      [784, 0.18, 0.09, 'triangle', 0.07], [1047, 0.27, 0.32, 'triangle', 0.08]],
    unlock: [
      [392, 0, 0.12, 'square', 0.04], [523, 0.12, 0.12, 'square', 0.04],
      [659, 0.24, 0.12, 'square', 0.04], [784, 0.36, 0.4, 'square', 0.045]],
    xp: [[990, 0, 0.05, 'sine', 0.04]],
  };
  CW.soundOn = () => CW.store.get('codequest:sound', true) !== false;
  CW.setSound = (on) => CW.store.set('codequest:sound', !!on);
  CW.sfx = function (name) {
    if (!CW.soundOn()) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      for (const [freq, at, dur, type, vol] of SOUNDS[name] || []) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now + at);
        g.gain.exponentialRampToValueAtTime(vol, now + at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
        o.connect(g).connect(ac.destination);
        o.start(now + at); o.stop(now + at + dur + 0.03);
      }
    } catch { /* no audio: play silently */ }
  };
})(window.CW);
