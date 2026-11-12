import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModel, keepWords, lastWords } from "../src/model.ts"
import { failPlan, looksLikePlan, parseSteps, planWindow, stopPlan } from "../src/plan.ts"
import { installPlanRule, planRule } from "../src/rules.ts"
import { islandShouldExist } from "../src/lifecycle.ts"
import { barOrbState, orbState } from "../src/orb.ts"
import type { IslandState, PlanState } from "../src/state.ts"

// The island shows the last ten words of an answer while it streams.
assert.equal(lastWords("one two three", 10), "one two three")
assert.equal(lastWords("a b c d e f g h i j k l", 10), "c d e f g h i j k l")
assert.equal(lastWords("   ", 10), "")
assert.equal(lastWords("", 10), "")

// A cut inside a word would show half of it, so the buffer keeps whole words.
const cut = keepWords(`${"a ".repeat(200)}zebra`)
assert.ok(cut.endsWith("zebra"))
assert.ok(cut.startsWith("a "))
assert.ok(cut.length <= 200)
assert.equal(keepWords("hi there"), "hi there")

// A live session gets an orb that names what it is doing.
assert.equal(orbState({ phase: "thinking" }), "breathing")
assert.equal(orbState({ phase: "writing" }), "composing")
assert.equal(orbState({ phase: "retrying" }), "solving")
assert.equal(orbState({ phase: "working", tool: "shell" }), "solving")
assert.equal(orbState({ phase: "working", tool: "grep" }), "searching")
assert.equal(orbState({ phase: "working", tool: "write" }), "composing")
assert.equal(orbState({ phase: "working", tool: "task" }), "weaving")
assert.equal(orbState({ phase: "working" }), "working")
assert.equal(orbState({ phase: "working", tool: "something-new" }), "working")

// An idle session and one waiting on an approval keep the plain dot.
assert.equal(orbState({ phase: "idle" }), undefined)
assert.equal(orbState({ phase: "waiting" }), undefined)
assert.equal(orbState({}), undefined)

// A tool name is data from the wire, so it never gets to be a key of anything.
assert.equal(orbState({ phase: "working", tool: "toString" }), "working")
assert.equal(orbState({ phase: "working", tool: "__proto__" }), "working")
assert.equal(orbState({ phase: "working", tool: "constructor" }), "working")

// The bar keeps the warning dot for as long as an approval is waiting.
assert.equal(barOrbState({ phase: "thinking" }, false), "breathing")
assert.equal(barOrbState({ phase: "thinking" }, true), undefined)
assert.equal(barOrbState(undefined, false), undefined)

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

// A run that was stopped is not a failure, so the step waits again.
assert.deepEqual(
  stopPlan([
    { n: 1, title: "Read it", state: "done" },
    { n: 2, title: "Write it", state: "working" },
    { n: 3, title: "Ship it", state: "waiting" },
  ]),
  [
    { n: 1, title: "Read it", state: "done" },
    { n: 2, title: "Write it", state: "waiting" },
    { n: 3, title: "Ship it", state: "waiting" },
  ],
)
assert.deepEqual(stopPlan(undefined), undefined)
assert.deepEqual(stopPlan([]), [])

// Another tool's call is not the island's plan, whatever it is shaped like.
assert.equal(looksLikePlan({ steps: [{ title: "Read it", state: "waiting" }] }), true)
assert.equal(looksLikePlan({ steps: [{ title: "Read it" }] }), false)
assert.equal(looksLikePlan({ steps: [{ state: "waiting" }] }), false)
assert.equal(looksLikePlan({ steps: ["read it"] }), false)
assert.equal(looksLikePlan({ steps: [] }), false)
assert.equal(looksLikePlan({ steps: "not a list" }), false)
assert.equal(looksLikePlan({}), false)
assert.equal(looksLikePlan(undefined), false)

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

// The rule goes in even when the directory is not there yet, which is a
// fresh machine.
const fresh = join(mkdtempSync(join(tmpdir(), "island-fresh-")), "opencode", "AGENTS.md")
assert.equal(installPlanRule(fresh), true)
assert.ok(readFileSync(fresh, "utf8").includes(planRule()))

// The plan reaches the island from the tool call, which carries no name.
const created = {
  type: "session.created",
  created: Date.now(),
  data: { sessionID: "s1", title: "Work", agent: "build", location: { directory: "/tmp" } },
}

