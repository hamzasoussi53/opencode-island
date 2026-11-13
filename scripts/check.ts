import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createModel, keepWords, lastWords } from "../src/model.ts"
import { failPlan, looksLikePlan, nestedPlan, parseSteps, planWindow, stopPlan } from "../src/plan.ts"
import { installPlanRule, planRule } from "../src/rules.ts"
import { islandShouldExist } from "../src/lifecycle.ts"
import { barOrbState, orbState } from "../src/orb.ts"
import type { IslandState, PlanState, QueuedPrompt, SessionPicks } from "../src/state.ts"

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

// A tool that ran the island's tool inside it reports the call in its
// metadata, and the plan is found there.
assert.deepEqual(
  nestedPlan({
    toolCalls: [
      { tool: "shell", status: "completed", input: { command: "ls" } },
      {
        tool: "island_plan",
        status: "completed",
        input: { steps: [{ title: "Read it", state: "working" }] },
      },
    ],
  }),
  [{ n: 1, title: "Read it", state: "working" }],
)
assert.equal(nestedPlan({ toolCalls: [{ tool: "shell", status: "completed" }] }), undefined)
assert.equal(nestedPlan({ toolCalls: "not a list" }), undefined)
assert.equal(nestedPlan({}), undefined)
assert.equal(nestedPlan(undefined), undefined)

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

type Delivery = "steer" | "queue"

type Sent = { sessionID: string; text: string; delivery: Delivery }

type Cancelled = { sessionID: string; inboxID: string }

type Answer = { ok: boolean; error?: string }

/** A fake server that records what the model asked it to do. */
function server(options: { sessions?: unknown[]; inbox?: unknown[]; error?: Error } = {}) {
  const sent: Sent[] = []
  const cancelled: Cancelled[] = []
  const client = {
    session: {
      list: async () => ({ data: options.sessions ?? [] }),
      prompt: async (input: Sent) => {
        sent.push(input)
        if (options.error) throw options.error
      },
      inbox: {
        list: async () => options.inbox ?? [],
        cancel: async (input: Cancelled) => {
          cancelled.push(input)
        },
      },
    },
    permission: { request: { list: async () => ({ data: [] }) } },
  }
  return { client, sent, cancelled }
}

/** Starts the model on a fake server, lets it seed, and hands it back. */
async function modelOn(at = server(), events: unknown[] = []) {
  let seen: IslandState | undefined
  const model = createModel(
    {
      ...at.client,
      event: {
        subscribe: () => ({
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event
          },
        }),
      },
    } as never,
    (state) => {
      seen = state
    },
  )
  const controller = new AbortController()
  model.start(controller.signal)
  await new Promise((resolve) => setTimeout(resolve, 50))
  controller.abort()
  return { model, state: () => seen }
}

/** Runs the model over a stream of events and hands back what it published. */
async function run(events: unknown[], at = server()): Promise<IslandState> {
  const { state } = await modelOn(at, events)
  const seen = state()
  assert.ok(seen, "the model never published a state")
  return seen
}

/**
 * A server's session list, built from the fields the model reads. The list
 * carries no status: a seeded session is idle until an event says otherwise.
 */
function listedOf(
  sessions: Array<{ id: string; title: string; agent: string; status: string; updated: number }>,
) {
  return sessions.map(({ id, title, agent, updated }) => ({
    id,
    title,
    agent,
    cost: 0,
    tokens: { input: 0, output: 0 },
    time: { created: updated, updated },
    location: { directory: "/tmp/project" },
  }))
}

/** The picks the model makes of a server's session list. */
async function picksOf(sessions: Parameters<typeof listedOf>[0]) {
  const { model } = await modelOn(server({ sessions: listedOf(sessions) }))
  return model.picks()
}

/** What the server was asked to send, or the failure the model answered. */
async function promptOf(
  sessionID: string,
  text: string,
  delivery: Delivery,
  error?: Error,
): Promise<Sent | Answer> {
  const at = server(error ? { error } : {})
  const { model } = await modelOn(at)
  const answer = await model.prompt(sessionID, text, delivery)
  return answer.ok ? (at.sent[0] ?? answer) : answer
}

/** Every prompt the server was asked to send, in order. */
async function promptsOf(list: Array<[string, string, Delivery]>): Promise<Sent[]> {
  const at = server()
  const { model } = await modelOn(at)
  for (const [sessionID, text, delivery] of list) await model.prompt(sessionID, text, delivery)
  return at.sent
}

/** The queue the model reads out of a server inbox. */
async function queuedOf(sessionID: string, items: unknown[]): Promise<QueuedPrompt[]> {
  const { model } = await modelOn(server({ inbox: items }))
  return model.queued(sessionID)
}

