/* CodeQuest — small helpers shared by every game module: seeded random, geometry, DOM building,
   safe markdown, local storage. Classic script: exposes window.CW. Loads first.
   Must not know anything about the game: no CW.game, no world data, no UI state. */
window.CW = window.CW || {};
(function (CW) {
  'use strict';

  // Seeded RNG so every map of the same repo looks the same each time.
  CW.hash = function (str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  CW.rng = function (seed) {
    let s = typeof seed === 'string' ? CW.hash(seed) : seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  CW.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  CW.lerp = (a, b, t) => a + (b - a) * t;
  CW.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  CW.ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // Point on a quadratic curve between a and b, bowed sideways by `bend`.
  CW.curveCtrl = function (a, b, bend) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: mx - (dy / len) * bend, y: my + (dx / len) * bend };
  };
  // Point at t (0..1) on the quadratic curve from a to b with control point c.
  CW.qpoint = function (a, c, b, t) {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  };

  CW.pointInPoly = function (p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };

  // DOM
  CW.$ = (sel, root) => (root || document).querySelector(sel);
  CW.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  // Build a DOM node. attrs: `class`, `text`, `html`, `on<event>` handlers, anything else is an attribute.
  CW.el = function (tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
    return n;
  };
  CW.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Tiny, safe markdown: bullets, `code`, **bold**, paragraphs.
  CW.md = function (src) {
    const lines = String(src || '').split('\n');
    let html = '', inList = false, inCode = false, code = [];
    const inline = (t) => CW.esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    for (const raw of lines) {
      if (raw.trim().startsWith('```')) {
        if (inCode) { html += `<pre class="md-code">${CW.esc(code.join('\n'))}</pre>`; code = []; }
        inCode = !inCode;
        continue;
      }
      if (inCode) { code.push(raw); continue; }
      const m = raw.match(/^\s*[-*]\s+(.*)/);
      if (m) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline(m[1])}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (raw.trim()) html += `<p>${inline(raw)}</p>`;
      }
    }
    if (inList) html += '</ul>';
    if (inCode) html += `<pre class="md-code">${CW.esc(code.join('\n'))}</pre>`;
    return html;
  };

  CW.store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable: keep in memory */ }
    },
  };

  CW.shortSha = (s) => (s ? String(s).slice(0, 7) : '—');
  CW.uid = () => Math.random().toString(36).slice(2, 9);
  CW.timeAgo = function (iso) {
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return '';
    if (d < 60) return 'just now';
    if (d < 3600) return Math.round(d / 60) + ' min ago';
    if (d < 86400) return Math.round(d / 3600) + ' h ago';
    return Math.round(d / 86400) + ' days ago';
  };
})(window.CW);
