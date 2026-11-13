# The Island Takes Prompts, and It Can Be Resized Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user send a prompt to a running or finished session from the island, and let the open island be resized horizontally and vertically with the size kept.

**Architecture:** The island's window gains a composer at the bottom of the drawer, one text field that targets one session. The server already has the whole mechanism (`session.prompt` with `delivery: "steer" | "queue"`, and the inbox API), so the work is wiring: the plugin's main half asks the server, the island's window asks the plugin's main half over IPC, and the island draws it. The picks list of sessions to choose from is kept in the model and sent to the island on its own channel, so it does not ride on every token. The drawer's size is kept separately from the closed bar's share of the screen.

**Tech Stack:** Electron 45 (the OpenCode desktop app's own runtime), TypeScript, React 19, Tailwind v4, Vite. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-13-island-prompt-and-resize-design.md`

## Global Constraints

- The island window has no access to the plugin SDK. Only `IslandMessage` crosses that boundary, as JSON.
- The island's window floats above every window and never takes focus on its own. It uses `setAlwaysOnTop`, `showInactive`, and click-through (`setIgnoreMouseEvents`).
- The island window has one size today, shared by both states. The bar's length is a share of the screen (10-90%, kept in `localStorage` under `opencode-island:share`); the open drawer is a fixed 420x240. This change gives the drawer its own pixel size.
- The picks list is sent on its own channel and only when it changes. It must not ride on `IslandMessage`, which is published on every token of every answer.
- The queue is asked for, not counted. `session.inbox.enqueued` only fires for prompts queued while the island is connected, so a count would be wrong for anything queued before.
- `delivery` defaults to `"steer"` on the server, so a queued prompt must be asked for by name.
- The server must support `session.prompt`'s `delivery` and the inbox API. The
  app's own sidecar does: it is version 2.3.0 and its binary carries
  `delivery??"steer"` and the inbox tables. A server without it would take
  the prompt and ignore the delivery, so the *Queue* button would steer
  instead. The island must not pretend a queue is queued when the server
  cannot queue, so the queue menu shows what the server reports and nothing
  more.
- A failed send is shown in the island. The island is where the user is; the app's log is not.
- After a send the keyboard goes back to the app and the drawer closes, unless a permission is holding it open.
- The composer only sends on Enter, and only when the field has text in it. Nothing is sent by focus alone, by blur, or by any other button.
- The drawer's height is the content's height until it is dragged. A dragged height is clamped to 240 up to 80% of the screen; a dragged width to 320-640.
- The closed bar keeps its own share of the screen. Resizing the drawer does not change it.
- The session list is a scrolling list with running sessions first, then finished ones newest first. There is no search box.
- Cancelling a queued prompt cancels one at a time, the newest first.
- Copy in the island is sentence case, no em dashes, no exclamation marks.
- No new runtime dependency, and no change to `package-lock.json`.

## Review Focus

Five input classes or failure modes the spec implies that no task's tests exercise, most likely to bite first:

1. **A prompt sent to a session that is not running.** It must be accepted and start the session, not be rejected because nothing was running.
2. **A prompt sent to a session that does not exist, or one the island has since forgotten.** It must fail visibly in the island, and must not leave the island thinking it was sent.
3. **A send that fails** (the server is gone, the session was deleted, the prompt was empty). The failure must be shown in the composer, and the text must stay in the field.
4. **Two sends in a row to the same session.** The second must not be swallowed by the first, and the second must not be a double send of the first.
5. **A prompt queued before the island started.** The queue menu must show it, because the island asks the server rather than counting events it never saw.

---

### Task 1: The model knows the sessions you can pick from, and can send

**Files:**
- Modify: `src/state.ts` (the new types)
- Modify: `src/model.ts` (the picks list, `prompt`, `queued`)
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/state.ts`: `export interface SessionPick { id: string; title: string; agent: string; directory: string; status: SessionStatus; updated: number }`, `export type SessionPicks = SessionPick[]`, `export interface QueuedPrompt { id: string; text: string }`.
  - `src/model.ts`: the model returns, alongside `IslandState`, a `picks`
    list and four methods:
    - `picks(): SessionPicks` — every session the model knows, newest first.
    - `prompt(sessionID: string, text: string, delivery: "steer" | "queue"): Promise<{ ok: boolean; error?: string }>`
    - `queued(sessionID: string): Promise<QueuedPrompt[]>`
    - `cancel(sessionID: string, inboxID: string): Promise<{ ok: boolean; error?: string }>`
- [ ] **Step 1: Write the failing test**

In `scripts/check.ts`, add the type import and the assertions:

```ts
import type { IslandState, PlanState, SessionPicks } from "../src/state.ts"
```

The model is driven by a fake client. Extend the existing `run` helper in `scripts/check.ts` so it can be given a fake client, not only a fake event stream: the helper takes an optional `client` whose `session.prompt` and `session.inbox.list` are recorded.

```ts
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

// A prompt is sent with the delivery the island asked for.
const sent = await promptOf("s1", "keep going", "queue")
assert.deepEqual(sent, { sessionID: "s1", text: "keep going", delivery: "queue" })

// A send that fails comes back as a failure, not as nothing.
const failed = await promptOf("s1", "keep going", "steer", new Error("no such session"))
assert.equal(failed.ok, false)

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
```

The helpers are small and live in `scripts/check.ts` beside the existing
`run` helper: `picksOf(sessions)` seeds a fake client whose
`session.list` returns the sessions and reads the model's `picks()`;
`promptOf(sessionID, text, delivery, error?)` sends one prompt and returns
what the server was asked for, or the failure; `promptsOf(list)` sends
several and returns them all; `queuedOf(sessionID, items)` returns what the
model makes of an inbox; `cancelOf(sessionID, inboxID)` cancels one and
returns what the server was asked for.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — `picksOf`, `promptOf` and `queuedOf` are not defined.

- [ ] **Step 3: Add the types to `src/state.ts`**

```ts
/** A session you can pick to send a prompt to. */
export interface SessionPick {
  id: string
  title: string
  agent: string
  /** Absolute path of the project the session belongs to. */
  directory: string
  status: SessionStatus
  /** Epoch millis of the last event that touched this session. */
  updated: number
}

/** Every session the island knows about, newest first. */
export type SessionPicks = SessionPick[]

/** A prompt waiting for a session's turn to end. */
export interface QueuedPrompt {
  /** The id the server gave it, so it can be cancelled. */
  id: string
  text: string
}
```

- [ ] **Step 4: Add the picks list, `prompt`, `queued` and `cancel` to `src/model.ts`

Inside `createModel`:

- Keep a `picks` list alongside the `sessions` map. It is seeded from the
  same `client.session.list({limit: 200})` call the model already makes, but
  it is **not** evicted with the rows: a session that finished yesterday is
  the one you want to pick today. `session.created` adds to it,
  `session.deleted` removes from it, `session.renamed` updates its title.
- `picks()` returns the list sorted by `updated`, newest first.
- `prompt(sessionID, text, delivery)` calls
  `client.session.prompt({ sessionID, text, delivery })` and returns
  `{ ok: true }`, or `{ ok: false, error }` when it throws. The message is
  the error's text.
- `queued(sessionID)` calls `client.session.inbox.list({ sessionID })` and
  returns the items whose `delivery` is `"queue"`, trimmed to `{ id, text }`.
  The inbox item's `id` is the id to cancel it with; its `text` is at
  `payload.text` for a user item.
- `cancel(sessionID, inboxID)` calls
  `client.session.inbox.cancel({ sessionID, inboxID })`.
- `prompt` and `cancel` both answer `{ ok: boolean; error?: string }` and
  never throw: the island is where a failure is shown, so the failure has to
  arrive as a value.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run check`
Expected: PASS — prints `ok`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no error.

- [ ] **Step 7: Commit**

```bash
git add src/state.ts src/model.ts scripts/check.ts
git commit -m "feat: the model knows the sessions you can pick, and can send"
```

---

### Task 2: The plugin's main half sends, and the window carries the drawer size

**Files:**
- Modify: `src/window.ts` (the new IPC channels, the drawer size)
- Modify: `src/island/preload.cjs` (the new bridge functions)
- Modify: `src/gui.tsx` (wiring the new callbacks)
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: Task 1's `picks()`, `prompt()` and `queued()` on the model.
- Produces:
  - `src/window.ts`: `IslandWindowOptions` gains
    - `onPrompt: (request: { sessionID: string; text: string; delivery: "steer" | "queue" }) => Promise<{ ok: boolean; error?: string }>`
    - `onQueued: (sessionID: string) => Promise<QueuedPrompt[]>`
    - `onCancel: (request: { sessionID: string; inboxID: string }) => void`
    - `onPicks: (picks: SessionPicks) => void`
    - `onDrawerSize: (size: { width: number; height: number }) => void`
  - `src/island/preload.cjs`: the page gets
    - `prompt(request) => Promise<{ ok: boolean; error?: string }>`
    - `queued(sessionID) => Promise<QueuedPrompt[]>`
    - `cancel(request) => void`
    - `onPicks(handler) => void`
    - `drawerSize(size) => void`
  - `src/gui.tsx`: passes those callbacks into `createIslandWindow`.

- [ ] **Step 1: Write the failing test**

In `scripts/check.ts`, assert the preload exposes the new bridge and that the
window answers a prompt. The window is Electron code, so it cannot be run
here; what can be tested is the preload's surface and the shape of the
messages that cross the channel. Read the preload as text and assert it
exposes each function, the way the existing test reads `src/window.ts` to
assert `skipTaskbar: false`:

```ts
// The island's page can ask for a prompt to be sent, and for the queue.
const preloadSource = readFileSync(new URL("../src/island/preload.cjs", import.meta.url), "utf8")
assert.match(preloadSource, /prompt: \(request\) =>/)
assert.match(preloadSource, /queued: \(sessionID\) =>/)
assert.match(preloadSource, /cancel: \(request\) =>/)
assert.match(preloadSource, /onPicks: \(handler\) =>/)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the preload does not expose `prompt`.

- [ ] **Step 3: Add the bridge functions to `src/island/preload.cjs`**

```js
  prompt: (request) => ipcRenderer.invoke("opencode-island:prompt", request),
  queued: (sessionID) => ipcRenderer.invoke("opencode-island:queued", sessionID),
  cancel: (request) => ipcRenderer.send("opencode-island:cancel", request),
  onPicks: (handler) => ipcRenderer.on("opencode-island:picks", (_event, picks) => handler(picks)),
  drawerSize: (size) => ipcRenderer.send("opencode-island:drawer-size", size),
```

- [ ] **Step 4: Add the channels to `src/window.ts`**

In `createIslandWindow`:

- `opencode-island:prompt` is handled with `ipcMain.handle` and answers
  `options.onPrompt(request)`.
- `opencode-island:queued` is handled with `ipcMain.handle` and answers
  `options.onQueued(sessionID)`.
- `opencode-island:cancel` calls `options.onCancel(request)`.
- `opencode-island:picks` sends the picks list to the page, and
  `opencode-island:drawer-size` records the drawer's size.
- The window keeps the drawer's size beside the bar's `size`, and applies
  whichever the island is currently showing. The drawer's width is clamped to
  320-640, the same ceiling the bar's width already uses, and its height to
  240 up to 80% of the screen's work area height.
- Every listener is removed on dispose, like the ones already there.

- [ ] **Step 5: Wire the callbacks in `src/gui.tsx`**

- `onPrompt` calls `model.prompt(sessionID, text, delivery)` and returns its
  result unchanged.
- `onQueued` calls `model.queued(sessionID)`.
- `onCancel` calls `model.cancel(sessionID, inboxID)`.
- `onPicks` sends the picks list to the page. It is called when the picks
  change, not on every publish: the model exposes `picks()` and the main half
  compares it with the last one it sent, sending only on a change.
- `onDrawerSize` records the size for when the island next opens.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run check` and `npm run typecheck`
Expected: `ok`, and no type error.

- [ ] **Step 7: Commit**

```bash
git add src/window.ts src/island/preload.cjs src/gui.tsx scripts/check.ts
git commit -m "feat: the island's window carries prompts and a drawer size"
```

---

### Task 3: The composer

**Files:**
- Modify: `src/island/app/components/island.tsx` (the composer, the target chip)
- Modify: `src/island/app/island.css` (the composer's own styles)
- Test: `scripts/check.ts` (the island's source is asserted as text, the way the
  existing test asserts `src/window.ts`)

**Interfaces:**
- Consumes: Task 2's `window.island.prompt`, `window.island.queued` and
  `window.island.cancel`.
- Produces: the island's page holds the selected session's id in state, and
  draws the composer. Task 4 picks the session it names.

- [ ] **Step 1: Write the failing test**

The island's UI is a React tree inside a built bundle, so it is checked by
asserting its source, as the existing test does for `src/window.ts`:

```ts
// The composer sends on Enter, and shows a failure in the island.
const islandSource = readFileSync(
  new URL("../src/island/app/components/island.tsx", import.meta.url),
  "utf8",
)
assert.match(islandSource, /onKeyDown/)
assert.match(islandSource, /delivery: "steer"/)
assert.match(islandSource, /delivery: "queue"/)
// The keyboard goes back to the app after a send, so a stray Enter cannot
// send a second prompt.
assert.match(islandSource, /window\.blur\(\)/)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the island has no composer.

- [ ] **Step 3: Draw the composer**

In `src/island/app/components/island.tsx`, add a `Composer` component and
render it at the bottom of the drawer, below the permission panel and above
the footer:

- The **target chip** on the left names the session the prompt will go to.
  Clicking it opens the session picker, which Task 4 fills in. Until a
  session is picked, the chip names the session the island is already
  showing: the running one.
- The **text field** is a plain `input`. Its `onKeyDown` sends when the key is
  `Enter` and the field has text in it, with `delivery: "steer"`.
- A **menu button** beside the field opens a small menu with *Queue* (sends
  with `delivery: "queue"`) and the prompts already queued for this session.
  Each queued prompt is listed with its text and can be cancelled with
  `window.island.cancel({ sessionID, inboxID })`. The queued list is fetched
  with `window.island.queued(sessionID)` when the menu opens, never counted.
- **A failed send is shown in the composer**: the text stays in the field and
  a line under it says `error`. The island is where the user is.
- After a successful send the field clears itself, and the island gives the
  keyboard back to the app with `window.blur()`. The drawer's existing
  close-on-blur rule closes it, unless a permission is holding it open.
- The selected session's id is remembered in the island's own state, so it
  survives the drawer closing and reopening.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run check`
Expected: PASS — prints `ok`.

- [ ] **Step 5: Build and look at it in a real window**

Run: `npm run build`
Expected: the island bundle is built with no error.

Then run the Electron harness at `/tmp/etest/main23.js` (the one that loads
`/tmp/etest/island.html` with a fake state) and check with
`getBoundingClientRect` that the composer sits inside the drawer, that the
target chip names the session, and that the drawer is still one row per
session. The harness's fake state needs a `plan` on its session for the
composer to have a target; the island falls back to the first running
session when no session is selected.

- [ ] **Step 6: Commit**

```bash
git add src/island/app/components/island.tsx src/island/app/island.css scripts/check.ts
git commit -m "feat: the composer sends a prompt to the session in hand"
```

---

### Task 4: The picker, listing the tabs open in OpenCode

**Files:**
- Modify: `src/state.ts` (the pick's `viewed` field)
- Modify: `src/model.ts` (the picks are the viewed sessions, newest first)
- Modify: `src/island/app/components/island.tsx` (the list, the picks channel)
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: Task 2's `window.island.onPicks`, Task 3's composer.
- Produces:
  - `src/state.ts`: `SessionPick` gains `viewed?: number` — the epoch millis
    of when the session was last opened in OpenCode, absent when it never was.
  - `src/model.ts`: `picks(): SessionPicks` returns **only the sessions that
    have been viewed**, ordered by `viewed` newest first.
  - `src/island/app/components/island.tsx`: the island holds the picks list in
    its own state, and the target chip opens a list built from it.

**The design this task implements:** `docs/superpowers/specs/2026-11-13-island-tabs-picker-design.md`

- [ ] **Step 1: Write the failing test**

In `scripts/check.ts`, the picks tests change: a session that has been opened
in OpenCode is a tab and is offered; one that never was, is not.

```ts
// A session opened in OpenCode is a tab, and is offered. One that never was
// opened is not.
const viewed = await picksOf([
  { id: "s1", title: "Older tab", agent: "build", status: "idle", updated: 100, viewed: 100 },
  { id: "s2", title: "Newer tab", agent: "build", status: "busy", updated: 200, viewed: 200 },
  { id: "s3", title: "Never opened", agent: "build", status: "idle", updated: 300 },
])
assert.deepEqual(
  viewed.map((pick) => pick.id),
  ["s2", "s1"],
)
assert.equal(viewed[0]?.viewed, 200)

// The island keeps the picks in its own state, and does not carry them on
// every message.
assert.match(islandSource, /onPicks/)
assert.doesNotMatch(islandSource, /picks:\s*picks/)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the picks are every session, not the opened ones.

- [ ] **Step 3: Give the pick its viewed time**

In `src/state.ts`, `SessionPick` gains:

```ts
  /** Epoch millis of when the session was last opened in OpenCode. */
  viewed?: number
```

- [ ] **Step 4: Make the picks the opened sessions**

In `src/model.ts`, `picks()` returns only the sessions that have a `viewed`
time, ordered by `viewed` newest first. A session that was never opened in
OpenCode is not a tab, so it is not offered.

The seed already reads `Session.Info` from `client.session.list({limit: 200})`,
and `Session.Info.time.viewed` carries the time. The model keeps that time on
the entry so `picks()` can use it, and `session.viewed` on the stream updates
it for a session opened while the island is connected.

- [ ] **Step 5: Draw the list**

In `src/island/app/components/island.tsx`:

- The island subscribes to `window.island.onPicks` and keeps the list in
  its own state. The list does **not** go on `IslandMessage`, which is
  published on every token of every answer.
- The list the target chip opens is the opened sessions, most recently opened
  first, each showing its title, its agent and the last segment of its project
  path. A running one carries a mark so it is never confused with an idle
  one. There is **no search box**: the list is there to pick a session you
  already have open, and a filter field would take the room the composer
  needs.
- Choosing a session sets the same selected id the rows set, so the fast
  path and the list cannot disagree.
- The composer's target resolves a picked id against the **picks**, so a
  session that is open in OpenCode but no longer running can still be sent a
  prompt. The rows are the live sessions; the picks are the tabs.
- The list is drawn above the target chip, so it does not push the composer
  out of the drawer.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run check` and `npm run typecheck`
Expected: `ok`, and no type error.

- [ ] **Step 7: Look at it in a real window**

Run: `npm run build`, then copy `dist/island/index.html` to
`/tmp/etest/island.html` and run
`cd /tmp/etest && /tmp/e45/Electron.app/Contents/MacOS/Electron main-composer.js`.

The stub bridge must send two sessions with a `viewed` time, one opened more
recently, and the harness must show the picker opening with both, in the
order they were opened.

- [ ] **Step 8: Commit**

```bash
git add src/state.ts src/model.ts src/island/app/components/island.tsx scripts/check.ts
git commit -m "feat: the picker lists the sessions open in OpenCode"
```

---


### Task 5: The drawer resizes, and keeps its size

**Files:**
- Modify: `src/window.ts` (the drawer's size, the grips' arithmetic)
- Modify: `src/island/app/components/island.tsx` (the grips, the saved size)
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: Task 2's `window.island.drawerSize`.
- Produces: the drawer's size is kept in `localStorage` under
  `opencode-island:size`, as `"width x height"`.

- [ ] **Step 1: Write the failing test**

```ts
// The drawer keeps its own size, apart from the bar's share of the screen.
assert.match(islandSource, /opencode-island:size/)
assert.match(islandSource, /drawerSize/)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the drawer has no grips and no saved size.

- [ ] **Step 3: Draw the grips and save the size**

In `src/island/app/components/island.tsx`:

- The open drawer has two grips: the **bottom edge** (vertical) and the
  **left edge** (horizontal). Each is a thin strip on the edge, drawn only
  while the drawer is open.
- Dragging the bottom edge holds the top still and grows the drawer
  downward. Dragging the left edge grows the drawer leftward, because the
  right edge is the screen edge and never moves.
- The drag reports the pointer's screen position to the window, which does
  the arithmetic, so the edge follows the mouse exactly. This is the same
  shape as the closed bar's length drag already in the file.
- On release the drawer reports its size with `window.island.drawerSize(...)`
  and keeps it in `localStorage` under `opencode-island:size` as
  `"width x height"`. On the next open the drawer uses that size.
- **Until it is dragged, the drawer's height is the content's height**, as it
  is today: the drawer is 110 to 350 pixels tall and the session list scrolls
  inside it. A dragged height is clamped to 240 up to 80% of the screen; a
  dragged width to 320-640.

In `src/window.ts`:

- The window keeps the drawer's size beside the bar's `size`, and applies
  whichever the island is currently showing.
- When the drawer's bottom edge is dragged, its top holds still and the
  island's vertical centre moves to the drawer's new centre on release, so
  the island stays where it was put.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run check` and `npm run typecheck`
Expected: `ok`, and no type error.

- [ ] **Step 5: Build and look at it in a real window**

Run: `npm run build`
Expected: the island bundle is built with no error.

Then run the Electron harness at `/tmp/etest/main23.js` and check with
`getBoundingClientRect` that dragging the left edge grows the drawer
leftward and that the drawer stays inside the screen.

- [ ] **Step 6: Commit**

```bash
git add src/window.ts src/island/app/components/island.tsx scripts/check.ts
git commit -m "feat: the open island resizes, and keeps its size"
```

---

### Task 6: The drawer stays open until you close it

**Files:**
- Modify: `src/state.ts` (the auto-close mode)
- Modify: `src/island/app/components/island.tsx` (the toggle, the saved setting)
- Modify: `src/island/app/global.d.ts` (the bridge's types)
- Modify: `src/island/preload.cjs` (the bridge)
- Modify: `src/window.ts` (the channel, the key that closes the drawer)
- Modify: `src/gui.tsx` (the blur rule)
- Test: `scripts/check.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/state.ts`: `export type AutoClose = "close" | "stay"`.
  - `src/island/app/global.d.ts` and `src/island/preload.cjs`: the page gets
    `autoClose(mode: AutoClose) => void` and
    `onAutoClose(handler: (mode: AutoClose) => void) => void`.
  - `src/island/app/components/island.tsx`: the setting is kept in
    `localStorage` under `opencode-island:auto-close`, as `"close"` or
    `"stay"`, defaulting to `"stay"`.
  - `src/gui.tsx`: `onBlur` closes the drawer only when the mode is
    `"close"`.

**The design this task implements:** `docs/superpowers/specs/2026-11-13-island-stays-open-design.md`

- [ ] **Step 1: Write the failing test**

```ts
// The drawer stays open by default, and the toggle turns the old behaviour
// back on.
assert.match(islandSource, /opencode-island:auto-close/)
assert.match(islandSource, /autoClose/)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run check`
Expected: FAIL — the island has no auto-close setting.

- [ ] **Step 3: Add the mode and the bridge**

In `src/state.ts`:

```ts
/** Whether the open drawer closes when the app takes the focus back. */
export type AutoClose = "close" | "stay"
```

In `src/island/app/global.d.ts` and `src/island/preload.cjs`, add
`autoClose(mode)` and `onAutoClose(handler)`.

- [ ] **Step 4: Draw the toggle and keep the setting**

In `src/island/app/components/island.tsx`:

- The drawer's footer gains a **toggle** next to the other controls, next to
  click-through, which is the closest thing to it: both are about how the
  island behaves rather than what it shows.
- The toggle reads **Auto-close** when the drawer will close on blur, and
  **Stay open** when it will not. Its pressed state shows which.
- The setting is kept in `localStorage` under `opencode-island:auto-close`,
  as `"close"` or `"stay"`. **The default is `"stay"`**: the drawer stays
  open until it is closed, which is the new behaviour.
- The island tells the plugin's main half when the setting changes, so the
  main half's blur rule knows what to do.
- **Escape closes the drawer.** The drawer no longer closes on blur, so it
  needs a way to close that does not depend on the island having focus.

- [ ] **Step 5: Change the blur rule**

In `src/gui.tsx`, `onBlur` closes the drawer only when the mode is
`"close"`. A session waiting on a permission still keeps it open either way.

In `src/window.ts`, the window carries the mode, hands it over, and closes
the drawer on Escape.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run check` and `npm run typecheck`
Expected: `ok`, and no type error.

- [ ] **Step 7: Build and look at it in a real window**

Run: `npm run build`, then copy `dist/island/index.html` to
`/tmp/etest/island.html` and run
`cd /tmp/etest && /tmp/e45/Electron.app/Contents/MacOS/Electron main-composer.js`.

The harness must show the toggle in the footer, and the drawer must still be
open after the page loses focus.

- [ ] **Step 8: Commit**

```bash
git add src/state.ts src/island/app/components/island.tsx src/island/app/global.d.ts src/island/preload.cjs src/window.ts src/gui.tsx scripts/check.ts
git commit -m "feat: the open island stays open until you close it"
```

---


### Task 7: The docs, and the ship

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the release.

- [ ] **Step 1: Document the composer and the resize in `README.md`**

In the section that describes the expanded island, say that the island has a
composer at its foot: it names the session it will talk to, Enter sends the
prompt and steers the session now, and the menu beside it sends the prompt
after the current turn ends, and lists what is already waiting. Say that the
session is picked from a list that holds the running sessions and the
finished ones, so a session that has ended can be talked to again.

Say that the open island can be resized from its bottom and left edges, and
that it keeps the size.

- [ ] **Step 2: Run everything**

Run: `npm run typecheck && npm run check && npm run build`
Expected: no type error, `ok` from the check, and a built island bundle.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: the island takes prompts, and it resizes"
```

- [ ] **Step 4: Ship**

Bump the version in `package.json`, commit, push the branch and the tag,
publish to npm, create the GitHub release with the notes on what the
composer is and how the drawer resizes, and publish the landing page with
`sh scripts/pages.sh`. Then follow `AGENTS.md`: post the release on X, mirror
the OpenCode profile, and post the release on opencode.cafe.
