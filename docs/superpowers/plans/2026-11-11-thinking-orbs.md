# Thinking orbs in the island — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a thinking orb instead of the status dot for every session that is actively thinking, writing or running a tool, in the closed bar and in the opened panel.

**Architecture:** A pure function `orbState()` in `src/orb.ts` maps a session's `phase` (and its running `tool`) to one of the library's nine orb states, or to `undefined` when the session is idle or waiting for an approval. The island UI asks it where the dot used to be: an orb when it answers, the old dot otherwise. The plugin side is untouched.

**Tech Stack:** React 19, Vite, Tailwind v4, TypeScript, `thinking-orbs` ^0.3.2, node assert checks.

**Spec:** `docs/superpowers/specs/2026-11-11-thinking-orbs-design.md`

## Global Constraints

- `thinking-orbs` ^0.3.2, MIT, React >= 18 peer, no runtime dependencies.
- Orb size is `20` only. The closed bar is 36px wide with 8px of padding; 32 and 64 do not fit.
- `theme="auto"` only. The shell already sets `data-theme="dark|light"`, which the library reads live.
- No gravity, no `color` tint. The stock grayscale ink is the look.
- One orb per live session. Never an orb for an idle session.
- Do not touch `src/model.ts`, `src/state.ts`, `src/window.ts` or `src/gui.tsx`. The data is already there.

## Review Focus

- A session waiting on an approval keeps the plain orange dot, never an orb — the approval signal must not be lost.
- An idle session shows the dot, not a frozen orb.
- A live session with an unknown or missing tool name still gets an orb (the `working` default).
- Light theme shows dark ink on the white panel; dark theme shows light ink on black. `theme="auto"` resolves from the shell's `data-theme`.
- The 20px orb fits the closed bar's 36px column without clipping or pushing the spine text.

---

### Task 1: The session-to-orb mapping

**Files:**
- Create: `src/orb.ts`
- Modify: `scripts/check.ts`

**Interfaces:**
- Consumes: `SessionPhase`, `SessionView` from `src/state.ts`; `OrbState` from `thinking-orbs` (type-only import).
- Produces: `export function orbState(session: Pick<SessionView, "phase" | "tool">): OrbState | undefined`. `undefined` means "no live activity", so the caller keeps the dot.

- [ ] **Step 1: Write the failing assertions in `scripts/check.ts`**

Append to `scripts/check.ts`:

```ts
import { orbState } from "../src/orb.ts"

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
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `npm run check`
Expected: fails with `ERR_MODULE_NOT_FOUND` for `../src/orb.ts`.

- [ ] **Step 3: Implement `orbState` in `src/orb.ts`**

```ts
import type { OrbState } from "thinking-orbs"
import type { SessionView } from "./state"

/** What the tool being run says about the work. */
const TOOL_STATES: Record<string, OrbState> = {
  grep: "searching",
  glob: "searching",
  webfetch: "searching",
  websearch: "searching",
  shell: "solving",
  bash: "solving",
  execute: "solving",
  write: "composing",
  edit: "composing",
  patch: "composing",
  task: "weaving",
  subagent: "weaving",
  todowrite: "weaving",
}

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
      return TOOL_STATES[session.tool ?? ""] ?? "working"
    default:
      return undefined
  }
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `npm run check`
Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/orb.ts scripts/check.ts
git commit -m "feat: map a session's activity to an orb state"
```

---

### Task 2: Show the orb where the dot was

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/island/app/components/island.tsx` (the closed bar dot at line ~417, the row dot at line ~469)

**Interfaces:**
- Consumes: `orbState(session: Pick<SessionView, "phase" | "tool">): OrbState | undefined` from `src/orb.ts`; `ThinkingOrb` from `thinking-orbs`.
- Produces: nothing new. Both call sites render either an orb or the existing dot.

- [ ] **Step 1: Install the package**

Run: `npm install thinking-orbs@^0.3.2`
Expected: `package.json` gains `"thinking-orbs": "^0.3.2"` under `dependencies`, and a lockfile entry. Nothing else changes.

- [ ] **Step 2: Wire the opened panel row**

In `src/island/app/components/island.tsx`, in the `Row` component, replace the status dot with an orb when the session is live:

```tsx
{orb ? (
  <ThinkingOrb state={orb} size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
) : (
  <span
    className={cn(
      "mt-1 size-[7px] shrink-0 rounded-full",
      waiting || session.status === "retry" ? "bg-warning" : "bg-success",
    )}
  />
)}
```

where, at the top of `Row`:

```tsx
const orb = orbState(session)
```

`Row` already has `waiting`; the row's own phase is printed in the row text, so the orb is `aria-hidden`.

- [ ] **Step 3: Wire the closed bar**

In `src/island/app/components/island.tsx`, in `Island`, add next to the other derived values:

```tsx
const barOrb = active ? orbState(active) : undefined
```

where `active` is the most recently updated non-idle session. Reuse `latestOf(sessions)`: change `const latest = latestOf(sessions)` to `const active = latestOf(sessions)` and derive `work` from it as today, so the orb and the streamed words point at the same session.

Then replace the bar's dot:

```tsx
{barOrb ? (
  <ThinkingOrb state={barOrb} size={20} className="shrink-0" />
) : (
  <span className={cn("size-[7px] shrink-0 rounded-full transition-colors duration-300", dot)} />
)}
```

The bar keeps the orb's own `aria-label` ("Thinking…", "Working…"): the bar's text is the agent's words, not its status.

- [ ] **Step 4: Add the imports**

At the top of `src/island/app/components/island.tsx`:

```tsx
import { ThinkingOrb } from "thinking-orbs"
import { orbState } from "../../../orb"
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: both bundles build; `dist/island` contains the single HTML file with the orb code inlined.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/island/app/components/island.tsx
git commit -m "feat: show a thinking orb for every live session"
```

---

### Task 3: Look at it

**Files:** none changed.

- [ ] **Step 1: Run the island**

Run: `npm run dev`
Expected: the island window appears on the right edge.

- [ ] **Step 2: Check the closed bar**

Expected: with an agent thinking or running a tool, a 20px orb shows next to the grip in place of the green dot, and the spine text is unchanged. With nothing running, the grey dot is back.

- [ ] **Step 3: Check the opened panel**

Expected: each busy row has an orb in place of its dot; a row waiting on an approval still has the orange dot.

- [ ] **Step 4: Check both themes**

Use the appearance button to switch to light and dark. Expected: the orb's ink follows the panel — dark dots on white, light dots on black.
