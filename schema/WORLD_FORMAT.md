# CodeQuest world format (schemaVersion 1)

`world.json` is the map of a codebase. It lives at `<repo>/.codequest/world.json`.
The mapper (an AI agent following `skills/codequest-map/SKILL.md`) writes it; the game reads it.
Everything is **plain words for a human who has never seen this code**, but every
claim is pinned to real lines of code.

## Three rules that make it a game (read these first)

1. **Worlds follow the real journey.** Order the worlds the way a request, a user or the data
   really moves through the product — first thing that happens first. The player unlocks them
   one by one in that order. Cross-cutting plumbing (queues, tool dispatch, billing) goes inside
   the world where it is first needed, not in a world of its own, unless it is a real stage.
2. **Real names only.** A world, district, building or flow is named with the words the team
   already uses: the stage id, the screen name, the gate label, the function or file name.
   `Clarify`, `Lock protocol`, `ClarifyScreen`, `lockProtocol()`. Never an invented metaphor
   ("The Protocol Keep", "Drafting yard"). Names are short (≤ 28 characters).
3. **Every case is a mission the player must solve.** The player is shown the case `input` and,
   at every fork, must choose the road the code really takes. So:
   - the `input` must hold every fact needed to decide every fork on its path;
   - `when` texts at one step are concrete and mutually exclusive ("the row has no validator" /
     "every row has a validator"), never "on success" / "otherwise";
   - a case `name` and a step `action` must **not give away the answer**. Name the situation
     ("A free user taps Apply"), not the result ("Free user is blocked"). An action says what the
     step looks at ("Checks whether the user has paid"), not what it finds;
   - every case path passes **at least two forks** (steps with 2+ `next` edges). A flow with no
     forks is not a mission — merge it into a flow that has some.

## Top level

```jsonc
{
  "schemaVersion": 1,
  "repo": {
    "name": "my-app",
    "url": "https://github.com/owner/repo",   // optional
    "branch": "main",
    "commit": "<full git sha the map was made from>",
    "mappedAt": "2026-10-01T18:00:00Z"
  },
  "summary": "2-4 sentences: what this codebase is and how it is organised.",
  "worlds": [ /* World */ ],
  "bridges": [ /* Bridge */ ],
  "uncharted": [ "paths/not/covered/by/any/world" ]   // optional, honest gaps
}
```

## World — one big logical section (a page, a service, a pipeline)

```jsonc
{
  "id": "filters",                       // kebab-case, unique
  "name": "Filters Page",
  "theme": "meadow",                     // meadow|desert|tundra|volcano|ocean|forest|city|crystal
  "tagline": "Where playlists get sliced by mood, tempo and year",
  "summary": "2-4 sentences: what this part does and why it exists.",
  "paths": ["src/filters/", "api/filter.ts"],   // files/dirs that belong here (used for sync)
  "districts": [ { "id": "ui", "name": "UI" }, { "id": "core", "name": "Core logic" } ],
  "entities": [ /* Entity */ ],
  "flows":    [ /* Flow */ ],
  "quests":   [ /* Quest */ ],
  "cracks":   [ /* Crack */ ]
}
```

Order `districts` the way data travels (input → processing → output). The game lays
them out left → right. District names are plain: "Screen", "Server", "Agent", "Checks", "Records".

`meta.json` → `worldOrder` is the journey order (rule 1). World 1 is open; each next world
unlocks when the player has beaten at least one mission in every flow of the world before it.

## Entity — a thing that lives in the world

| kind        | what it is                                         | in the game       |
|-------------|----------------------------------------------------|-------------------|
| `entry`     | where things start: route, page, CLI, event, cron  | portal            |
| `ui`        | screen/component the user touches                  | storefront        |
| `module`    | logic: service, function group, class              | workshop          |
| `agent`     | LLM agent / autonomous actor                       | NPC character     |
| `skill`     | tool, skill or capability an agent can use         | shrine            |
| `guardrail` | validation, auth, limits, safety checks, allowlists| gate tower        |
| `store`     | DB, file, cache, state, knowledge base             | vault             |
| `external`  | third-party API / service                          | sky portal        |
| `config`    | prompts, settings, env, constants                  | library           |

```jsonc
{
  "id": "mood-filter",                   // kebab-case, unique within the world
  "kind": "module",
  "name": "Mood filter",
  "district": "core",
  "summary": "1-2 plain sentences.",
  "details": "- bullet\n- bullet (2-6 short lines: how it works, key decisions)",
  "source": [ /* SourceRef, 1-3 of them */ ],

  // only for kind=guardrail
  "guard": { "rule": "Only allowlisted shell commands may run",
             "checks": "command name in ALLOWED_COMMANDS",
             "onFail": "Command is blocked and the agent gets an error message" },

  // only for kind=agent
  "agent": { "role": "Writes code feature by feature", "model": "claude-...",
             "tools": ["bash-tool", "edit-tool"],   // entity ids of skills
             "prompt": "coding-prompt" }            // entity id of a config, or null
}
```

## SourceRef — the pin into real code

```jsonc
{
  "file": "src/filters/mood.ts",         // path from repo root
  "lines": [12, 48],                     // inclusive
  "anchor": "export function applyMood(" // an exact, distinctive line (or part of one) inside the range
}
```

`anchor` is how sync works: if the file changed but the anchor is still there the entity
is **drifted** (small change); if the anchor is gone it is **stale** (fog of war); if the
file is gone it is **lost**. Tooling adds `snippet` (the code text) and `hash` itself.

