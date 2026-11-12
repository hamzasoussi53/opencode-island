# Windows support

## Intent and why

The island is Electron and the OpenCode desktop app ships Windows builds, so
there is no reason for the island to be macOS-only. The goal is the same island
on Windows, with the macOS behaviour untouched.

## Goals

- The island runs on Windows: floats on the right edge of the primary display,
  never takes focus when it appears, drags and resizes, answers approvals in
  place, and keeps its click-through grip.
- macOS keeps the exact code path and the exact behaviour it has today.
- A Windows-only build break is caught before a release, not after.

## Non-goals

- The drawer sliding on Windows. It snaps open and closed (see Approaches).
- Floating above Windows virtual desktops.
- Floating above exclusive-fullscreen apps (games).
- Linux.
- Shipping the island as its own app. It stays a plugin inside the OpenCode
  desktop app, on every platform.

## Constraints

- `src/window.ts` is the only file that touches Electron. Everything else —
  model, state, the island UI, the IPC contract — is platform-agnostic, so the
  blast radius of this change is one file.
- The plugin runs in the OpenCode desktop app's main process on every platform.
  The Windows desktop build (x64 and ARM64) has to be new enough for the GUI
  plugin API (OpenCode 2.2.7+). Not verifiable from a Mac; to be confirmed on
  the Windows machine.
- Electron's own platform rules, which decide what needs a guard:
  - `setVisibleOnAllWorkspaces` does nothing on Windows.
  - `setBounds(bounds, animate)` animates only on macOS.
  - `roundedCorners`, `hiddenInMissionControl` and `acceptFirstMouse` are
    macOS-only options; Electron ignores them elsewhere without erroring.
  - `setAlwaysOnTop(flag, level)`, `showInactive()`, `setIgnoreMouseEvents(...,
    { forward: true })` and `screen.getPrimaryDisplay().workArea` all work on
    Windows, so the float, the focus behaviour and the click-through grip need
    no change.

## Approaches

- **A. Minimal port, macOS path untouched (chosen).** Guard the one macOS-only
  call, let the Windows drawer snap, document the two gaps, add a Windows CI
  job. The macOS file changes by one `if` and a comment.
- **B. Unify the animation in the page.** Move the slide into the island UI (a
  CSS width transition, so the page reports intermediate widths and the window
  resizes progressively). Windows would slide too, but macOS would animate
  differently than today, which is exactly what we said we would not do.
- **C. A native helper to pin the island to all Windows virtual desktops.**
  Needs native code for one gap. Rejected.

## The change

### `src/window.ts`

- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` runs only on
  darwin. On Windows it is a no-op today; the guard documents that instead of
  relying on it.
- `setBounds(bounds, animate)` is left alone. On macOS the drawer still slides;
  on Windows the `animate` flag is ignored and the drawer snaps.
- The macOS-only options (`roundedCorners`, `hiddenInMissionControl`,
  `acceptFirstMouse`) stay as they are, with a comment saying they are macOS
  only and ignored elsewhere.

Nothing else in the plugin changes.

### CI

A GitHub Actions workflow with `macos-latest` and `windows-latest` jobs that
run `npm ci --ignore-scripts` (the Electron binary download is not needed to
build), `npm run typecheck`, `npm run build` and `npm run check`. It runs on
every branch push and every pull request, so a feature branch shows the
Windows job before it merges. The repo has no CI today, so this is the first
workflow. Node 24, because `npm run check` runs a TypeScript file directly and
needs type stripping.

### Docs

- README: the requirements table becomes macOS 13+ or Windows 10+, the
  "macOS-only" claims become "macOS and Windows", the source install notes that
  the `ln -s` symlink needs Developer Mode on Windows (and points at
  `opencode plugin add`, which works everywhere), and the two Windows limits
  are listed under Limits.
- `package.json`: the description and keywords stop saying macOS only.

### Verification on a Windows machine

The code will build and typecheck on Windows either way; only running it
confirms it floats. A short manual checklist goes with the change:

1. `opencode plugin add opencode-island`, restart the desktop app: the closed
   tab appears on the right edge of the primary display.
2. Click it: the drawer opens (it snaps, that is expected on Windows) and the
   running sessions are listed.
3. Drag the top grip: the tab slides along the edge and stays where it is left.
4. Drag the bottom grip: the bar grows and shrinks downwards, top edge fixed.
5. Click-through toggle: clicks pass through to the app under, and the grip
   still opens the island.
6. An approval turns the island orange, opens it by itself, and
   Allow once / Always allow / Deny answer it in place.
7. The appearance button cycles light, dark, system.

If the transparent window flickers while it resizes on Windows (a known
Electron quirk on that platform), the fallback is a solid background colour
instead of a transparent one.

## Risks

- The Windows desktop build of OpenCode may lag behind the GUI plugin API. If
  the island does not appear at all, that is the first thing to check.
- Windows-only Electron quirks that a Mac cannot reproduce (transparent
  resize flicker, focus rules around topmost windows) will only surface in the
  manual pass.
- Windows hides windows that belong to another virtual desktop, and
  always-on-top does not change that. The island will disappear when the user
  switches virtual desktop. There is no Electron API for it; the only workarounds
  are the shell's `IVirtualDesktopManager` COM interface (native code) or the
  user right-clicking the island in Task View.

## Out of scope, on purpose

- The Windows drawer sliding (Approach B).
- Pinning the island to all virtual desktops (Approach C).
- Exclusive-fullscreen games.
- Linux.
