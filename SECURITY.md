# Security

CodeQuest opens repositories you may not have written and lets an AI agent read them.
So the rule is: **the repository being played is untrusted input.**

## What CodeQuest promises

| Risk | What stops it |
|---|---|
| A repo picks a command to run on your machine | `agent`, `model` and `testCommand` are read only from your flags or `~/.config/codequest/config.json`. The same keys inside the repo are ignored, and `play` says so. |
| A repo's own agent settings (hooks, MCP servers) run | The agent is started with `--setting-sources user`. |
| Text in the code tells the AI to do something else (prompt injection) | Search / Ask / Challenge / Simulate get read-only tools scoped to the repo. No shell, no network, no sub-agents. Every prompt marks repo content as data. |
| The AI edits your working files | Real runs and tasks happen in a separate git worktree on a `codequest/task-*` branch. Nothing is pushed. Edit tools are scoped to that worktree. |
| A map points at files outside the repo | Paths must be repo-relative; reads resolve symlinks and are refused outside the repo root. |
| A map smuggles options into git | Commit ids are used only if they are plain hex SHAs. |
| Another site or program calls the local server | Bound to 127.0.0.1, Host header checked, every API call needs a 24-byte one-time key that travels in the URL fragment and is never put in the page. |
| A snapshot runs injected script | Map data is embedded as escaped JSON; the game renders text, never HTML from the map. No third-party scripts, fonts or trackers. |

Each row has a test in `test/security.test.mjs`.

## What it does not protect against

- **Running tests runs the repo's code.** "Run it for real" executes the test command you
  set, or a standard one it detected (`npm test`, `pytest`, `go test`, `cargo test`). The game shows
  the exact command and asks first. Do not run tests of a repo you do not trust; use `--no-tests`.
- **Snapshots contain code.** An exported HTML file holds the snippets of every mapped building.
- **The Codex adapter is experimental** and relies on Codex's own sandbox modes rather than per-tool rules.
- Whatever your agent CLI sends to its provider is governed by that provider, not by CodeQuest.

## Reporting a problem

Please do not open a public issue for a vulnerability. Use GitHub's
**Security → Report a vulnerability** on this repository. You will get an answer within a week.
