import type { OpenCode } from "@opencode/client"
import type {
  IslandState,
  PermissionDecision,
  PermissionView,
  PlanState,
  PlanStep,
  SessionPhase,
  SessionStatus,
  SessionView,
} from "./state"

export type Client = ReturnType<typeof OpenCode.make>

/**
 * The events that change what the island shows. Everything else on the stream
 * is text, reasoning and other noise a status display does not need.
 */
const WATCHED = [
  "session.created",
  "session.deleted",
  "session.renamed",
  "session.status",
  "session.idle",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.tool.input.started",
  "session.tool.success",
  "session.tool.failed",
  "session.tool.called",
  "session.agent.selected",
  "session.usage.updated",
  "session.text.started",
  "session.text.delta",
  "session.text.ended",
  "session.reasoning.started",
  "session.reasoning.ended",
  "permission.asked",
  "permission.replied",
] as const

/**
 * The fields of the watched events the island reads.
 *
 * The client types an event's `data` as the union of every event payload, which
 * cannot be narrowed by `type`. This local union can, and it is the contract we
 * actually depend on.
 */
type Watched =
  | {
      type: "session.created"
      created: number
      data: {
        sessionID: string
        title?: string
        agent?: string
        parentID?: string
        location?: { directory?: string }
      }
    }
  | { type: "session.deleted"; data: { sessionID: string } }
  | { type: "session.renamed"; data: { sessionID: string; title: string } }
  | {
      type: "session.status"
      data: { sessionID: string; status: { type: SessionStatus } }
    }
  | {
      type:
        | "session.idle"
        | "session.execution.started"
        | "session.execution.succeeded"
        | "session.execution.failed"
      data: { sessionID: string }
    }
  | {
      type: "session.tool.input.started"
      data: { sessionID: string; id: string; name: string }
    }
  | {
      type: "session.tool.success" | "session.tool.failed"
      data: { sessionID: string; id: string }
    }
  | {
      type: "session.tool.called"
      data: { sessionID: string; id: string; name: string; input: { [x: string]: any } }
    }
  | { type: "session.agent.selected"; data: { sessionID: string; agent: string } }
  | {
      type: "session.text.started"
      data: { sessionID: string; assistantMessageID: string; ordinal: number }
    }
  | {
      type: "session.text.delta"
      data: { sessionID: string; assistantMessageID: string; ordinal: number; delta: string }
    }
  | {
      type: "session.text.ended" | "session.reasoning.started" | "session.reasoning.ended"
      data: { sessionID: string; assistantMessageID: string; ordinal: number }
    }
  | {
      type: "session.usage.updated"
      data: { sessionID: string; cost: number; tokens: { input: number; output: number } }
    }
  | {
      type: "permission.asked"
      data: {
        id: string
        sessionID: string
        action: string
        resources: string[]
        message?: string
      }
    }
  | { type: "permission.replied"; data: { sessionID: string; requestID: string } }

/** A session untouched for this long stops being worth a row. */
const EVICT_AFTER_MS = 6 * 60 * 60 * 1000

/** How much of an answer is kept around, enough for the island to show. */
const STREAM_WINDOW = 200

/** How many words of a streamed answer the island shows. */
const STREAM_WORDS = 10

/** Keeps the last of a text whole: a cut inside a word would show half of it. */
export function keepWords(text: string) {
  if (text.length <= STREAM_WINDOW) return text
  const cut = text.slice(-STREAM_WINDOW)
  const space = cut.indexOf(" ")
  return space === -1 ? cut : cut.slice(space + 1)
}

/** The last words of a text, which is what a streaming island shows. */
export function lastWords(text: string, count: number) {
  const parts = text.trim().split(/\s+/)
  if (!parts[0]) return ""
  return parts.slice(-count).join(" ")
}

type Entry = SessionView & {
  /** Tool call id -> tool name, so a completion clears the one that finished. */
  tools: Map<string, string>
  /** The tail of the answer being streamed, kept to make the last words. */
  buffer: string
  /** The agent is reasoning, before it starts writing. */
  reasoning: boolean
  /** The agent is writing its answer. */
  writing: boolean
}

/** The tool that holds the agent's plan. */
const PLAN_TOOL = "todowrite"

/** The tool's words, and the island's. */
const PLAN_STATES: Record<string, PlanState> = {
  completed: "done",
  in_progress: "working",
  pending: "waiting",
  cancelled: "failed",
}

