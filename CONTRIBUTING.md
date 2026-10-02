# Contributing

Thanks for wanting to make CodeQuest better. It is small on purpose: you can read all of it in an evening.

## Get going

```
git clone https://github.com/danielaranias/codequest && cd codequest
npm test                                   # 69 tests, a few seconds, no install step
node scripts/codequest.mjs play test/fixture   # a two-world game to try changes on
```

Browser tests (optional): `npm i --no-save playwright@1 && npx playwright install chromium && npm run test:e2e`.

## Where things are

| Folder | What it is |
|---|---|
| `scripts/codequest.mjs` | The CLI: init, validate, build, status, play, export |
| `server/lib/world.mjs` | The map: assemble, validate, pin to code, sync report |
| `server/server.mjs` | Local server on 127.0.0.1: serves the game, bridges to the AI agent |
| `server/lib/agent.mjs`, `prompts.mjs` | Runs Claude Code or Codex headless, with locked-down tools |
| `game/js/` | The game. Plain JS on a canvas, one job per file, each file starts with what it owns |
| `skills/` | Agent Skills: how an AI agent maps, plays, syncs and exports |
| `schema/WORLD_FORMAT.md` | The map format |
| `test/` | Tests. `test/fixture` is a tiny repo with a map |

## Rules

- **Zero dependencies.** Node 18+ standard library on the server, plain JS in the browser, no build step.
- **The repo being played is untrusted.** Anything read from `.codequest/` or from source files is
  data: validate it, never execute it, never put it in a shell string. Read [SECURITY.md](SECURITY.md).
- **A fix comes with a test that would have gone red.** Test what reaches the player or the file
  on disk, not the function you just edited.
- **Game text is plain and short.** Real names from the code, no metaphors.
- Lines up to 140 characters. Bump `version` in `package.json` and `.claude-plugin/plugin.json`
  together and add a line to `CHANGELOG.md`.

## Good first things

- Map a public repo you know and share the snapshot in an issue: what did the mapper get wrong?
- New building art for an entity kind (`game/js/render.js`).
- A Codex or Cursor run-through: where do the skills trip?

## Licence of your contribution

CodeQuest is free to use and source-available; selling it needs a commercial licence
([COMMERCIAL.md](COMMERCIAL.md)). By opening a pull request you agree that your contribution is
licensed under the Apache License 2.0 **and** that the project owner may also offer it under
other terms, including commercial licences. If you cannot agree to that, please open an issue instead.
