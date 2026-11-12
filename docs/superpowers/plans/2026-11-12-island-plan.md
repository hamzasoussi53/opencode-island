# The Island's Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The island shows the agent's plan: the steps around the one in hand on the closed bar, and every agent's whole plan on its row in the open island, with a coloured dot per step.

**Architecture:** The plan comes from a tool of the plugin's own, `island_plan`, registered by the server half of the plugin. The agent calls it with the steps; the call rides the event stream as `session.tool.called`, and the model turns its input into `PlanStep[]` on `SessionView`. The plugin appends one marked block to the global `AGENTS.md` so agents call that tool. The pure plan logic lives in `src/plan.ts`, shared by the island window and the test harness, the way `src/orb.ts` already is.

**Tech Stack:** Electron 45 (the OpenCode desktop app's own runtime), TypeScript, React 19, Tailwind v4, Vite. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-12-island-plan-design.md`

## Global Constraints

- The plan is read from the island's own tool. No plan file is written, read or parsed, and nothing is created on disk inside a user's project.
- The user's `opencode.json` is never touched. The plan tool needs no feature flag: `todowrite` is behind one that is off in released builds, so the plugin brings its own.
- The rule goes into the global `AGENTS.md` only, inside one marked block, and the plugin never rewrites what is already in that file.
- The island's existing behaviour is unchanged when there is no plan: the bar, the orbs, the words, the buttons and the drawer all work exactly as they do now.
- The island window still has no access to the plugin SDK: only `IslandMessage` crosses, as JSON.
- The bar is 36px wide and reads downwards; everything in it is written sideways.
- No new runtime dependency, and no change to `package-lock.json`.
- Copy in the island is sentence case, no em dashes, no exclamation marks.

## Review Focus

Five conditions the spec implies that no automated test covers, most likely to bite first:

1. **An agent that records no plan.** The island must show what it shows today: no plan, no gaps, no errors. A missing plan is the common case, not a broken one.
2. **A step the island does not recognise.** The step must still appear, as waiting. Steps must never vanish from the plan because of an unexpected value.
3. **A session that fails on the step in hand.** That step goes red; every other step keeps its state. A run the user interrupted, or a tool that failed and was recovered from, must not go red.
4. **A plan of more than three steps.** The bar shows three of them, in order, and the window slides as the agent advances.
5. **A global `AGENTS.md` that already has content, or already has the rule.** The plugin must not clobber the file and must not add the rule twice.

---

### Task 1: The plan's shared logic

**Files:**
- Create: `src/plan.ts`
- Modify: `src/state.ts` (the plan's types)
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PlanState` and `PlanStep` in `src/state.ts`; `SessionView.plan?: PlanStep[]`; `src/plan.ts` exporting `PLAN_TOOL` (the string `"island_plan"`), `planInput` (the tool's JSON schema), `parseSteps(input: unknown): PlanStep[]`, `failPlan(plan: PlanStep[] | undefined): PlanStep[] | undefined` and `planWindow(plan: PlanStep[]): PlanStep[]`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/check.ts`, with `parseSteps`, `failPlan` and `planWindow` imported from `../src/plan.ts`, and `PlanState` imported as a type only:

```ts
import type { PlanState } from "../src/state.ts"

// The steps come out of the island's own tool, and only out of that.
assert.deepEqual(parseSteps({ steps: [{ title: "Read it", state: "waiting" }] }), [
  { n: 1, title: "Read it", state: "waiting" },
])
assert.deepEqual(
  parseSteps({
    steps: [
      { title: "Read it", state: "done" },
      { title: "Write it", state: "working" },
      { title: "Ship it", state: "waiting" },
    ],
  }),
  [
    { n: 1, title: "Read it", state: "done" },
    { n: 2, title: "Write it", state: "working" },
    { n: 3, title: "Ship it", state: "waiting" },
  ],
)

// A step is never lost, whatever the tool says.
assert.deepEqual(parseSteps({ steps: [{ title: "Odd", state: "something-new" }] }), [
  { n: 1, title: "Odd", state: "waiting" },
])
assert.deepEqual(parseSteps(undefined), [])
assert.deepEqual(parseSteps({ steps: "not a list" }), [])
assert.deepEqual(parseSteps({}), [])
assert.deepEqual(parseSteps({ steps: [{ title: 42, state: "done" }] }), [
  { n: 1, title: "", state: "done" },
])

// The step in hand is the one that failed.
assert.deepEqual(
  failPlan([
    { n: 1, title: "Read it", state: "done" },
    { n: 2, title: "Write it", state: "working" },
    { n: 3, title: "Ship it", state: "waiting" },
  ]),
  [
    { n: 1, title: "Read it", state: "done" },
    { n: 2, title: "Write it", state: "failed" },
    { n: 3, title: "Ship it", state: "waiting" },
  ],
)
assert.deepEqual(failPlan(undefined), undefined)
assert.deepEqual(failPlan([]), [])

// The bar shows the steps around the one in hand, in order.
const steps = (...states: PlanState[]) =>
  states.map((state, index) => ({ n: index + 1, title: `Step ${index + 1}`, state }))
assert.deepEqual(
  planWindow(steps("done", "done", "working", "waiting", "waiting")).map((step) => step.n),
  [2, 3, 4],
)
assert.deepEqual(planWindow(steps("done", "done")).map((step) => step.n), [1, 2])
assert.deepEqual(planWindow(steps("done", "done", "done", "waiting")).map((step) => step.n), [4])
assert.deepEqual(planWindow([]), [])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the module `../src/plan.ts` does not exist.

- [ ] **Step 3: Add the plan's types to `src/state.ts`**

```ts
/** Where a step of the plan stands. */
export type PlanState = "waiting" | "working" | "done" | "failed"

export interface PlanStep {
  /** The step's number, one based, as the agent numbered it. */
  n: number
  /** What the step is, in the agent's words. */
  title: string
  state: PlanState
}
```

Add to `SessionView`, after `stream`:

```ts
  /** The agent's plan, when it records one. */
  plan?: PlanStep[]
```

- [ ] **Step 4: Create `src/plan.ts`**

```ts
import type { PlanStep } from "./state"

/** The tool the agent records its plan with. */
export const PLAN_TOOL = "island_plan"

/** How many steps the closed bar shows at once. */
export const PLAN_WINDOW = 3

/** The states a step can be in, and what an unknown one becomes. */
const STATES = new Set(["waiting", "working", "done", "failed"])

/** The tool's input: the steps, each with a title and a state. */
export const planInput = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          state: { type: "string", enum: ["waiting", "working", "done", "failed"] },
        },
        required: ["title", "state"],
      },
    },
  },
  required: ["steps"],
}

