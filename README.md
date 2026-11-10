# opencode-island

A macOS Dynamic Island for OpenCode. It sits at the top of your screen and shows
what every session and agent is doing, plus permission prompts you can answer
without switching windows.

- **Contracted** shows one line: `2 agents working · 14s`, `1 approval needed`, `Idle`.
- **Expanded** (click it) lists every session, with subagents nested under the
  session that spawned them, each with its agent, running tool, elapsed time,
  tokens and cost.
- **Approvals** open the island on their own and can be answered in place with
  Allow once, Always allow or Deny.

The island never takes focus when it appears, floats above full-screen apps and
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

Then restart the desktop app. The island appears at the top of the primary
display.

`ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips the ~100 MB Electron binary. This
package only needs Electron's type declarations to build; the app supplies the
runtime.

## Develop

```sh
npm run dev       # rebuild dist/gui-experimental.cjs on change
npm run typecheck
```

Restart the app after changing anything that runs in its main process
(`src/gui.tsx`, `src/window.ts`, `src/model.ts`).

## How it works

```
src/index.ts        server part: exists so the app discovers the plugin
src/gui.tsx         GUI entry: runs in the app's main process
src/model.ts        the session model, fed by the server's event stream
src/window.ts       the island BrowserWindow (the only file that touches electron)
src/state.ts        the JSON the island renders
src/island/*.html   the island itself, inlined into the bundle at build time
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
- Primary display only, and it sits below the menu bar rather than in the notch.
- Creating a `BrowserWindow` directly is off-contract: the GUI API is
  experimental and has no way to make a window of its own. Everything that
  touches raw Electron is in `src/window.ts`, so a future API change is one
  file.
- Clicking a button focuses the island while the click lands. Appearing never
  does, which is the part that matters.
- Sessions untouched for six hours drop out of the list.

## License

MIT
