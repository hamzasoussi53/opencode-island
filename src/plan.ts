import type { PlanState, PlanStep } from "./state"

/** The tool the agent records its plan with. */
export const PLAN_TOOL = "island_plan"

/** How many steps the closed bar shows at once. */
export const PLAN_WINDOW = 3

/** The states a step can be in. */
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
 * Whether a tool call looks like a plan: a list of steps, each with a title
 * and a state. A call the island cannot name is only a plan when it looks
 * like one, so another tool's steps never take the island's plan over.
 */
export function looksLikePlan(input: unknown): boolean {
  const steps = (input as { steps?: unknown } | null | undefined)?.steps
  if (!Array.isArray(steps) || !steps.length) return false
  return steps.every((step) => {
    const item = (step ?? {}) as { title?: unknown; state?: unknown }
    return typeof item.title === "string" && typeof item.state === "string"
  })
}

/** The step in hand, and the state it takes. */
function withInHand(plan: PlanStep[] | undefined, state: PlanState): PlanStep[] | undefined {
  if (!plan?.length) return plan
  const inHand = plan.findIndex((step) => step.state === "working")
  if (inHand === -1) return plan
  return plan.map((step, index) => (index === inHand ? { ...step, state } : step))
}

/**
 * The plan, out of a tool that ran the island's tool inside it. Such a tool
 * reports the calls it made in its metadata, and there the plan is named, so
 * the island finds it there and not only on a call of its own.
 */
export function nestedPlan(metadata: unknown): PlanStep[] | undefined {
  const calls = (metadata as { toolCalls?: unknown } | null | undefined)?.toolCalls
  if (!Array.isArray(calls)) return undefined
  for (const call of calls) {
    const item = (call ?? {}) as { tool?: unknown; input?: unknown }
    if (item.tool !== PLAN_TOOL) continue
    const plan = parseSteps(item.input)
    if (plan.length) return plan
  }
  return undefined
}

/**
 * The step the agent was on is the one that failed. A plan with nothing in
 * hand is left as it is.
 */
export function failPlan(plan: PlanStep[] | undefined): PlanStep[] | undefined {
  return withInHand(plan, "failed")
}

/**
 * The step the agent was on is not in hand any more: the run was stopped, so
 * the step waits again. It did not fail, so it does not go red.
 */
export function stopPlan(plan: PlanStep[] | undefined): PlanStep[] | undefined {
  return withInHand(plan, "waiting")
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