/**
 * The steps of the plan, out of a call to the island's tool. Anything that
 * is not a list of steps gives no plan at all, and a step is never lost: one
 * the agent words in a way the island does not know is a step that waits.
 */
export function parseSteps(input: unknown): PlanStep[] {
  const steps = (input as { steps?: unknown } | null | undefined)?.steps
  if (!Array.isArray(steps)) return []
  return steps.map((step, index) => {
    const item = (step ?? {}) as { title?: unknown; state?: unknown }
    const state = String(item.state)
    return {
      n: index + 1,
      title: typeof item.title === "string" ? item.title : "",
      state: (STATES.has(state) ? state : "waiting") as PlanStep["state"],
    }
  })
}

/**
 * The step the agent was on is the one that failed. A plan with nothing in
 * hand is left as it is.
 */
export function failPlan(plan: PlanStep[] | undefined): PlanStep[] | undefined {
  if (!plan?.length) return plan
  const inHand = plan.findIndex((step) => step.state === "working")
  if (inHand === -1) return plan
  return plan.map((step, index) => (index === inHand ? { ...step, state: "failed" } : step))
}

/**
 * The steps the closed bar shows: the one in hand, the one before it and the
 * one after it, in that order, so the numbers read upwards. With nothing in
 * hand, the window starts at the first step that is not done.
 */
