---
name: codequest-play
description: Start the CodeQuest game for the current repository in the browser: explore the code as worlds, solve missions, ask, challenge and simulate with the agent. Use when the user asks to play or explore the codebase as a game.
compatibility: Requires Node.js 18+ and git. Works in Claude Code as a plugin and in any agent that reads Agent Skills.
---

# Play CodeQuest

1. If `.codequest/worlds/` is missing there is no map yet: tell the user and follow the
   `codequest-map` skill first (ask before mapping a very large repo).
2. Check the map against the code and show the result:
   ```
   codequest status --fetch
   ```
   Say which worlds are stale (they show fog in the game and can be re-mapped from the sync chip).
3. If a CodeQuest game from an earlier run is still listening on the port, stop it first (it may be an
   older version of the game): find it with `lsof -ti tcp:4477` and stop that process, then start fresh.
   Start the server **in the background** (it keeps running):
   ```
   codequest play "$PWD" --port 4477
   ```
   A port in the user's request ("$ARGUMENTS") replaces 4477; if the port is busy use `--port 0`.
   It opens the browser and prints `CodeQuest <version> is running:` and a link that ends in `#t=<key>`.
   Tell the user the version.
4. Give the user **the full link, including the `#t=` part** — the game refuses to talk to the
   server without that key — and the controls in one short paragraph: world 1 is open and the
   rest unlock in order; press Start on the mission board, carry the case and pick the right road
   at every fork (walk into a signpost or press its number). If they are hunting one bug, tell them
   to press / and describe what goes wrong in their own words: the agent finds the logic and it jumps straight there, even into a locked world, with the
   lab open; arrows/WASD or click to move, E to
   land/look; Q quests, N notes & tasks.

## What the game is allowed to do

- Ask, Challenge, Inject a case and Change a flow run the user's agent CLI headless with
  **read-only tools limited to this repo**: no shell, no network.
- "Run it for real" and "Send to agent" edit a throwaway git worktree on a new branch
  `codequest/task-*`, never the user's working files, and never push.
- Tests for real runs come from **the user**, never from the repo being played:
  `codequest play --test "npm test"`, or `repos["<abs path>"].testCommand` in
  `~/.config/codequest/config.json`. Without one, real runs skip tests. A `testCommand` or `agent`
  inside the repo's own `.codequest/config.json` is ignored on purpose — say so if the user asks why.
- Agent: `--agent claude` (default) or `--agent codex` (experimental), `--model <name>`.
- Progress is saved in `.codequest/progress/<player>.json` (git-ignored).

## The CodeQuest CLI

Every command below is written as `codequest <command>`. Run it with the first of these that works:

1. Claude Code plugin: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codequest.mjs" <command>`
2. Whole repo installed next to this skill: `node <this skill's folder>/../../scripts/codequest.mjs <command>`
3. Anywhere else (Codex, other agents): `npx -y github:danielaranias/codequest <command>`

It needs Node.js 18+ and git, and has no other dependencies.
