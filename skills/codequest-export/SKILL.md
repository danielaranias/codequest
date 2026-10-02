---
name: codequest-export
description: Export the current CodeQuest map as one self-contained HTML file that anyone can open (no server, a read-only snapshot). Use when the user wants to share the game of this codebase.
compatibility: Requires Node.js 18+ and git. Works in Claude Code as a plugin and in any agent that reads Agent Skills.
---

# Export a shareable snapshot

Run:
```
codequest export "$PWD" --out .codequest/codequest.html
```
(If the user gave an output path — arguments: "$ARGUMENTS" — use it for `--out`.)

Then tell the user where the file is and what a snapshot can and cannot do:
- It contains the map **and the code snippets** of every mapped building — warn before sharing a private repo's snapshot outside the team.
- Exploring, flows, cases, quests, cracks, notes all work offline.
- No live sync, and no AI unless it is opened as a claude.ai artifact (then Ask / Challenge / Inject use the viewer's Claude).

## The CodeQuest CLI

Every command below is written as `codequest <command>`. Run it with the first of these that works:

1. Claude Code plugin: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codequest.mjs" <command>`
2. Whole repo installed next to this skill: `node <this skill's folder>/../../scripts/codequest.mjs <command>`
3. Anywhere else (Codex, other agents): `npx -y github:danielaranias/codequest <command>`

It needs Node.js 18+ and git, and has no other dependencies.
