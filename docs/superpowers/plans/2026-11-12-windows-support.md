# Windows Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The island runs on Windows (10/11, x64 and ARM64) without changing how it behaves on macOS.

**Architecture:** The island is plain Electron running inside the OpenCode desktop app's main process, so it already speaks a language Windows understands. The port is therefore not a rewrite: it is one platform guard in the single file that touches Electron, a CI job that proves the Windows build, and the documentation that says so. The macOS path keeps every call, value and order it has today.

**Tech Stack:** Electron 45 (runtime is the OpenCode desktop app's own), TypeScript, React 19, Tailwind v4, Vite, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-12-windows-support-design.md`

## Global Constraints

- macOS behaviour and code path must not change. Every macOS call in `src/window.ts` keeps its value, its order and its position relative to the other calls.
- The island stays a plugin inside the OpenCode desktop app on every platform. No separate Windows app, no packaging work.
- Windows target: Windows 10 and 11, x64 and ARM64. The OpenCode desktop app must be 2.2.7 or newer for the GUI plugin API.
- The drawer snaps open and closed on Windows (decided). Do not add a page-side animation, and do not remove `animate` from `setBounds` on macOS.
- No new runtime dependencies, and no change to `package-lock.json`.
- Node 20.19 or newer to build from source. CI uses Node 24 because `npm run check` runs a TypeScript file directly and needs type stripping.
- The island never creates, edits or deletes anything on disk outside its own temp directory, on any platform.

## Review Focus

Five conditions the spec implies that no automated test covers, most likely to bite first:

1. **A non-macOS platform.** The island window must be created, shown and interactive on Windows — no crash, no unguarded macOS-only call (`src/window.ts`).
2. **Windows with the taskbar on the right edge.** The island must sit inside the work area, not under the taskbar (the clamp in `place()` in `src/window.ts`).
3. **Windows display scaling (125% / 150%).** The closed bar's length share and the panel height must be measured in the same unit: `screen()` returns DIP, the page reports CSS px, and the two must agree.
4. **Windows click-through.** `setIgnoreMouseEvents(..., { forward: true })` must keep delivering mousemove to the page so the grip stays clickable. If the Windows build does not forward, the grip must still be reachable.
5. **Windows virtual desktops and exclusive full screen.** The island disappears on another virtual desktop and is covered by an exclusive full-screen game. Expected, documented, not a bug to fix.

---

### Task 1: Prove the island runs on Windows before changing anything

**Files:**
- None. This task reads and runs; it writes no code.

**Interfaces:**
- Consumes: the published `opencode-island` package (0.3.0), the OpenCode desktop app for Windows, the OpenCode CLI on Windows.
- Produces: a recorded outcome — the island appears on Windows, or it does not. Task 2 onward is gated on this.

- [ ] **Step 1: Install the OpenCode desktop app on the Windows machine**

Download the Windows build from `https://opencode.ai/download` (x64 or ARM64, matching the machine) and start the app once so it creates its config.

- [ ] **Step 2: Install the OpenCode CLI and the island plugin**

```powershell
npm install -g @opencode/cli
opencode plugin add opencode-island
```

Expected: the plugin is added to the global OpenCode config and the command exits 0.

- [ ] **Step 3: Restart the desktop app and look for the island**

Expected: a thin vertical tab appears on the right edge of the primary display, reading `Idle` or `No sessions`.

- [ ] **Step 4: Record the outcome**

One of three, and this is the gate for the rest of the plan:

- **appears** — the port is a matter of the guard, CI and docs. Continue with Task 2.
- **appears but wrong** — note exactly what is wrong (wrong position, invisible, white rectangle, frozen text) and carry it into Task 5 as a symptom to diagnose.
- **does not appear** — go to Step 5.

- [ ] **Step 5: If the island does not appear, find out why before writing any code**

Open the desktop app's log and look for the two lines the plugin writes (`ctx.log.write` in `src/gui.tsx` and `src/window.ts`): `island connected` and `island shown`.

- **Neither line appears** — the desktop app never ran the plugin's GUI half. The Windows build predates the GUI plugin API, or does not load GUI plugins on Windows. Stop here: this cannot be fixed from this repository. Report the blocker and the app version to the human partner.
- **`island connected` but no `island shown`** — the window was created but the page never reported its size. Capture the app's error output and carry it into Task 5.

---

### Task 2: Make the platform rule explicit in the window

**Files:**
- Modify: `src/window.ts:82-86` (the always-on-top / workspaces block) and the comment above the `BrowserWindow` options (around `src/window.ts:53-79`).
- Modify: `scripts/check.ts` (add one assertion).

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no new exported symbols. `createIslandWindow` keeps its current signature and its current macOS behaviour.

- [ ] **Step 1: Write the failing assertion in `scripts/check.ts`**

Add at the end of `scripts/check.ts`, above the `console.log("ok")`:

```ts
// The Spaces call is macOS only, so it must stay behind a darwin guard, and
// there must be no second, unguarded call site.
const windowSource = readFileSync(new URL("../src/window.ts", import.meta.url), "utf8")
assert.match(
  windowSource,
  /if \(process\.platform === "darwin"\) \{\s*window\.setVisibleOnAllWorkspaces/,
)
assert.equal(windowSource.match(/window\.setVisibleOnAllWorkspaces\(/g)?.length, 1)
```

and add `import { readFileSync } from "node:fs"` to the imports at the top of the file.

- [ ] **Step 2: Run the check and watch it fail**

Run: `npm run check`
Expected: FAIL with an assertion error on the `assert.match` line, because `src/window.ts` has no darwin guard yet.

- [ ] **Step 3: Guard the macOS-only call**

In `src/window.ts`, replace the block:

```ts
  // Float above full-screen apps and every Space, without ever taking focus
  // when it appears.
  window.setAlwaysOnTop(true, "screen-saver")
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
```

with:

```ts
  // Float above full-screen apps and every Space, without ever taking focus
  // when it appears. Spaces are macOS only: Windows hides the island on the
  // virtual desktops it does not belong to, and no Electron API changes that.
  window.setAlwaysOnTop(true, "screen-saver")
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
```

`setAlwaysOnTop` stays where it is and keeps its level: the level is supported on Windows and floats the island above the taskbar there.

- [ ] **Step 4: Say which options are macOS only**

In `src/window.ts`, extend the comment above the `BrowserWindow` options so it reads, in addition to what is there:

```
  // roundedCorners, hiddenInMissionControl and acceptFirstMouse are macOS
  // only; Electron ignores them elsewhere.
```

- [ ] **Step 5: Run the check and watch it pass**

Run: `npm run check`
Expected: `ok`.

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: both pass, no new output beyond the usual.

- [ ] **Step 7: The macOS regression pass, by hand, on this Mac**

Restart the OpenCode desktop app and confirm, in this order:

1. The closed tab appears on the right edge of the primary display.
2. It floats above a full-screen app (put a full-screen app on the current Space; the island must stay visible).
3. It appears on every Space (switch Spaces with a full-screen app open; the island must still be there).
4. Clicking it opens the drawer and it **slides** open, and closing it slides shut — the animation is untouched.
5. The grip drags the tab along the edge; the bottom grip changes the bar's length.

Expected: all five behave exactly as they do today. If any does not, stop and report before committing.

- [ ] **Step 8: Commit**

```bash
git add src/window.ts scripts/check.ts
git commit -m "feat: keep the macOS-only window calls off other platforms"
```

---

### Task 3: Build and check on Windows in CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the existing npm scripts — `npm run typecheck`, `npm run build`, `npm run check` — unchanged.
- Produces: a green/red signal for the Windows build on every push to `main` and every pull request.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  # Every branch, so a feature branch shows the Windows job before it merges.
  push:
  pull_request:

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      # --ignore-scripts skips the ~100 MB Electron binary download; the build
      # only needs Electron's type declarations.
      - run: npm ci --ignore-scripts
      - run: npm run typecheck
      - run: npm run build
      - run: npm run check
```

- [ ] **Step 2: Run the same four commands locally, on this Mac**

Run: `npm ci --ignore-scripts && npm run typecheck && npm run build && npm run check`
Expected: all four pass. This is the exact sequence CI runs, minus the platform.

- [ ] **Step 3: Confirm the Windows build locally, on the Windows machine**

On the Windows machine, from a clone of the branch:

```powershell
npm ci --ignore-scripts
npm run typecheck
npm run build
npm run check
```

Expected: all four pass. If `npm ci --ignore-scripts` fails on Windows, drop the flag and let the Electron binary download — the build does not need it, but a Windows-specific install failure must be found here, not in CI.

- [ ] **Step 4: Push and watch the workflow**

Push the branch and confirm the `build` job is green on both `ubuntu-latest` and `windows-latest`. The Windows job is the one that matters; a red Windows job is the whole point of this task.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build and check the island on macOS and Windows"
```

---

### Task 4: Say macOS and Windows, and document the two gaps

**Files:**
- Modify: `README.md`
- Modify: `package.json` (the `description` and `keywords` fields only)

**Interfaces:**
- Consumes: nothing.
- Produces: the published package's description and the README both name Windows, and the README lists the two Windows limits.

- [ ] **Step 1: Fix the package description**

In `package.json`, change `description` to:

```
"A macOS and Windows Dynamic Island for OpenCode: live status of every session and agent on your machine, plus permission prompts you can answer without leaving your work."
```

and add `"windows"` to `keywords`.

- [ ] **Step 2: Fix the README's opening line**

Change:

```
A macOS **Dynamic Island** for [OpenCode](https://opencode.ai).
```

to:

```
A **Dynamic Island** for [OpenCode](https://opencode.ai), on macOS and Windows.
```

- [ ] **Step 3: Fix the requirements table**

Change the table to:

```
| | |
|---|---|
| macOS | 13 or newer |
| Windows | 10 or newer (x64 or ARM64) |
| OpenCode | 2.2.7 or newer (the GUI plugin API) |
| Node | 20.19 or newer (only if you build from source) |
```

- [ ] **Step 4: Fix the "macOS-only plugin" paragraph**

Change:

```
The island is a macOS-only plugin: it uses an Electron window that floats
above full-screen apps and every Space.
```

to:

```
The island is a plugin: it uses an Electron window that floats above other
apps. On macOS it floats above full-screen apps and every Space too.
```

- [ ] **Step 5: Add the Windows note to the source install**

After the `ln -s` block in "From source", add:

```
On Windows the symlink needs Developer Mode or an elevated shell, and in Git
Bash `ln -s` copies the folder instead, so the plugin stops updating.
`opencode plugin add github:hamzasoussi53/opencode-island` avoids all of it.
```

- [ ] **Step 6: Replace the macOS-only limit with the two Windows limits**

In "Limits", replace:

```
- macOS only, and the primary display only.
```

with:

```
- The primary display only.
- On Windows the island belongs to the virtual desktop it was opened on:
  Windows hides windows that belong to another desktop, and no Electron API
  changes that. A game in exclusive full screen covers the island too; a
  borderless full-screen window does not.
```

- [ ] **Step 6b: Say where the drawer slides and where it snaps**

In "How it works", the sentence about the window animating to the page's size
becomes: the window animates to it as a drawer sliding out of the screen edge
on macOS, and snaps to it on Windows.

In "Develop", the comment on `npm run check` becomes: the streaming tail
helpers and the platform guard.

- [ ] **Step 7: Read the README top to bottom and check nothing else claims macOS only**

Run: `grep -n -i "macos\|mac os" README.md`
Expected: every remaining mention is true of macOS specifically (the macOS requirements row, the macOS install line, the Spaces sentence, the macOS-only option names in "How it works"). Nothing says the island is macOS-only any more.

- [ ] **Step 8: Commit**

```bash
git add README.md package.json
git commit -m "docs: the island runs on macOS and Windows"
```

---

### Task 5: The manual Windows pass

**Files:**
- None. This task runs the island on Windows and records what happens.

**Interfaces:**
- Consumes: the built plugin from Tasks 2 to 4, the OpenCode desktop app on Windows.
- Produces: the recorded result of each check below, and a follow-up task for anything that failed.

- [ ] **Step 1: Install this branch's plugin on the Windows machine**

Build and install from the branch rather than from npm, so the guarded code is what runs:

```powershell
npm ci --ignore-scripts
npm run build
opencode plugin add opencode-island
```

Restart the desktop app.

- [ ] **Step 2: Walk the checklist**

| # | Check | Expected on Windows |
|---|---|---|
| 1 | The closed tab on the right edge of the primary display | Present, reading `Idle` or `No sessions` |
| 2 | Click it | The drawer opens and lists the running sessions. It **snaps** open; that is expected, not a bug |
| 3 | Drag the top grip | The tab slides along the edge and stays where it is left |
| 4 | Drag the bottom grip | The bar grows and shrinks downwards, its top staying put |
| 5 | Click-through toggle | Clicks reach the app underneath; the grip still opens the island (this is Review Focus #4) |
| 6 | An approval | The island turns orange and opens by itself; Allow once / Always allow / Deny answer it in place |
| 7 | The appearance button | Cycles light, dark, system |
| 8 | The taskbar on the right edge, and 125% / 150% scaling | The island stays inside the work area and keeps its size against the screen (Review Focus #2 and #3) |

- [ ] **Step 3: Diagnose anything that failed, from the symptom**

| Symptom | Where to look | Fix |
|---|---|---|
| No island at all | The app's log for `island connected` | Task 1 Step 5: the desktop app did not run the GUI half |
| A white or black rectangle instead of the tab | The transparent window | Set a solid `backgroundColor` on the window instead of `#00000000` |
| The drawer opens but the text is invisible | The page's theme | The island defaults to dark; check `prefers-color-scheme` |
| The grip is not clickable in click-through mode | `setIgnoreMouseEvents(..., { forward: true })` | `forward` is documented for Windows too, but if the build does not deliver it, stop forwarding and poll the cursor position from the main process instead |
| The island flickers while it resizes | The transparent window resizing on every state change | Windows-only Electron quirk; consider `backgroundThrottling: false` (already set) and, failing that, a solid background |

- [ ] **Step 4: Record the result**

Write the outcome of checks 1 to 8 into the pull request or the task thread, with the symptom for anything that failed. Anything left open becomes its own task — it does not ride along in a commit.

- [ ] **Step 5: Fix what failed, then re-run Task 5 from Step 1**