/**
 * The steps of the agent's plan, out of a todo write. Anything that is not a
 * list of todos gives no plan at all, and a step is never lost: one the tool
 * words in a way the island does not know is a step that is waiting.
 */
export function parseTodos(input: unknown): PlanStep[] {
  const todos = (input as { todos?: unknown } | null | undefined)?.todos
  if (!Array.isArray(todos)) return []
  return todos.map((todo, index) => {
    const item = (todo ?? {}) as { content?: unknown; status?: unknown }
    return {
      n: index + 1,
      title: typeof item.content === "string" ? item.content : "",
      state: PLAN_STATES[String(item.status)] ?? "waiting",
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

export interface Reply {
  sessionID: string
  requestID: string
  decision: PermissionDecision
}

/**
 * The model of every session on this machine, fed by the server's event
 * stream. It is seeded from the session list so the island is correct on first
 * paint, not only for work started after it appeared.
 */
export function createModel(client: Client, onChange: (state: IslandState) => void) {
  const sessions = new Map<string, Entry>()

  const ensure = (id: string): Entry => {
    const found = sessions.get(id)
    if (found) return found
    const created: Entry = {
      id,
      title: "",
      agent: "",
      directory: "",
      status: "busy",
      cost: 0,
      tokens: 0,
      created: Date.now(),
      updated: Date.now(),
      tools: new Map(),
      buffer: "",
      reasoning: false,
      writing: false,
    }
    sessions.set(id, created)
    return created
  }

  const touch = (id: string, patch: Partial<SessionView> = {}) => {
    const entry = sessions.get(id)
    if (!entry) return
    Object.assign(entry, patch, { updated: Date.now() })
  }

  const view = (entry: Entry): SessionView => {
    const { tools: _tools, buffer: _buffer, reasoning: _r, writing: _w, ...rest } = entry
    return { ...rest, phase: phaseOf(entry) }
  }

  /** What the session is doing right now, in the agent's own words. */
  function phaseOf(entry: Entry): SessionPhase {
    if (entry.permission) return "waiting"
    if (entry.status === "retry") return "retrying"
    if (entry.tools.size > 0) return "working"
    if (entry.reasoning) return "thinking"
    if (entry.writing) return "writing"
    return "idle"
  }

  const state = (): IslandState => {
    const now = Date.now()
    const visible: SessionView[] = []
    for (const entry of sessions.values()) {
      if (now - entry.updated > EVICT_AFTER_MS) continue
      visible.push(view(entry))
    }
    // Waiting first, then working, then idle; newest first within a rank.
    const rank = (s: SessionView) =>
      s.permission ? 0 : s.status === "busy" ? 1 : s.status === "retry" ? 2 : 3
    visible.sort((a, b) => rank(a) - rank(b) || b.updated - a.updated)
    return {
      sessions: visible,
      working: visible.filter((s) => s.status === "busy" || s.status === "retry").length,
      waiting: visible.filter((s) => s.permission).length,
    }
  }

  const publish = () => onChange(state())

  const toPermission = (data: {
    id: string
    sessionID: string
    action: string
    resources?: string[]
    message?: string
  }): PermissionView => ({
    id: data.id,
    sessionID: data.sessionID,
    action: data.action,
    resources: data.resources ?? [],
    message: data.message,
  })

  const seed = async (signal: AbortSignal) => {
    try {
      const [listed, pending] = await Promise.all([
        client.session.list({ limit: 200 }, { signal }),
        client.permission.request.list(undefined, { signal }),
      ])
      for (const info of listed.data) {
        // A live event may have beaten the list here; keep the fresher record.
        if (sessions.has(info.id)) continue
        sessions.set(info.id, {
          id: info.id,
          title: info.title ?? "",
          agent: info.agent ?? "",
          parentID: info.parentID,
          directory: info.location?.directory ?? "",
          status: "idle",
          cost: info.cost,
          tokens: info.tokens.input + info.tokens.output,
          created: info.time.created,
          updated: info.time.updated,
          tools: new Map(),
          buffer: "",
          reasoning: false,
          writing: false,
        })
      }
      for (const request of pending.data) {
        ensure(request.sessionID).permission = toPermission(request)
      }
      publish()
    } catch {
      // The stream still keeps the island correct; a failed seed only loses history.
    }
  }

  const listen = async (signal: AbortSignal) => {
    try {
      const stream = client.event.subscribe({
        types: [...WATCHED],
        signal,
      }) as AsyncIterable<Watched>
      for await (const event of stream) {
        switch (event.type) {
          case "session.created": {
            const data = event.data
            const entry = ensure(data.sessionID)
            entry.title = data.title ?? entry.title
            entry.agent = data.agent ?? entry.agent
            entry.parentID = data.parentID ?? entry.parentID
            entry.directory = data.location?.directory ?? entry.directory
            entry.created = event.created
            entry.updated = Date.now()
            break
          }
          case "session.deleted": {
            sessions.delete(event.data.sessionID)
            break
          }
          case "session.renamed": {
            touch(event.data.sessionID, { title: event.data.title })
            break
          }
          case "session.status": {
            touch(event.data.sessionID, { status: event.data.status.type })
            break
          }
          case "session.idle":
          case "session.execution.succeeded": {
            const entry = sessions.get(event.data.sessionID)
            if (entry) {
              entry.reasoning = false
              entry.writing = false
            }
            touch(event.data.sessionID, { status: "idle", tool: undefined })
            break
          }
          case "session.execution.failed": {
            const entry = sessions.get(event.data.sessionID)
            if (entry) {
              entry.reasoning = false
              entry.writing = false
              // The step the agent was on is the one that failed.
              touch(event.data.sessionID, { plan: failPlan(entry.plan) })
            }
            touch(event.data.sessionID, { status: "idle", tool: undefined })
            break
          }
          case "session.execution.started": {
            touch(event.data.sessionID, { status: "busy" })
            break
          }
          case "session.tool.input.started": {
            const data = event.data
            ensure(data.sessionID).tools.set(data.id, data.name)
            touch(data.sessionID, { status: "busy", tool: data.name })
            break
          }
          case "session.tool.success":
          case "session.tool.failed": {
            const data = event.data
            const entry = sessions.get(data.sessionID)
            if (!entry) break
            entry.tools.delete(data.id)
            const next = entry.tools.values().next()
            entry.tool = next.done ? undefined : next.value
            break
          }
          case "session.tool.called": {
            const data = event.data
            if (data.name !== PLAN_TOOL) break
            const plan = parseTodos(data.input)
            if (plan.length) touch(data.sessionID, { plan })
            break
          }
          case "session.agent.selected": {
            touch(event.data.sessionID, { agent: event.data.agent })
            break
          }
          case "session.text.started": {
            // A new answer starts, so the old words go.
            const entry = ensure(event.data.sessionID)
            entry.buffer = ""
            entry.writing = true
            entry.reasoning = false
            break
          }
          case "session.text.ended": {
            const entry = sessions.get(event.data.sessionID)
            if (entry) entry.writing = false
            break
          }
          case "session.reasoning.started": {
            const entry = ensure(event.data.sessionID)
            entry.reasoning = true
            entry.writing = false
            touch(event.data.sessionID, { status: "busy" })
            break
          }
          case "session.reasoning.ended": {
            const entry = sessions.get(event.data.sessionID)
            if (entry) entry.reasoning = false
            break
          }
          case "session.text.delta": {
            const data = event.data
            const entry = ensure(data.sessionID)
            entry.buffer = keepWords(entry.buffer + data.delta)
            const text = lastWords(entry.buffer, STREAM_WORDS)
            if (!text) break
            touch(data.sessionID, { stream: text })
            break
          }
          case "session.usage.updated": {
            const data = event.data
            touch(data.sessionID, {
              cost: data.cost,
              tokens: data.tokens.input + data.tokens.output,
            })
            break
          }
          case "permission.asked": {
            const data = event.data
            ensure(data.sessionID).permission = toPermission(data)
            touch(data.sessionID)
            break
          }
          case "permission.replied": {
            const data = event.data
            const entry = sessions.get(data.sessionID)
            if (entry && entry.permission?.id === data.requestID) {
              entry.permission = undefined
              entry.updated = Date.now()
            }
            break
          }
        }
        publish()
      }
    } catch {
      // Aborted on shutdown, or the server restarted. The plugin reconnects.
    }
  }

  return {
    start(signal: AbortSignal) {
      void seed(signal)
      void listen(signal)
    },
    reply(reply: Reply) {
      return client.permission.reply({
        sessionID: reply.sessionID,
        requestID: reply.requestID,
        decision: reply.decision,
      })
    },
    state,
  }
}
