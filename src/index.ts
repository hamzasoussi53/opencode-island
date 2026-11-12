import { Plugin } from "@opencode/plugin"
import { PLAN_TOOL, planInput } from "./plan.ts"
import { installPlanRule } from "./rules.ts"

/**
 * The server half of the plugin.
 *
 * It gives the agent the one tool the island needs: the plan the agent is
 * working through. The call itself is the record, and the island reads it
 * off the event stream, so the tool keeps nothing.
 *
 * It also puts the rule that asks the agent to use it into the global
 * instructions, once.
 */
export default Plugin.define({
  id: "opencode-island",
  // The tool is registered before the plugin is done, so a failure to add it
  // is a failure of the plugin, not a silence.
  async setup(ctx) {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: PLAN_TOOL,
        description:
          "Record the steps of the work you are doing, so the island can show them. Call it once with the whole plan, then again whenever a step changes state.",
        input: planInput,
        execute: async () => ({
          content: "The plan is on the island.",
        }),
      })
    })
    installPlanRule()
  },
})
