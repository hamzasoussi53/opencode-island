import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { PLAN_TOOL } from "./plan.ts"

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
    // The directory may not be there yet on a fresh machine, and a rule that
    // cannot be written is a rule no agent will ever follow.
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `\n${planRule()}`, "utf8")
    return true
  } catch (error) {
    // A machine that will not let the file be written still gets an island,
    // but the rule is missing, so it is said out loud.
    console.error("island: the plan rule could not be written", error)
    return false
  }
}
