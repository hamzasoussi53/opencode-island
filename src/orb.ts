import type { OrbState } from "thinking-orbs"
import type { SessionView } from "./state"

/** What the tool being run says about the work. */
const TOOL_STATES = new Map<string, OrbState>([
  ["grep", "searching"],
  ["glob", "searching"],
  ["webfetch", "searching"],
  ["websearch", "searching"],
  ["shell", "solving"],
  ["bash", "solving"],
  ["execute", "solving"],
  ["write", "composing"],
  ["edit", "composing"],
  ["patch", "composing"],
  ["task", "weaving"],
  ["subagent", "weaving"],
  ["todowrite", "weaving"],
])

/**
 * The orb that shows what a session is doing, or undefined when it is not
 * doing anything: an idle session and one waiting on an approval keep the
 * plain dot, which is how the island says "this needs you".
 */
export function orbState(session: Pick<SessionView, "phase" | "tool">): OrbState | undefined {
  switch (session.phase) {
    case "thinking":
      return "breathing"
    case "writing":
      return "composing"
    case "retrying":
      return "solving"
    case "working":
      // The tool name comes off the wire, so it is looked up, never indexed.
      return TOOL_STATES.get(session.tool ?? "") ?? "working"
    default:
      return undefined
  }
}

/**
 * The orb on the closed bar. An approval waiting turns the whole bar orange,
 * so it keeps the warning dot rather than an orb nobody can read on orange.
 */
export function barOrbState(
  session: Pick<SessionView, "phase" | "tool"> | undefined,
  alert: boolean,
): OrbState | undefined {
  if (alert || !session) return undefined
  return orbState(session)
}
