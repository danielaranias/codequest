---
name: codequest-sync
description: Check whether the CodeQuest map still matches the code and re-map only the worlds that changed. Use when the user asks if the game world is up to date, or after big code changes.
compatibility: Requires Node.js 18+ and git. Works in Claude Code as a plugin and in any agent that reads Agent Skills.
---

# Sync the map with the code

1. Run `codequest status --fetch` and show the result.
   - **in sync**: nothing to do.
   - **drifted**: files changed but key lines are still there — the map is probably fine; mention it.
   - **stale / lost**: key code was rewritten or deleted — these worlds need re-mapping.
   - **new code not in any world**: consider adding it to a world or a new world.
   - **commits on the remote**: suggest `git pull` first (do not pull without asking if there are uncommitted changes).
2. If anything is stale (or `$ARGUMENTS` names worlds), follow the `codequest-map` skill for **only those worlds**,
   keeping their ids, then run `codequest build` until it passes.
3. Report what changed in the map in a few lines. If the game is open, the user can reload the page
   (progress is kept).

## The CodeQuest CLI

Every command below is written as `codequest <command>`. Run it with the first of these that works:

1. Claude Code plugin: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codequest.mjs" <command>`
2. Whole repo installed next to this skill: `node <this skill's folder>/../../scripts/codequest.mjs <command>`
3. Anywhere else (Codex, other agents): `npx -y github:danielaranias/codequest <command>`

It needs Node.js 18+ and git, and has no other dependencies.
