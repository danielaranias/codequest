// Agent adapter: runs the user's own coding agent CLI headless.
// Default: Claude Code (`claude -p`). Also: OpenAI Codex (`codex exec`, experimental).
// The agent is chosen by the USER (CLI flag or ~/.config/codequest/config.json) — never by the
// repository being played, because a cloned repo must not be able to pick what runs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function defaultAgent() {
  return { kind: 'claude', command: 'claude' };
}

// Claude Code permission rule for "anything under this directory": Read(//abs/path/**)
const under = (dir) => '/' + path.resolve(dir).replace(/\\/g, '/') + '/**';
/** Read-only tools, confined to the given directories. */
export function readTools(...dirs) {
  return dirs.flatMap((d) => [`Read(${under(d)})`, `Grep(${under(d)})`, `Glob(${under(d)})`]);
}
/** Edit tools, confined to the given directory. */
export function editTools(dir) {
  return [`Edit(${under(dir)})`, `Write(${under(dir)})`, `MultiEdit(${under(dir)})`];
}
export const NO_NETWORK_NO_SHELL = ['Bash', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit'];

// Pull one JSON value out of a model reply (whole text, a ```json fence, or first {…last }).
export function parseJson(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new Error('The agent did not return readable JSON');
}

function describeTool(block) {
  const i = block.input || {};
  const what = i.file_path || i.path || i.pattern || i.command || i.query || '';
  return `${block.name}${what ? ' ' + String(what).slice(0, 140) : ''}`;
}

/**
 * Run the agent once.
 * @param {object} o
 * @param {string} o.prompt
 * @param {string} o.cwd
 * @param {object} o.agent       {kind, command, args?, model?}
 * @param {string[]} [o.tools]   allowed tools (Claude Code permission rules; build with readTools/editTools)
 * @param {string[]} [o.deny]    tools to refuse outright
 * @param {boolean} [o.write]    the job edits files (Codex: workspace-write sandbox)
 * @param {string} [o.permissionMode]  e.g. "acceptEdits"
 * @param {(line:string)=>void} [o.onLog]
 * @param {number} [o.timeoutMs]
 * @returns {Promise<{text:string, cost?:number}>}
 */
export function runAgent(o) {
  const agent = o.agent || defaultAgent();
  const timeoutMs = o.timeoutMs || 10 * 60 * 1000;
  let cmd, args;
  let lastMsgFile = null;
  if (agent.kind === 'claude') {
    cmd = agent.command || 'claude';
    // --setting-sources user: do NOT load the played repo's .claude/settings (hooks, MCP servers).
    args = ['-p', '--output-format', 'stream-json', '--verbose', '--setting-sources', 'user'];
    if (o.tools?.length) args.push('--allowedTools', o.tools.join(','));
    if (o.deny?.length) args.push('--disallowedTools', o.deny.join(','));
    args.push('--permission-mode', o.permissionMode || 'dontAsk');
    if (agent.model) args.push('--model', agent.model);
  } else if (agent.kind === 'codex') {
    // Experimental. Codex sandboxes by mode rather than by per-tool rules.
    cmd = agent.command || 'codex';
    lastMsgFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codequest-codex-')), 'last.txt');
    args = ['exec', '--sandbox', o.write ? 'workspace-write' : 'read-only', '--skip-git-repo-check', '-o', lastMsgFile];
    if (agent.model) args.push('-m', agent.model);
    args.push('-');
  } else {
    throw new Error(`Unknown agent "${agent.kind}". Use "claude" or "codex".`);
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, CODEQUEST: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(new Error(`Could not start "${cmd}": ${e.message}`));
    }
    let buf = '', out = '', err = '', finalText = null, cost;
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('The agent took too long and was stopped')); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `"${cmd}" is not installed or not on PATH` : e.message)); });
    child.stdout.on('data', (d) => {
      out += d;
      if (agent.kind !== 'claude') { o.onLog?.(String(d).trimEnd().slice(0, 400)); return; }
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'assistant') {
          for (const b of ev.message?.content || []) {
            if (b.type === 'tool_use') o.onLog?.('→ ' + describeTool(b));
            else if (b.type === 'text' && b.text.trim()) o.onLog?.(b.text.trim().split('\n')[0].slice(0, 200));
          }
        } else if (ev.type === 'result') {
          finalText = ev.result ?? '';
          cost = ev.total_cost_usd;
          if (ev.is_error) err += '\n' + (ev.result || ev.subtype || 'agent error');
        }
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = agent.kind === 'claude' ? finalText : out;
      if (lastMsgFile) { try { text = fs.readFileSync(lastMsgFile, 'utf8'); fs.rmSync(path.dirname(lastMsgFile), { recursive: true, force: true }); } catch {} }
      if (code !== 0 && !text) return reject(new Error(`Agent exited with ${code}: ${err.trim().slice(-400)}`));
      resolve({ text: text || '', cost });
    });
    child.stdin.end(o.prompt);
  });
}