/** What the server was asked to cancel. */
async function cancelOf(sessionID: string, inboxID: string): Promise<Cancelled | undefined> {
  const at = server()
  const { model } = await modelOn(at)
  await model.cancel(sessionID, inboxID)
  return at.cancelled[0]
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

// A tool that ran the island's tool inside it brings the plan with it.
const nested = await run([
  created,
  started("t10", "execute"),
  {
    type: "session.tool.success",
    data: {
      sessionID: "s1",
      id: "t10",
      metadata: {
        toolCalls: [
          {
            tool: "island_plan",
            status: "completed",
            input: { steps: [{ title: "Read it", state: "working" }] },
          },
        ],
      },
    },
  },
])
assert.deepEqual(nested.sessions[0]?.plan, [{ n: 1, title: "Read it", state: "working" }])

// The picks are every session the model knows, newest first, running ones
// among them, and a finished session is still there.
const picks = await picksOf([
  { id: "s1", title: "Older", agent: "build", status: "idle", updated: 100 },
  { id: "s2", title: "Newer", agent: "build", status: "busy", updated: 200 },
])
assert.deepEqual(
  picks.map((pick) => pick.id),
  ["s2", "s1"],
)
assert.equal(picks[0]?.title, "Newer")

// A session too old to be a row is still one you can pick: it is exactly the
// one you come back to.
const yesterday = [
  {
    id: "s9",
    title: "Yesterday",
    agent: "build",
    status: "idle",
    updated: Date.now() - 7 * 60 * 60 * 1000,
  },
]
const { model: old, state: oldState } = await modelOn(server({ sessions: listedOf(yesterday) }))
assert.deepEqual(oldState()?.sessions, [])
assert.deepEqual(
  old.picks().map((pick) => pick.id),
  ["s9"],
)

// A prompt is sent with the delivery the island asked for.
const sent = await promptOf("s1", "keep going", "queue")
assert.deepEqual(sent, { sessionID: "s1", text: "keep going", delivery: "queue" })

// A send that fails comes back as a failure, not as nothing.
const failedSend = await promptOf("s1", "keep going", "steer", new Error("no such session"))
assert.deepEqual(failedSend, { ok: false, error: "no such session" })

// The queue is asked of the server, so a prompt queued before the island
// started is still there.
const queued = await queuedOf("s1", [
  { id: "i1", type: "user", delivery: "queue", payload: { text: "later" } },
  { id: "i2", type: "user", delivery: "steer", payload: { text: "now" } },
])
assert.deepEqual(queued, [{ id: "i1", text: "later" }])

// A prompt to a session that is not running is still sent, and the server
// starts it.
const idle = await promptOf("s1", "carry on", "steer")
assert.deepEqual(idle, { sessionID: "s1", text: "carry on", delivery: "steer" })

// Two sends in a row both reach the server: the second is not swallowed by
// the first.
const twice = await promptsOf([
  ["s1", "one", "steer"],
  ["s1", "two", "steer"],
])
assert.equal(twice.length, 2)
assert.deepEqual(
  twice.map((prompt) => prompt.text),
  ["one", "two"],
)

// A queued prompt is cancelled by the id the server gave it.
const cancelled = await cancelOf("s1", "i1")
assert.deepEqual(cancelled, { sessionID: "s1", inboxID: "i1" })

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

// The island's page can ask for a prompt to be sent, and for the queue.
const preloadSource = readFileSync(new URL("../src/island/preload.cjs", import.meta.url), "utf8")
assert.match(preloadSource, /prompt: \(request\) =>/)
assert.match(preloadSource, /queued: \(sessionID\) =>/)
assert.match(preloadSource, /cancel: \(request\) =>/)
assert.match(preloadSource, /onPicks: \(handler\) =>/)
assert.match(preloadSource, /drawerSize: \(size\) =>/)

// The window answers a prompt and a queue, and carries the drawer's size.
assert.match(windowSource, /\$\{CHANNEL\}:prompt/)
assert.match(windowSource, /\$\{CHANNEL\}:queued/)
assert.match(windowSource, /\$\{CHANNEL\}:cancel/)
assert.match(windowSource, /\$\{CHANNEL\}:drawer-size/)

// The picks go on their own channel, so they never ride on every state.
assert.match(windowSource, /\$\{CHANNEL\}:picks/)

// The drawer is clamped in pixels, apart from the bar's share of the screen.
assert.match(windowSource, /MIN_DRAWER_WIDTH = 320/)
assert.match(windowSource, /MIN_DRAWER_HEIGHT = 240/)
assert.match(windowSource, /DRAWER_HEIGHT_SHARE = 0\.8/)

// The picks are compared without their per-token timestamp, so a streaming
// answer does not resend the list on every token.
const guiSource = readFileSync(new URL("../src/gui.tsx", import.meta.url), "utf8")
assert.match(guiSource, /updated: _updated/)

console.log("ok")