export function planWindow(plan: PlanStep[]): PlanStep[] {
  if (plan.length <= PLAN_WINDOW) return plan
  const inHand = plan.findIndex((step) => step.state === "working")
  const first = inHand === -1 ? firstUnfinished(plan) : Math.max(0, inHand - 1)
  return plan.slice(first, first + PLAN_WINDOW)
}

/** Where the window starts when no step is in hand. */
function firstUnfinished(plan: PlanStep[]): number {
  const index = plan.findIndex((step) => step.state !== "done")
  return index === -1 ? plan.length - PLAN_WINDOW : index
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run check`
Expected: PASS — prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add src/plan.ts src/state.ts scripts/check.ts
git commit -m "feat: the plan's shared logic"
```

---

### Task 2: The tool the agent records its plan with

**Files:**
- Modify: `src/index.ts` (the server half)
- Create: `src/rules.ts`
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: `PLAN_TOOL` and `planInput` from `src/plan.ts` (Task 1).
- Produces: `src/rules.ts` exporting `agentsFile(): string`, `planRule(): string` and `installPlanRule(file?: string): boolean`. `installPlanRule` returns true when it wrote the rule, false when the rule was already there. It never changes anything else in the file.

- [ ] **Step 1: Write the failing test**

Add to `scripts/check.ts`, with the imports `mkdtempSync`, `readFileSync`, `writeFileSync` from `node:fs`, `tmpdir` from `node:os`, `join` from `node:path`, and `installPlanRule`, `planRule` from `../src/rules.ts`:

```ts
// The rule goes in once, and never eats what was already in the file.
const dir = mkdtempSync(join(tmpdir(), "island-rule-"))
const file = join(dir, "AGENTS.md")
writeFileSync(file, "# Global instructions\n\nBrowser work runs through browse.\n")
assert.equal(installPlanRule(file), true)
const after = readFileSync(file, "utf8")
assert.ok(after.startsWith("# Global instructions\n\nBrowser work runs through browse.\n"))
assert.ok(after.includes(planRule()))
assert.equal(installPlanRule(file), false)
assert.equal(readFileSync(file, "utf8"), after)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the module `../src/rules.ts` does not exist.

- [ ] **Step 3: Create `src/rules.ts`**

```ts
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** The marker that says the block is the island's, so it can be found again. */
const MARK = "opencode-island:plan"

/** Where OpenCode keeps the global instructions. */
export function agentsFile(): string {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA
      : process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base ?? join(homedir(), ".config"), "opencode", "AGENTS.md")
}

/** The rule, as it is written into the global instructions. */
export function planRule(): string {
  return [
    `<!-- ${MARK} -->`,
    "## The island's plan",
    "",
    `When a task takes more than one step, record the steps with the \`${PLAN_TOOL}\` tool: one step per item, in the order you will do them, each with a \`title\` in your own words and a \`state\` of \`waiting\`, \`working\`, \`done\` or \`failed\`. Call it again whenever a step changes state, so the island on the screen always shows where you are.`,
    "",
    `<!-- /${MARK} -->`,
    "",
  ].join("\n")
}

/**
 * Put the rule in the global instructions, once. The file is only ever
 * appended to, so what the user has written there stays exactly as it was.
 */
export function installPlanRule(file = agentsFile()): boolean {
  try {
    if (existsSync(file) && readFileSync(file, "utf8").includes(MARK)) return false
    appendFileSync(file, `\n${planRule()}`, "utf8")
    return true
  } catch {
    // A machine that will not let the file be written still gets an island.
    return false
  }
}
```

Import `PLAN_TOOL` from `./plan` at the top of the file.

- [ ] **Step 4: Register the tool and install the rule**

In `src/index.ts`, replace the body of `setup()` with:

```ts
export default Plugin.define({
  id: "opencode-island",
  setup(ctx) {
    // The tool the agent records its plan with. The call itself is the
    // record: the island reads it off the event stream.
    ctx.tool.transform((tools) => {
      tools.add({
        name: PLAN_TOOL,
        description:
          "Record the steps of the work you are doing, so the island can show them. Call it once with the whole plan, then again whenever a step changes state.",
        input: planInput,
        execute: async (input) => ({
          output: input,
          content: "The plan is on the island.",
        }),
      })
    })
    installPlanRule()
  },
})
```

Import `PLAN_TOOL` and `planInput` from `./plan`, and `installPlanRule` from
`./rules`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run check`
Expected: PASS — prints `ok`.

