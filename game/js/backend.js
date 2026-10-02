/* CodeQuest — where the game gets its world and its AI.
   live:     local CodeQuest server (inside the user's repo; AI = their own Claude Code / agent CLI)
   claude:   published as a claude.ai artifact (AI = the viewer's Claude via the sample capability)
   offline:  a static file with no AI (explore, cases, quests, cracks still work)
   Every backend has the same shape ({mode, can, getWorld, saveState, ...}); the UI checks `can.*`
   before offering a feature. Must not build UI or change game state. */
(function (CW) {
  'use strict';

  // ---------- prompt builders (used by the claude backend; the server has its own, with file access) ----------
  function flowText(f) {
    const lines = [`Flow "${f.name}" (id ${f.id}) — trigger: ${f.trigger}`, `start: ${f.start}`];
    for (const s of f.steps) {
      lines.push(`- ${s.id} @${s.at}: ${s.action}${s.carries ? ` [carries ${s.carries}]` : ''}`);
      for (const n of s.next || []) lines.push(`    → ${n.to}  when: ${n.when}`);
    }
    lines.push('outcomes: ' + f.outcomes.map((o) => `${o.id} (${o.kind}: ${o.label})`).join('; '));
    return lines.join('\n');
  }
  function refText(r) {
    if (!r || !r.snippet) return '';
    return `--- ${r.file}:${r.lines?.[0]}-${r.lines?.[1]}\n${r.snippet.slice(0, 2500)}`;
  }
  function entityText(en, withCode) {
    let t = `[${en.kind}] ${en.name} (id ${en.id}): ${en.summary}\n${en.details || ''}`;
    if (en.guard) t += `\nGuard rule: ${en.guard.rule}. Checks: ${en.guard.checks}. On fail: ${en.guard.onFail}`;
    if (en.agent) t += `\nAgent role: ${en.agent.role}. Tools: ${(en.agent.tools || []).join(', ')}`;
    if (withCode) t += '\n' + (en.source || []).map(refText).join('\n');
    return t;
  }
  function worldContext(W, w, focus) {
    const parts = [`Codebase: ${W.repo.name}. ${W.summary}`, `World "${w.name}": ${w.summary}`];
    const codeFor = new Set();
    if (focus.entity) codeFor.add(focus.entity.id);
    if (focus.flow) for (const s of focus.flow.steps) codeFor.add(s.at);
    parts.push('Entities:\n' + w.entities.map((en) => entityText(en, codeFor.has(en.id))).join('\n\n'));
    if (focus.flow) {
      parts.push(flowText(focus.flow));
      const stepCode = focus.flow.steps.filter((s) => s.source).map((s) => refText(s.source)).join('\n');
      if (stepCode) parts.push('Step code:\n' + stepCode);
    } else parts.push('Flows:\n' + w.flows.map((f) => `- ${f.name}: ${f.summary}`).join('\n'));
    let txt = parts.join('\n\n');
    if (txt.length > 120000) txt = txt.slice(0, 120000) + '\n[cut]';
    return txt;
  }
  CW.prompts = {
    worldContext, flowText,
    ask(W, w, focus, question) {
      return `You are the guide inside "CodeQuest", a game where a player explores a codebase as worlds.
Answer the player's question about the code below in plain, simple words, short (under 150 words unless they ask for more).
Point at exact files/lines when you can. If the answer is not in the code shown, say so — never invent.

${worldContext(W, w, focus)}

Player is looking at: ${focus.entity ? focus.entity.name : focus.flow ? focus.flow.name : w.name}
Question: ${question}`;
    },
    simulate(W, w, flow, input, change) {
      return `You are the simulation engine of "CodeQuest". Trace what the code would do, step by step, using ONLY the flow graph and code below.

${worldContext(W, w, { flow })}

Injected case (input): ${input || '(use the most typical input)'}
${change ? `Proposed change to the flow/code: ${change}\nApply this change in your head before tracing. If the change makes a step behave differently, follow the new behaviour.` : 'No code change.'}

Reply with ONLY a JSON object:
{"path": ["<step ids visited in order, starting at ${flow.start}, following the → edges>"],
 "outcome": "<one outcome id from the list, or new:<short label> if the change creates a new ending>",
 "outcomeKind": "success|blocked|error",
 "narration": ["<one short plain sentence per step in path: what happens to this input there>"],
 "confidence": "high|medium|low",
 "assumptions": "<one sentence: what you had to assume>",
 "risk": "<one sentence: anything this case or change breaks or exposes, or empty>"}`;
    },
    challenge(W, w, entity, claim) {
      return `You are the referee in "CodeQuest". The player challenges a part of the code with a claim. Judge it strictly against the code below.

${worldContext(W, w, { entity })}

Target: ${entity.name}
Player's claim: ${claim}

Reply with ONLY a JSON object:
{"verdict": "confirmed|partly|not-a-problem|cannot-tell",
 "explanation": "<2-3 plain sentences, citing file:line>",
 "suggestion": "<one sentence fix if confirmed/partly, else empty>",
 "taskTitle": "<short imperative task title if confirmed/partly, else empty>"}`;
    },
  };

  // ---------- backends ----------
  // Talks to the local CodeQuest server; every call carries this run's token.
  function LiveBackend(token) {
    const h = { 'content-type': 'application/json', 'x-codequest-token': token };
    const call = async (method, url, body) => {
      const r = await fetch(url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
      const j = await r.json().catch(() => ({ error: 'Bad response from the CodeQuest server' }));
      if (!r.ok || j.error) throw new Error(j.error || r.statusText);
      return j;
    };
    return {
      mode: 'live',
      can: { ask: true, simulate: true, challenge: true, run: true, dispatch: true, remap: true, fetch: true },
      label: 'Live — your code, your agent',
      getWorld: () => call('GET', '/api/world'),
      saveState: (state) => call('PUT', '/api/state', state).catch(() => {}),
      refresh: (opts) => call('POST', '/api/sync', opts || {}),
      pull: () => call('POST', '/api/pull'),
      ask: (ctx) => call('POST', '/api/ask', ctx).then((r) => r.text),
      simulate: (ctx) => call('POST', '/api/simulate', ctx),
      challenge: (ctx) => call('POST', '/api/challenge', ctx),
      run: (ctx) => call('POST', '/api/run', ctx),
      dispatch: (task) => call('POST', '/api/tasks/dispatch', task),
      remap: (worlds) => call('POST', '/api/remap', { worlds }),
      job: (id) => call('GET', '/api/jobs/' + encodeURIComponent(id)),
    };
  }

  // Snapshot on claude.ai: AI calls go to the viewer's Claude; progress is kept in local storage.
  function ClaudeBackend(sample, W) {
    const find = (wid) => W.worlds.find((x) => x.id === wid);
    const stateKey = 'codequest:' + W.repo.name + ':' + (W.repo.commit || '');
    return {
      mode: 'claude',
      can: { ask: true, simulate: true, challenge: true },
      label: 'Snapshot — AI answers from the mapped code',
      getWorld: async () => ({ world: W, sync: null, state: CW.store.get(stateKey, null) }),
      saveState: (state) => CW.store.set(stateKey, state),
      async ask({ worldId, entityId, flowId, question }, onText) {
        const w = find(worldId);
        const focus = { entity: w.entities.find((e) => e.id === entityId), flow: w.flows.find((f) => f.id === flowId) };
        const { text } = await sample(CW.prompts.ask(W, w, focus, question), {
          onText: onText ? ({ text }) => onText(text) : undefined,
          cache: false });
        return text;
      },
      async simulate({ worldId, flowId, input, change }) {
        const w = find(worldId);
        const flow = w.flows.find((f) => f.id === flowId);
        return sample.json(CW.prompts.simulate(W, w, flow, input, change), { modelTier: 'default' });
      },
      async challenge({ worldId, entityId, claim }) {
        const w = find(worldId);
        return sample.json(CW.prompts.challenge(W, w, w.entities.find((e) => e.id === entityId), claim));
      },
    };
  }

  // Plain snapshot file: no AI at all; progress is kept in local storage.
  function OfflineBackend(W) {
    const stateKey = 'codequest:' + W.repo.name + ':' + (W.repo.commit || '');
    return {
      mode: 'offline',
      can: {},
      label: 'Snapshot — explore only',
      getWorld: async () => ({ world: W, sync: null, state: CW.store.get(stateKey, null) }),
      saveState: (state) => CW.store.set(stateKey, state),
    };
  }

  // Live mode: the server puts inert JSON in the page; the key for this run arrives in the URL
  // fragment (never sent to any server, never stored in the page) and is kept for this tab only.
  function readLiveConfig() {
    const node = document.getElementById('cw-config');
    if (!node) return null;
    let cfg; try { cfg = JSON.parse(node.textContent); } catch { return null; }
    const m = /[#&]t=([0-9a-f]{16,128})/.exec(location.hash);
    let token = m ? m[1] : null;
    try {
      if (token) { sessionStorage.setItem('codequest:t', token); history.replaceState(null, '', location.pathname); }
      else token = sessionStorage.getItem('codequest:t');
    } catch { /* storage blocked: the key lives in memory for this page load */ }
    cfg.token = token;
    return cfg;
  }

  // Choose the backend at boot: live if the server configured the page, otherwise offline.
  CW.pickBackend = async function () {
    const cfg = (window.CODEQUEST_CONFIG = readLiveConfig() || window.CODEQUEST_CONFIG || {});
    if (cfg.mode === 'live' && !cfg.token) {
      throw new Error('This tab has no key for the running game. Open the full link CodeQuest printed in your terminal.');
    }
    if (cfg.mode === 'live') return LiveBackend(cfg.token);
    const W = window.CODEQUEST_WORLD;
    if (!W) throw new Error('No world loaded. Map your repo first (the codequest-map skill).');
    return OfflineBackend(W);
  };
  // Inside a claude.ai viewer the AI arrives a moment after load; upgrade then.
  CW.watchForClaude = function (onReady) {
    const W = window.CODEQUEST_WORLD;
    if (!W || !window.claude || typeof window.claude.use !== 'function') return;
    window.claude.use('sample').then((sample) => { if (sample) onReady(ClaudeBackend(sample, W)); }).catch(() => {});
  };
})(window.CW);
