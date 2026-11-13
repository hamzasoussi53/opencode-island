# The island stays open until you close it

## Intent and why

The island's drawer closes the moment it loses focus. That was right when the
drawer was a status list: you looked, you went back to your work, it got out
of the way.

It stops being right when the drawer holds a composer. You type a prompt into
it, press Enter, and the island takes the keyboard back — and the drawer closes
with it, because losing focus is what the island has always done on blur. The
prompt is sent, the agent starts working, and the thing you were watching is
gone. You have to click the island again to see the row pick it up.

The drawer is where you talk to your agents now. Clicking away to write a
line of code should not take it away.

## Goals

- An open drawer stays open when the app takes focus, when you click away, and
  when you change desktops.
- The drawer still closes when you close it: the same control that opens it,
  or Escape.
- The old behaviour stays one click away, for anyone who wants the island out
  of the way.
- The choice is remembered.

## Non-goals

- The **closed bar** is unchanged. It is the small thing on the edge; the
  drawer is the panel that holds a composer.
- A session waiting on a permission still keeps the drawer open. That rule
  already exists and does not change.

## Anti-goals

- The drawer must never trap the user. There must always be a way to close it
  that does not depend on clicking the island.
- The island must not steal focus to keep itself open.

## Constraints

- The island's window floats above every window and never takes focus on its
  own (`setAlwaysOnTop`, `showInactive`). It closes on blur today, in
  `src/gui.tsx`'s `onBlur`.
- The island's own controls live in the drawer's footer: appearance, open
  OpenCode, close everything, click-through, show latest work. A toggle
  belongs there.
- The island's page keeps its settings in `localStorage`
  (`opencode-island:share` for the bar's length). A new setting follows the
  same pattern.

## Approaches

**A. The drawer never closes on blur.** Simple, and it loses the old
behaviour entirely: anyone who wants the island out of the way has no way to
get it.

**B. A toggle in the controls, with auto-close off by default.** The drawer
stays open by default, and a control in the footer turns the old behaviour
back on. The setting is remembered.

**C. A timeout: the drawer closes a few seconds after you click away.** It
still disappears on its own, which is the thing you asked it not to do.

**Chosen: B.** It gives the behaviour you asked for, and it keeps the old one
reachable for anyone who wants it. A toggle in the controls is where the
island's other settings already live, so it costs nothing in surprise.

## The change

### `src/island/app/components/island.tsx` (the island's window)

- The drawer's footer gains a **toggle** next to the other controls, next to
  click-through, which is the closest thing to it: both are about how the
  island behaves rather than what it shows.
- The toggle reads **Auto-close** when the drawer will close on blur, and
  **Stay open** when it will not. Pressed state shows which.
- The setting is kept in `localStorage` under `opencode-island:auto-close`,
  as `"close"` or `"stay"`. **The default is `"stay"`**: the drawer stays
  open, which is the new behaviour.
- The island tells the plugin's main half when the setting changes, so the
  main half's blur rule knows what to do.

### `src/island/app/global.d.ts` and `src/island/preload.cjs`

- The page gets `window.island.autoClose(mode)` and
  `window.island.onAutoClose(handler)`, carrying `"close"` or `"stay"`.

### `src/window.ts` and `src/gui.tsx` (the plugin's main half)

- The window carries the mode and hands it over.
- `gui.tsx`'s `onBlur` closes the drawer only when the mode is `"close"`.
  A session waiting on a permission still keeps it open either way.

### Closing the drawer when it stays open

Because the drawer no longer closes on blur, it needs a way to close that
does not depend on the island having focus:

- The **same control that opens it closes it**: clicking the island toggles it,
  as it does today.
- **Escape** closes it. The island's window can listen for the key, and the
  page can handle it, so the drawer closes the way a panel closes.

## The parts of the how the human partner decided

- Auto-close is **off by default**, so the drawer stays open until it is
  closed.
- The old behaviour is one toggle away, in the drawer's controls.
- The closed bar is untouched.

## Left to the builder

- The wording and the order of the toggle in the footer.
- Whether Escape is handled in the page or in the window.