- [ ] **Step 6: Typecheck the server half**

Run: `npm run typecheck`
Expected: no error. If the tool's `execute` or `input` types do not line up
with the plugin API, fix them here rather than loosening the types elsewhere.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/rules.ts scripts/check.ts
git commit -m "feat: the tool the agent records its plan with"
```

---

### Task 3: The plan, off the event stream

**Files:**
- Modify: `src/model.ts`
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: `PLAN_TOOL`, `parseSteps` and `failPlan` from `src/plan.ts` (Task 1).
- Produces: `SessionView.plan` is filled from the tool calls.

- [ ] **Step 1: Watch the tool call**

Add `"session.tool.called"` to the `WATCHED` array in `src/model.ts`, and to
the `Watched` union:

```ts
  | {
      type: "session.tool.called"
      data: { sessionID: string; id: string; input: { [x: string]: any } }
    }
```

- [ ] **Step 2: Read the plan from the call**

Add a case to the switch in `listen`:

```ts
          case "session.tool.called": {
            const data = event.data
            const entry = sessions.get(data.sessionID)
            // The event carries no tool name, so the call is known by its
            // shape, and by the name when the model has it.
            const name = entry?.tools.get(data.id)
            if (name && name !== PLAN_TOOL) break
            const plan = parseSteps(data.input)
            if (plan.length) touch(data.sessionID, { plan })
            break
          }
```

- [ ] **Step 3: Keep the plan tool out of the row's tool name**

In the case for `session.tool.input.started`, the island shows the tool that
is running. The plan tool is not work, it is bookkeeping, so it does not go
there:

```ts
          case "session.tool.input.started": {
            const data = event.data
            ensure(data.sessionID).tools.set(data.id, data.name)
            if (data.name !== PLAN_TOOL) {
              touch(data.sessionID, { status: "busy", tool: data.name })
            }
            break
          }
```

- [ ] **Step 4: Mark the step in hand as failed**

Split `session.execution.failed` out of the case it shares with
`session.idle` and `session.execution.succeeded`, so that it can mark the
step. An interrupted run is not a failure, and a tool that failed is not the
step failing, so neither marks anything.

```ts
          case "session.execution.failed": {
            const entry = sessions.get(event.data.sessionID)
            if (entry) {
              entry.reasoning = false
              entry.writing = false
              touch(event.data.sessionID, { plan: failPlan(entry.plan) })
            }
            touch(event.data.sessionID, { status: "idle", tool: undefined })
            break
          }
```

- [ ] **Step 5: Run the test**

Run: `npm run check && npm run typecheck`
Expected: `ok` and no type error.

- [ ] **Step 6: Commit**

```bash
git add src/model.ts
git commit -m "feat: read the plan off the event stream"
```

---

### Task 4: The steps on the bar and in the open island

**Files:**
- Modify: `src/island/app/tsconfig.json` (include the new file)
- Modify: `src/island/app/components/island.tsx` (the mark, the bar, the row)
- Modify: `src/island/app/island.css` (the waiting colour, the pulse)

**Interfaces:**
- Consumes: `PlanStep` from `src/state.ts`, `planWindow` from `src/plan.ts`.
- Produces: nothing new.

- [ ] **Step 1: Include the new file in the island's typescript project**

In `src/island/app/tsconfig.json`, add `"../../plan.ts"` to the `include`
array, next to `"../../orb.ts"`.

- [ ] **Step 2: Draw one step**

In `src/island/app/components/island.tsx`, add the import of `planWindow`
from `../../../plan`, and of `PlanStep` from `../../../state`.

Add this component next to `OpenCodeMark`:

```tsx
/** One step of the plan: its number, and a dot that says where it stands. */
function StepMark({ step, across }: { step: PlanStep; across?: boolean }) {
  return (
    <span
      title={step.title}
      className={cn(
        "flex items-center gap-1 text-[10px] leading-none tabular-nums",
        across ? "flex-col-reverse" : "flex-row",
      )}
    >
      <span className="text-muted-foreground">{step.n}</span>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          step.state === "done" && "bg-success",
          step.state === "working" && "step-live bg-warning",
          step.state === "waiting" && "bg-waiting",
          step.state === "failed" && "bg-destructive",
        )}
      />
    </span>
  )
}
```

The bar writes sideways, so a step's number and its dot sit side by side
across the bar: `flex-col-reverse` in a vertical writing mode puts the number
on the left and the dot on its right.

- [ ] **Step 3: Add the waiting colour and the pulse to `src/island/app/island.css`**

In the `@theme inline` block, add `--color-waiting: var(--waiting);`. In
`:root`, add `--waiting: #ffd60a;`. In `[data-theme="light"]`, add
`--waiting: #b98900;`.

