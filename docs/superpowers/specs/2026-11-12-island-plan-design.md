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

**2. The agent's own todo list.** The `todowrite` tool carries a plan with
states (`pending`, `in_progress`, `completed`, `cancelled`).

**3. A tool of the plugin's own.** The plugin's server half registers a tool,
`island_plan`, that takes the steps. The rule tells the agent to call it.

**Chosen: 3.**

The todo list was the first choice and is the closest to what the agent
already does, but it cannot be used: `todowrite` sits behind the `todo`
feature flag, which is off in released builds, and the user's config does not
turn it on. A rule that asks for a tool the agent does not have is inert.

A plan file needs no flag and no tool, but it has to be parsed out of
markdown that a model writes in slightly different words each time, and two
agents working in one project overwrite each other's file, so the per agent
progress the open island is supposed to show could not be right.

The plugin's own tool has none of those faults: the steps arrive as data,
per session, the moment the agent writes them, and the tool is registered by
the plugin, so nothing on the user's machine has to be switched on. The cost
is one more piece of code, in the server half of the plugin, and a rule that
asks for the tool by name.

## The change

### `src/index.ts` (the server half)

The plugin registers a tool:

```ts
{
  name: "island_plan",
  input: { steps: [{ title: string, state: "waiting" | "working" | "done" | "failed" }] },
}
```

It records nothing: the call itself is the record, and the island reads it
off the event stream. The tool asks for no permission of its own, and the
default agent rules allow every tool that is not named, so it never prompts.

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
words, and the tool uses them as they are. A state the island does not know
becomes `waiting`, so a step is never lost.

### `src/model.ts`

- Watch `session.tool.called` alongside the events already watched.
- `parseSteps(input)` reads `{ steps }` out of a tool call and returns the
  steps. It is the one piece of parsing in the change, so it is exported and
  tested.
- The event carries no tool name, so the call is recognised by its shape: a
  list of steps, each with a title and a state. When the name is known, from
  the tool call the model already tracks, it has to be the island's tool.
- When the session's execution fails, the step that was in hand becomes
  `failed`: that is the red dot. A tool that failed does not, because the
  agent may recover from it. The red stays until the agent writes a new plan.
- When the run was interrupted, the user stopped it, so the step in hand goes
  back to waiting: it is not in hand any more, and it did not fail.
- The plan is not cleared between turns: it is the agent's current work, and
  the rule asks for a new plan on every prompt anyway.

### `src/rules.ts`

`installPlanRule()` finds the global `AGENTS.md` the way OpenCode does
(`$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`; `%APPDATA%\opencode`
on Windows), reads it, and appends a marked block when the marker is not
already there. It never rewrites what is already in the file, so running it
on every start is the first time behaviour with nothing to undo.

It runs in the server half's `setup()`, which is before any session reads the
global instructions, so a rule added today reaches the next session.

The block says: record the steps of the work with the `island_plan` tool, one
per step, with a title and a state, and call it again whenever a step
changes state.

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

- An agent that records no plan shows no plan. The rule is the mitigation,
  and it is a nudge, not a guarantee: the island degrades to what it shows
  today.
- The rule changes how every agent on this machine works, not just the ones
  in this project. That is the point of a global rule, and it is one marked
  block that can be deleted.
- `session.tool.called` carries the input of every tool call, not only the
  plan writes. That is more traffic than the island used to take, on the
  app's own socket, next to the text deltas it already receives.
- The plan tool is registered by the server half of the plugin, so a session
  on a server that does not load the plugin has no tool to call, and no plan.

## Out of scope, on purpose

- The island does not write the plan. The agent does, and only the agent knows
  what the steps are.
- The plan is not persisted across restarts of OpenCode: it is the agent's
  current work, and a stale plan from yesterday would be worse than none.
