# The island can be turned off

The island floats above every window on the screen, and there is no way to take
it away. Sometimes the user wants it gone: a presentation, a recording, a game,
a screenshot. Today the only way out is to remove the plugin and start OpenCode
again.

The island should have a switch that turns it off, and a way to turn it back on
that works while the island is not there.

## What "off" means

Off means the island window does not exist. Not a hidden window: the Electron
window is destroyed, exactly as it is when the app's last window closes. So off
costs nothing — no renderer, no page, nothing on the screen to click through.

The plugin keeps following the app's server while it is off, so turning it back
on shows the sessions as they are now, not as they were when it was turned off.

The off state is kept in the app's own plugin storage, so it survives a restart
of OpenCode. A switch that resets when the app restarts is not a switch. The
island's other switches stay as they are today: remembered for the session
only.

## The controls

Two, and only two:

1. **In the island's bottom bar**, next to the other switches: an eye-slash
   button, "Turn the island off". Pressing it turns the island off and the
   island is gone at once.
2. **In the OpenCode app menu** (macOS: the app menu; Windows: the in-app
   menu): two items, `Show island` and `Hide island`. This is the way back,
   because the island itself is gone while it is off.

The native macOS menu is built once, at startup, so its labels cannot follow
the state. The one thing it does re-read is `enabled`, every time it opens —
but it does not reach the items a plugin adds, so an item that is greyed out
there stays greyed out. A menu that can leave the only way back greyed out
is worse than a menu that says nothing about the state, so both items are
always live: `Show island` brings the island back (or opens its list if it is
already there) and `Hide island` turns it off. Whether the island is on is
said by the island itself: it is on the screen, or it is not.

## Why the app menu

The way back is the whole problem: the island window is the only surface this
plugin has, so turning it off takes that surface with it.

- **The app menu** (chosen): it is already there, on every platform, and it
  costs no new surface. No icon to draw, no key to remember, no new window.
- **The command palette**: a command with a keybind is nice, but it needs a
  window setup and a channel between the window and the main half, for a
  switch that is used twice a year.
- **A global shortcut**: the least code of all, and invisible. The user has to
  know the key.
- **A shrinking sliver**: the island would stay on the screen, which is the
  thing the user was trying to get rid of.
- **A tray icon**: a permanent new item in the user's menu bar, for a switch
  that is mostly off.

## What this changes

- `src/gui.tsx`: the flag comes from `ctx.storage.store("enabled", { schema:
  Schema.Boolean, initial: true })`. `sync()` creates the island only when the
  flag is on, and the two menu items flip it and call `sync()` again. A new
  `onHide` from the island turns the flag off and destroys the window.
- `src/lifecycle.ts`: `islandShouldExist` takes the flag as well, so the rule
  "the island exists while OpenCode has a window and the user has not turned
  it off" stays in one place, and `scripts/check.ts` can say so.
- `src/window.ts`, `src/island/preload.cjs`,
  `src/island/app/global.d.ts`: one channel, `hide`.
- `src/island/app/components/island.tsx`: the button in the bottom bar.
- `package.json`: `effect`, for `Schema.Boolean`. The app provides `effect` to
  the plugin's GUI bundle, so the import stays external and the app's own
  instance is used.

## Not doing

- No keybind, no tray icon, no command in the palette.
- The island does not stop following the server while it is off.
- The closed tab does not get the button: the bottom bar is where the switches
  live, and the drawer is one click away.
- The island's other switches are untouched.

## Ruling

Ruling: the island is turned off by destroying its window, the off state is
kept in the app's plugin storage so it survives a restart, and the way back is
two always-live items in the OpenCode app menu, `Show island` and `Hide
island`, which never grey each other out. — Costs: the menu does not say
whether the island is on, and the island's own button says where it is. A
menu that can leave the only way back greyed out is worse.