Add at the end of the file:

```css
/* The dot of the step in hand pulses, so it reads as alive without flashing. */
@keyframes step-pulse {
  0% {
    box-shadow: 0 0 0 0 rgb(255 159 10 / 0.55);
  }
  70% {
    box-shadow: 0 0 0 5px rgb(255 159 10 / 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgb(255 159 10 / 0);
  }
}

.step-live {
  animation: step-pulse 1.8s ease-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .step-live {
    animation: none;
  }
}
```

- [ ] **Step 4: Show the window on the closed bar**

In the closed branch of `src/island/app/components/island.tsx`, after the orb
slot and before the words, add:

```tsx
          {active?.plan?.length ? (
            <span className="flex shrink-0 flex-row items-center gap-1.5">
              {planWindow(active.plan).map((step) => (
                <StepMark key={step.n} step={step} across />
              ))}
            </span>
          ) : null}
```

`active` is the session the bar already shows the words of, so the plan and
the words are of the same agent. The marks take length from the words, not
width: the words are cut to fit, never the bar.

- [ ] **Step 5: Show every agent's plan in the open island**

In the `Row` component of the same file, under the title line and above the
streamed words, add:

```tsx
        {session.plan?.length ? (
          <div className="mt-0.5 flex items-center gap-1.5">
            {session.plan.map((step) => (
              <StepMark key={step.n} step={step} />
            ))}
            <span className={cn("text-[10.5px] tabular-nums", muted)}>
              {session.plan.filter((step) => step.state === "done").length}/{session.plan.length}
            </span>
          </div>
        ) : null}
```

- [ ] **Step 6: Build and look at the island**

Run: `npm run build`
Expected: the island bundle is built with no error.

Run the Electron harness in `/tmp/etest/main16.js` with a fake state whose
session carries a plan of five steps, two done, the third working, and check
with `getBoundingClientRect` that the three marks are inside the bar's 36px
width, in the order 2, 3, 4, that the bar does not overflow, and that the
open island shows the same marks on the row.

- [ ] **Step 7: Commit**

```bash
git add src/island/app/tsconfig.json src/island/app/components/island.tsx src/island/app/island.css
git commit -m "feat: show the steps on the bar and in the open island"
```

---

### Task 5: The docs, and the ship

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the release.

- [ ] **Step 1: Document the plan on the island**

In `README.md`, in the section that describes the closed tab, add a paragraph
saying that under the grip the island shows the steps of the agent's plan,
each a number and a dot: green when the step is done, orange and pulsing on
the step in hand, yellow for the ones waiting, red for the one that failed.
Say that the plan is recorded by the agent itself with the plugin's own
`island_plan` tool, and that the plugin adds one rule to the global
`AGENTS.md` so agents record it as they work.

- [ ] **Step 2: Run everything**

Run: `npm run typecheck && npm run check && npm run build`
Expected: no type error, `ok` from the check, and a built island bundle.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: the island's plan"
```

- [ ] **Step 4: Ship**

Bump the version in `package.json`, commit, push the branch and the tag,
publish to npm, create the GitHub release with the notes on what the plan is
and where it comes from, and publish the landing page with
`sh scripts/pages.sh`.