/** Runs the model over a stream of events and hands back what it published. */
async function run(events: unknown[]): Promise<IslandState> {
  const fake = {
    session: { list: async () => ({ data: [] }) },
    permission: { request: { list: async () => ({ data: [] }) } },
    event: {
      subscribe: () => ({
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event
        },
      }),
    },
  }
  let seen: IslandState | undefined
  const controller = new AbortController()
  createModel(fake as never, (state) => {
    seen = state
  }).start(controller.signal)
  await new Promise((resolve) => setTimeout(resolve, 50))
  controller.abort()
  assert.ok(seen, "the model never published a state")
  return seen
}

const planCall = (id: string, input: unknown) => ({
  type: "session.tool.called",
  data: { sessionID: "s1", id, input },
})

const started = (id: string, name: string) => ({
  type: "session.tool.input.started",
  data: { sessionID: "s1", id, name },
})

const state = await run([
  created,
  started("t1", "island_plan"),
  planCall("t1", {
    steps: [
      { title: "Read it", state: "done" },
      { title: "Write it", state: "working" },
    ],
  }),
])

assert.deepEqual(state.sessions[0]?.plan, [
  { n: 1, title: "Read it", state: "done" },
  { n: 2, title: "Write it", state: "working" },
])

// Another tool's call never takes the island's plan over, even when the
// model never saw its name.
const foreign = await run([
  created,
  started("t2", "some_other_tool"),
  planCall("t2", { steps: [{ title: "Not ours", state: "working" }] }),
])
assert.equal(foreign.sessions[0]?.plan, undefined)

// A run that fails takes the step in hand with it, and only that step.
const failed = await run([
  created,
  started("t3", "island_plan"),
  planCall("t3", {
    steps: [
      { title: "Read it", state: "done" },
      { title: "Write it", state: "working" },
      { title: "Ship it", state: "waiting" },
    ],
  }),
  { type: "session.execution.failed", data: { sessionID: "s1" } },
])
assert.deepEqual(failed.sessions[0]?.plan, [
  { n: 1, title: "Read it", state: "done" },
  { n: 2, title: "Write it", state: "failed" },
  { n: 3, title: "Ship it", state: "waiting" },
])

// A run the user stopped is not a failure, so nothing goes red.
const interrupted = await run([
  created,
  started("t4", "island_plan"),
  planCall("t4", {
    steps: [
      { title: "Read it", state: "done" },
      { title: "Write it", state: "working" },
    ],
  }),
  { type: "session.execution.interrupted", data: { sessionID: "s1", reason: "user" } },
])
assert.deepEqual(interrupted.sessions[0]?.plan, [
  { n: 1, title: "Read it", state: "done" },
  { n: 2, title: "Write it", state: "waiting" },
])

// A tool that failed is not the step failing, so the agent can recover.
const toolFailed = await run([
  created,
  started("t5", "island_plan"),
  planCall("t5", {
    steps: [
      { title: "Read it", state: "done" },
      { title: "Write it", state: "working" },
    ],
  }),
  { type: "session.tool.failed", data: { sessionID: "s1", id: "t5" } },
])
assert.deepEqual(toolFailed.sessions[0]?.plan, [
  { n: 1, title: "Read it", state: "done" },
  { n: 2, title: "Write it", state: "working" },
])

// The plan tool is bookkeeping, so it is never the tool the row shows.
const withTool = await run([
  created,
  started("t6", "shell"),
  started("t7", "island_plan"),
  { type: "session.tool.success", data: { sessionID: "s1", id: "t6" } },
])
assert.equal(withTool.sessions[0]?.tool, undefined)

// An empty plan retires the old one.
const retired = await run([
  created,
  started("t8", "island_plan"),
  planCall("t8", {
    steps: [
      { title: "Read it", state: "done" },
      { title: "Write it", state: "working" },
    ],
  }),
  started("t9", "island_plan"),
  planCall("t9", { steps: [] }),
])
assert.deepEqual(retired.sessions[0]?.plan, [])

// The island must not take the app's taskbar button with it, or there is
// nothing to right-click to close OpenCode. It is a window option, so the
// only way to hold it is to read the source.
const windowSource = readFileSync(new URL("../src/window.ts", import.meta.url), "utf8")

// The island must not take the app's taskbar button with it, or there is
// nothing to right-click to close OpenCode.
assert.match(windowSource, /skipTaskbar: false/)

// The island exists while the app has a window, and not one moment longer.
assert.equal(islandShouldExist(0), false)
assert.equal(islandShouldExist(1), true)
assert.equal(islandShouldExist(3), true)

console.log("ok")
