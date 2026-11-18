import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { PLAN_TOOL } from "./plan.ts"

/** The marker that says the block is the island's, so it can be found again. */
const MARK = "opencode-island:plan"

/** The island's block, from one marker to the other, and the newline after it. */
const BLOCK = new RegExp(`<!-- ${MARK} -->[\\s\\S]*?<!-- /${MARK} -->\\n?`)

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
    `When a task takes more than one step, record the steps with the \`${PLAN_TOOL}\` tool: one step per item, in the order you will do them, each with a short \`title\` of two to four words saying what the step does, and a \`state\` of \`waiting\`, \`working\`, \`done\` or \`failed\`. Call it again whenever a step changes state, so the island on the screen always shows where you are and what you are on.`,
    "",
    `<!-- /${MARK} -->`,
    "",
  ].join("\n")
}

/**
 * Put the rule in the global instructions, and keep it current. This runs on
 * every load, so an install writes the rule and an update to a newer wording
 * replaces the old block in place. Nothing else in the file is touched.
 */
export function installPlanRule(file = agentsFile()): boolean {
  try {
    const current = existsSync(file) ? readFileSync(file, "utf8") : ""
    // A block whose markers are damaged does not match, so the rule is written
    // again below it rather than silently never applying.
    const next = BLOCK.test(current) ? current.replace(BLOCK, planRule()) : `${current}\n${planRule()}`
    if (next === current) return false
    // The directory may not be there yet on a fresh machine, and a rule that
    // cannot be written is a rule no agent will ever follow.
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, next, "utf8")
    return true
  } catch (error) {
    // A machine that will not let the file be written still gets an island,
    // but the rule is missing, so it is said out loud.
    console.error("island: the plan rule could not be written", error)
    return false
  }
}
