# The island's plan

## Intent and why

The island shows what an agent is doing right now: its orb, its last words,
how long it has been going. It cannot show the plan: which step of a five step
job the agent is on, and how much of it is behind it. That is the part a
person glancing at the screen edge actually wants.

The plan has to arrive without the user doing anything beyond asking the agent
for the work.

## Goals

- The closed bar shows the steps around the one in hand, in order: the step
  before, the step being worked on, the step after, each a number and a dot
  coloured by its state.
- The open island shows every agent's plan beside its orb and its last words.
- The island learns the plan from the agent itself, so it cannot drift from
  what the agent is doing.

## Non-goals

- No plan file per prompt, and no markdown to parse.
- No editing of the plan from the island.
- No history of past plans.
- No change to the orb or the streamed words: the island already draws both.

## Constraints

- The island renders in its own Electron window with no access to the plugin
  SDK. Only `IslandMessage` crosses that boundary, as JSON.
- The plugin runs in the desktop app's main process, where Node is available.
- The closed bar is 36px wide and reads downwards, so everything in it is
  written sideways.

## Approaches

**1. A rule and a plan file.** The plugin appends a marked block to the global
`AGENTS.md` once. Every prompt then writes a plan file into the project, with
bold step titles and a state on each. The plugin watches the project folder
and parses the file.

**2. The agent's own todo list.** The `todowrite` tool's arguments ride the
event stream: `session.tool.called` carries the tool's input, which for that
tool is `{ todos: [{ content, status, priority }] }`, with the statuses
`pending`, `in_progress`, `completed` and `cancelled`. The plugin reads that
and turns it into the island's steps.

**3. Both.** The file as the record, the todo list as the live source.

**Chosen: 2.**

The todo list is already a plan, already structured, already per session, and
it arrives the moment the agent writes it. A file would have to be parsed out
of markdown that a model writes in slightly different words each time, and two
agents working in one project would overwrite each other's file, so the
per agent progress the open island is supposed to show could not be right.

The cost of choosing 2 is that a plan only exists when the agent keeps a todo
list. That is what the rule is for, and the rule becomes much smaller: it
does not have to make the agent write a file, only keep its todos current
while it works.

## The change

### `src/state.ts`

```ts
export type PlanState = "waiting" | "working" | "done" | "failed"

export interface PlanStep {
  /** The step's number, one based. */
  n: number
  title: string
  state: PlanState
}
```

`SessionView` gains `plan?: PlanStep[]`. The states are the island's own
words, not the tool's: `completed` becomes `done`, `in_progress` becomes
`working`, `pending` becomes `waiting`, `cancelled` becomes `failed`.

### `src/model.ts`

- Watch `session.tool.called` alongside the events already watched.
- `parseTodos(input)` reads `{ todos }` out of a tool call and returns the
  steps. It is the one piece of parsing in the change, so it is exported and
  tested.
- When the session's execution fails, the step that was in hand becomes
  `failed`: that is the red dot.

### `src/rules.ts`

`installPlanRule()` finds the global `AGENTS.md` the way OpenCode does
(`$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`; `%APPDATA%\opencode`
on Windows), reads it, and appends a marked block when the marker is not
already there. It never rewrites what is already in the file, so running it
on every start is the first time behaviour with nothing to undo.

The block says: keep a todo list current with the `todowrite` tool while you
work, one todo per step, `in_progress` on the step you are on, `completed`
when it is done, and never left `pending` once you have moved past it.

### The island

A `StepMark` draws one step: the number, and a dot. The dot is green for
`done`, orange and pulsing for `working`, yellow for `waiting`, red for
`failed`. A pulsing ring, not a blinking dot, so it reads as alive without
flashing.

The closed bar shows the window around the step in hand: the step before it,
the step itself, the step after, in that order, so the numbers read 2, 3, 4.
When nothing is in hand, the window starts at the first step that is not
done. The steps are laid out the way the bar lays out everything else,
downwards.

The open island shows the whole plan of every agent on its row, as the same
marks with a count of how many are done.

## Risks

- An agent that keeps no todo list shows no plan. The rule is the mitigation,
  and it is a nudge, not a guarantee: the island degrades to what it shows
  today.
- The rule changes how every agent on this machine works, not just the ones
  in this project. That is the point of a global rule, and it is one marked
  block that can be deleted.
- `session.tool.called` carries the input of every tool call, not only the
  todo writes. That is more traffic than the island used to take, on the
  app's own socket, next to the text deltas it already receives.

## Out of scope, on purpose

- The island does not write the plan. The agent does, and only the agent knows
  what the steps are.
- The plan is not persisted across restarts of OpenCode: it is the agent's
  current work, and a stale plan from yesterday would be worse than none.
