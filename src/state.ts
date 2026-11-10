/**
 * What the island shows, as plain JSON.
 *
 * The island renders in its own Electron window with no access to the plugin
 * SDK, so this is the only shape that crosses the process boundary.
 */

export type SessionStatus = "idle" | "busy" | "retry"

/** What the session is doing right now, in a word. */
export type SessionPhase = "idle" | "thinking" | "writing" | "working" | "waiting" | "retrying"

export type PermissionDecision = "once" | "always" | "reject"

export interface PermissionView {
  id: string
  sessionID: string
  action: string
  resources: string[]
  message?: string
}

export interface SessionView {
  id: string
  title: string
  agent: string
  /** Set when this session is a subagent spawned by another session. */
  parentID?: string
  /** Absolute path of the project the session belongs to. */
  directory: string
  status: SessionStatus
  /** What the session is doing right now: thinking, working, and so on. */
  phase?: SessionPhase
  /** Name of the tool currently running, if any. */
  tool?: string
  /** The last words the assistant said, while it is still saying them. */
  stream?: string
  /** Set while the session waits on the user to approve something. */
  permission?: PermissionView
  cost: number
  tokens: number
  /** Epoch millis of the last event that touched this session. */
  updated: number
  /** Epoch millis when the session was created. */
  created: number
}

export interface IslandState {
  sessions: SessionView[]
  /** Sessions currently working or retrying. */
  working: number
  /** Sessions waiting on a permission decision. */
  waiting: number
}

export interface IslandMessage extends IslandState {
  /** Whether the island shows its list, or only the contracted line. */
  open: boolean
}
