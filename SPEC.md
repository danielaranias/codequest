# CodeQuest — how it works

**Goal:** a player explores a codebase as a game until they understand all of its logic —
and can challenge it, test "what if", and turn what they find into tasks.

## The pieces

```
your repo/.codequest/           the plugin (this repo)
  meta.json      ← mapper         skills/         AI reads the code → worlds/*.json
  worlds/*.json  ← mapper         scripts/        build · validate · status · play · export
  world.json     ← build          server/         local server: game + sync + agent bridge
  progress/      ← game           game/           the game (canvas, no build step)
  config.json    (player only)    schema/         the world format
```

1. **Map** (`/codequest:map`) — the coding agent reads the repo and writes one file per world.
   Subagents map worlds in parallel. `build` validates every id, edge and case path, then
   pins each claim to code: snippet + file hash + an *anchor* line.
2. **Play** (`/codequest:play`) — a local server on 127.0.0.1 with a per-run token serves the game
   and answers its AI calls by running the user's own agent CLI headless (`claude -p`, read-only tools scoped to the repo, no shell, no network; see SECURITY.md).
3. **Share** (`/codequest:export`) — one HTML file. On claude.ai it gets AI through the viewer's Claude;
   elsewhere it is explore-only.

## The world format (short)

World → districts (left to right in data order) → entities of 9 kinds
(entry, ui, module, **agent**, **skill**, **guardrail**, store, external, config) →
**flows** (a state machine of steps with `when` branches and outcomes) → **cases** (input + exact path) →
**quests** (visit, trace, quiz, predict) → **cracks** (real weaknesses + decoys).
Full spec: `schema/WORLD_FORMAT.md`.

## Staying in sync

On every load the server compares each pinned reference with the code on disk:

| status   | meaning                                   | in the game |
|----------|-------------------------------------------|-------------|
| synced   | file unchanged                            | normal      |
| drifted  | file changed, anchor line still there     | amber dot   |
| stale    | anchor gone (code rewritten)              | fog         |
| lost     | file deleted                              | ruins + fog |

It also reports commits since the map, uncommitted files, new commits on the remote
(`git fetch`, then a "Pull" button if the tree is clean), and new source files no world covers.
Stale worlds re-map with one click; the agent rewrites only those worlds. `build` re-pins
references whose code just moved (self-healing), so small edits never need the AI.

## Playing

- **One journey.** Worlds sit along one route in the order the real system runs. World 1 is open;
  the rest are hidden under cloud. Beat one mission in every flow of a world to open the next.
- **Missions: you carry the case.** Each mission is one real input. You walk it to the first
  building, then at every fork choose the road the code really takes — walk into a signpost,
  click it, or press its number. Right: you travel on and the next building is revealed.
  Wrong: you lose one of three hearts and the game tells you which condition that road needs.
  Stuck: "Read the code here" opens the real lines. The ending gives 1–3 stars.
- **Discovery.** Buildings are outlines until you reach them; roads appear between known buildings.
- **The guide.** One line at the top always says the next move ("Sail to Start", "Press Start",
  "Walk to App.tsx body()", "Which road does the code take?"), with a marker on the target and an
  arrow at the screen edge when it is out of view. Menus stay hidden until the first mission is won.
- **What the user sees.** A device frame beside the map shows the product's real screen at each
  step, as a wireframe built from the UI code, and marks what just changed. Steps that only run on
  the server dim the frame and say so. The ending shows the screen the user is left looking at.
- **A calm info panel.** Name, one line, and four tabs: About, Code (the lines that decide the
  current fork first), Ask, More.
- **The lab** opens per flow once you have beaten it: replay a case, **inject your own case**
  (the agent traces it through the real code, marked "AI simulation"), or **change the flow** —
  skip a step, switch a guardrail off, force a branch, or describe a change → AI simulation, or
  **run it for real** in a throwaway git worktree with the repo's tests.
- **Ask / Challenge** any building. A confirmed challenge becomes a task.
- **Notes → tasks → Send to agent:** works on a new branch `codequest/task-*` in its own worktree,
  then CodeQuest runs tests and commits. The user's files are never touched.
- **Free roam** (Badges panel) opens everything at once for people who only want the map.

## Score

Stars per mission (3 = no wrong turn), XP for missions, discoveries, quests, cracks, simulations, challenges and real runs.
Levels (Deckhand → Oracle), badges (Cartographer, Gatekeeper, Bug hunter, Saboteur, Referee…),
and **% understood** per world and overall = buildings reached + missions beaten + quests + cracks.
Progress is one JSON per player — ready for team leaderboards later.

## Honest limits

- AI simulation is reasoning, not execution. It can be wrong; it says its confidence.
- Real runs need a repo that builds and a test command (`--test`, or your `~/.config/codequest/config.json`).
- Map quality depends on the agent. `build` catches broken structure, not wrong explanations.
- Exported snapshots contain code snippets — treat them like the code.

## Next

Team mode (shared progress, leaderboards, notes as GitHub issues), runtime traces to replace
AI simulation where tests exist, Codex/Gemini CLI presets, VS Code "show me in the game" link.
