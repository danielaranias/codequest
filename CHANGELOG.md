# Changelog

## 1.3.0
- Focus while deciding: at a fork only the question and your facts stay on screen. The guide banner hides, the
  "what the user sees" panel folds, and a building's panel shows no second puzzle during a mission.
- Fork cards lead with the condition; at most four fact chips; the mapper writes shorter text and `build` warns on long text.

## 1.2.2
- Mapping reads like a voyage: a plan with a time estimate, one progress line per world, a clear "map is built" card.

## 1.2.1
- Mapping says up front how long it will take and reports each world as it lands.
- One copy-paste install line for Claude Code in the terminal.

## 1.2.0
- Search by meaning: describe a symptom in your own words and your own agent (Claude Code or Codex)
  points at the flows and buildings behind it, with a one-line reason for each. Word search stays instant and offline.

## 1.1.0
- Search and jump: press `/`, type any word from the logic, and go straight to that flow or building.
- Locked worlds can be opened on the spot ("Jump in"). The fog lifts and the lab opens; missions still count for stars.
- "Something is broken — find it" on the first screen.

## 1.0.0
- Renamed to CodeQuest (`.codequest/`, `codequest` CLI, `codequest-*` skills).
- Licence: MIT.
- 69 tests for the map, the server and the CLI, plus browser tests of the game. Windows in CI.
- Fixes found by those tests: saved notes with non-English text could be corrupted; a typo in
  `worldOrder` was silent; a malformed road crashed `validate`; a pin past the end of a file read as in sync.
- The 1,000-line UI file is split into ten small files; every game file says what it owns.

## 0.3.0
- Security: a played repo can no longer choose the agent or test command; agent runs ignore repo
  settings and get path-scoped, shell-less, network-less tools; file reads are confined to the repo;
  the server key moved to the URL fragment; snapshots embed data as escaped JSON; no third-party fonts.
- Install: Agent Skills layout (`skills/codequest-*`), `npx` CLI, `/codequest:map|play|sync|export`
  commands, `codequest format | doctor | version`. CLI moved from `bin/` to `scripts/`.
- Codex adapter (experimental): `--agent codex`.

## 0.2.0
- Missions, hearts and stars; worlds unlock in journey order; guide; "what the user sees" screens.

## 0.1.0
- First version: map, play, sync, export.
