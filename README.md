# opencode-island

A macOS Dynamic Island for OpenCode. It docks to the right edge of your screen as
a vertical tab and shows what every session and agent is doing, plus permission
prompts you can answer without switching windows.

- **Closed** it is a thin vertical tab with the status reading down the spine.
  Drag the dotted grip at the top to put it anywhere along the edge, and the
  grip at the bottom to make the bar longer or shorter.
- **Streaming** puts the last ten words the agent is saying in the closed tab,
  live, as they arrive. The expanded island shows the same words under each
  session.
- **Expanded** (click it) lists only the sessions running right now, with
  subagents nested under the session that spawned them, each with its agent,
  what it is doing right now (thinking, writing, working), running tool,
  elapsed time, tokens and cost. Idle sessions stay out of the way.
- **Approvals** turn the whole island warning orange, open it, and can be
  answered in place with Allow once, Always allow or Deny.
- **Bottom bar** switches light, dark or system appearance, turns on
  click-through (everything but the grip stops taking clicks), and shows the
  latest session's work in the closed tab instead of the summary.

Opening and closing animate as a drawer sliding out of the screen edge. The
island never takes focus when it appears, floats above full-screen apps and
every Space, and keeps running after you close the app's windows.

## Install

Requires OpenCode 2.2.7 or newer (the GUI plugin API) on macOS.

```sh
git clone https://github.com/soussihamza/opencode-island
cd opencode-island
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install
npm run build
ln -s "$PWD" ~/.config/opencode/plugins/opencode-island
```

Then restart the desktop app. The island appears on the right edge of the
primary display.

`ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips the ~100 MB Electron binary. This
package only needs Electron's type declarations to build; the app supplies the
runtime.

## Develop

```sh
npm run dev       # build the island once, then watch the plugin bundle
npm run typecheck
npm run check     # the streaming tail helpers
```

Restart the app after changing anything that runs in its main process
(`src/gui.tsx`, `src/window.ts`, `src/model.ts`), and re-run `npm run dev` after
changing the island UI (`src/island/app`).

## How it works

```
src/index.ts        server part: exists so the app discovers the plugin
src/gui.tsx         GUI entry: runs in the app's main process
src/model.ts        the session model, fed by the server's event stream
src/window.ts       the island BrowserWindow (the only file that touches electron)
src/state.ts        the JSON the island renders
src/island/app/     the island UI: React, Tailwind and shadcn components
src/island/preload.cjs  the bridge between the page and the window
```

The island lives in the app's main process rather than in a window, because a
window setup stops when the last app window closes, which is exactly when the
island is most useful. Main also has `ctx.serverEndpoints`, so the island reads
the app's own server directly and sees sessions from every project on the
machine, not just the one a window happens to show.

It subscribes to `session.*` and `permission.*` events, keeps a live model, and
pushes it to the island over IPC. Approval buttons call
`permission.reply({ decision })`.

## Known limits

- macOS only. The window uses `setVisibleOnAllWorkspaces` and a screen-saver
  window level.
- Primary display only; it docks to the right edge and you can slide it up or
  down. Its spot resets when the app restarts.
- The appearance, click-through and latest-work switches reset with the app too;
  they are not persisted yet.
- Creating a `BrowserWindow` directly is off-contract: the GUI API is
  experimental and has no way to make a window of its own. Everything that
  touches raw Electron is in `src/window.ts`, so a future API change is one
  file.
- Clicking a button focuses the island while the click lands. Appearing never
  does, which is the part that matters.
- Sessions untouched for six hours drop out of the list.

## License

MIT