## Flow — something that moves through the world

A flow is a small state machine. A *packet* travels from step to step; the game animates it.

```jsonc
{
  "id": "apply-filter",
  "name": "User applies a filter",
  "trigger": "User taps 'Apply' on the filters screen",
  "summary": "1-2 sentences.",
  "start": "s1",
  "steps": [
    { "id": "s1", "at": "filters-screen",      // entity id where this happens
      "action": "Collects chosen moods and year range",
      "carries": "{ moods: ['chill'], years: [2010, 2020] }",
      "source": { /* optional SourceRef */ },
      "next": [ { "to": "s2", "when": "always" } ] },
    { "id": "s2", "at": "premium-check",
      "action": "Checks the user bought the app",
      "next": [ { "to": "s3", "when": "user is premium" },
                { "to": "outcome:paywall", "when": "user is not premium" } ] }
  ],
  "outcomes": [ { "id": "done", "label": "Filtered playlist shown", "kind": "success" },
                { "id": "paywall", "label": "Paywall shown", "kind": "blocked" } ],
  "cases": [
    { "id": "c1", "name": "Free user tries to filter",
      "input": "free user, moods=['chill']",
      "path": ["s1", "s2"],                  // step ids visited, in order
      "outcome": "paywall",
      "explain": "premium-check fails, so the packet bounces at the gate." }
  ]
}
```

Rules: every `at` is an entity id in the same world; every `next.to` is a step id or
`outcome:<id>`; every case `path` follows real `next` edges from `start`. Give each flow
2-4 cases that take **different** paths, including at least one blocked/error path when one exists.
Loops are allowed (a step may point back); list the loop once in a case path.

## Screens — what the user sees while the logic runs

The game shows a small device frame next to the map. It answers: *while the code is at this
step, what is on the user's screen, and what just changed?* Screens are **wireframes built from
the real UI code** — real labels, real button text, real error copy — not pictures.

Put a `screen` on a flow **step** when the user-visible state changes there, and on every
**outcome** (what the user ends up looking at). Steps with no `screen` are shown as
"nothing changes on screen" over the last one, so server-only steps need nothing.

```jsonc
"screen": {
  "name": "FiltersScreen",            // the real component / page / command
  "kind": "phone",                    // phone | browser | terminal | none (no UI at all: API, cron)
  "blocks": [
    { "t": "title",   "text": "Filters" },
    { "t": "chips",   "items": ["Chill", "2010–2020"] },
    { "t": "button",  "text": "Apply", "state": "loading" },
    { "t": "banner",  "text": "Unlock filters for $4", "state": "error" }
  ],
  "note": "Apply turns into a spinner; nothing else moves."   // one plain sentence: what changed
}
```

Block types `t`: `title`, `text`, `input` (text = value or placeholder), `button`, `banner`,
`spinner`, `list` (items), `chips` (items), `card` (text + optional items), `toggle`, `tabs` (items),
`console` (items = lines; for CLIs and logs), `divider`.
`state` (optional): `disabled`, `loading`, `active`, `error`, `ok`, `muted`.
Keep a screen to 3–8 blocks: the parts that matter for this flow, top to bottom as on the real screen.
Take every string from the UI code. Where the real text is user data, write a short stand-in in
angle brackets: `<the request text>`.

## Short mission text

Each case also carries a version a player can read at a glance:

```jsonc
"brief": "A free user taps Apply with two filters picked.",      // one plain sentence, ≤ 110 chars
"facts": ["free user", "2 filters picked", "online"]             // 2–4 chips, ≤ 28 chars each:
                                                                 // every fact a fork on the path needs
```
`input` stays as the full technical statement; `brief` + `facts` are what the game shows first.

The player reads a fork in a few seconds, so keep it short: a step `action` is 80 characters or
fewer, and each `when` at a fork is 70 or fewer, one plain condition that can be checked against a
fact chip ("no builds left today", not "when the last allowance answer said no builds left today or
this month"). Put the detail in the code reference, not in the sentence. `build` warns on longer text.

## Quest — how the player proves understanding

```jsonc
{ "id": "q1", "type": "quiz", "title": "Who guards the gate?",
  "prompt": "What happens when a free user taps Apply?",
  "options": ["Filter runs", "Paywall shown", "App crashes", "Nothing"],
  "answer": 1, "explain": "premium-check sends free users to outcome:paywall.", "xp": 20 }
```

Types: `visit` (target = entity id, no options), `trace` (target = flow id: watch it end to end),
`quiz` (options + answer), `predict` (target = "flowId/caseId", options = outcome labels, answer index).
4-8 quests per world, mostly quiz/predict, questions that need real understanding.

## Crack — a real weakness hidden in the world (bug-hunt)

```jsonc
{ "id": "k1", "at": "premium-check", "severity": "medium",
  "title": "Premium flag trusted from the client",
  "hint": "Who decides if the user paid?",
  "finding": "isPremium is read from local storage, so it can be edited on device.",
  "suggestion": "Verify the purchase receipt on the server.",
  "decoys": ["The check runs twice", "The paywall text is too long"],
  "source": { /* SourceRef */ } }
```

Only list cracks you can point at in code. 1-4 per world. Decoys are plausible but wrong.

## Bridge — a road between worlds

```jsonc
{ "from": "filters", "to": "player", "label": "sends filtered tracks to playback", "kind": "calls" }
```
`kind`: `calls` | `shares` (shared data/store) | `imports` | `concept` (same pattern, no code link).
