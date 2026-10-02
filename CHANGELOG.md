# Changelog

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
