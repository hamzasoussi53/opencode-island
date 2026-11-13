# The island takes prompts, and it can be resized

## Intent and why

The island is a status display: it floats on the screen edge and shows what every
agent on this machine is doing. Two things it cannot do today make it a place
you have to leave.

**You cannot talk to an agent from it.** You watch a session work, you see it
going the wrong way, and to say "stop, fix the tests first" you have to find the
OpenCode window, find the right tab, and type there. The island already has the
session in front of you; the words you want to say to it are the missing half.

**You cannot make it the size you want.** The open drawer is a fixed 420x240.
If you have four agents running you cannot make the list taller, and if you only
want the drawer for its prompt you cannot make it narrower.

Together these make the island something you watch instead of something you use.
The island should be usable the way a status display with a reply field is
usable: glance, decide, speak, glance again, without ever leaving what you were
doing.

## Goals

- Send a prompt to a running session from the island, without switching to
  OpenCode.
- Send a prompt to a session that has finished, picking it from a list.
- Steer a running session now, or queue the prompt for when the turn ends.
- Resize the open island horizontally and vertically, and keep the size.
- The island never takes focus from the app, and never starts work by accident.

## Non-goals

- Starting a brand new session from the island. That needs an agent and a model
  chosen, and it is a different feature.
- Attaching files to a prompt.
- Editing a session's plan, or anything else about a session, from the island.
- Changing the closed bar's length by dragging the drawer's edge. The bar keeps
  its own share of the screen.

## Anti-goals

- It must be impossible to send a prompt to a session you did not mean to. A
  stray keystroke must never start work.
- The island must never steal focus from the app while you are typing in it.
- Sending a prompt must not be a silent no-op. If it fails, you must see that it
  failed.

## Constraints

- The island window has no access to the plugin SDK. Only `IslandMessage`
  crosses that boundary, as JSON.
- The island's window floats above every window and never takes focus. It uses
  `setAlwaysOnTop`, `showInactive`, and click-through (`setIgnoreMouseEvents`).
  Anything we add must respect that.
- The island window has **one** size today, shared by both states: the closed
  bar's length is a *share of the screen* (10-90%, kept in `localStorage` under
  `opencode-island:share`), and the open drawer is a fixed `420x240`. The two
  features below need different sizes, so the window must hold both.
- The server already has the whole mechanism. `session.prompt({sessionID, text,
  delivery})` takes `delivery` of `"steer"` or `"queue"`. The server promotes a
  steer immediately and a queue only when the running turn ends. There is also
  `session.inbox.list`, `session.inbox.cancel`, `session.inbox.update`, and the
  `session.inbox.enqueued` / `delivered` / `cancelled` / `delivery.changed`
  events on the stream. This change is wiring, not mechanism.
- `delivery` defaults to `"steer"` on the server, so a queued prompt has to be
  asked for by name. The island always says which one it wants.
- The rows the island shows are evicted once a session has been quiet for six
  hours. The list of sessions you can pick from is **not** subject to that
  rule: a session that finished yesterday is exactly the one you want to pick
  today, so the picks list keeps its own longer life.

## Approaches

### How the prompt reaches a session

**A. A text field on every row.** Every running session gets an input under its
name. Direct, but it turns each row into a form, the drawer gets noisy, and a
live field on every row fights the window's click-through and its refusal to
take focus.

**B. One composer at the bottom of the drawer, with a target you pick.** One
field, one place to look. The target is shown on the left of the field, so you
always see where the text will go before you send it.

**C. A composer that opens over the row it belongs to.** Clicking a row's
button opens a small panel with its own field. Keeps the drawer clean, but you
cannot see the other sessions while composing, and the panel has to float
over a 420px drawer.

**Chosen: B.** One field is one thing to learn, and showing the target beside
it is what makes a single field safe. A field on every row would put eight
focusable inputs in a window that is designed never to take focus.

### Where the target comes from

**A. Clicking a row targets it.** Simple for running sessions, but there are no
rows when nothing is running, and the request is explicitly about reaching a
finished session.

**B. A dropdown on the composer listing every session.** The composer has a
target chip; clicking it opens a list of sessions, running and finished, newest
first. One list serves both cases: a running session is in it, and so is a
finished one.

**Chosen: B, with clicking a row as a shortcut.** The dropdown is the complete
way to pick a target; clicking a row is a fast path for the common case, and it
sets the same chip. The two cannot disagree, because there is one piece of
state: the selected session id.

### How the island is resized

**A. Two grips on the drawer edges.** The bottom edge resizes vertically, the
left edge horizontally, both anchored at the top-right corner the island is
pinned to, so the drawer grows away from the screen edge.

**B. One grip on the bottom-right corner.** One target, but the corner is
against the screen edge, where there is little room to grab.

**C. Resize with the keyboard.** Precise but undiscoverable.

**Chosen: A.** It matches how the closed bar's length is already resized, by
dragging an edge. The left edge is the one that is new, and it is the natural
place: the drawer is pinned to the right edge, so its left edge is the free one.

### How the size is kept

**A. In `localStorage`, next to the share.** The drawer keeps a pixel size; the
bar keeps its share. Two separate keys, two separate things.

**Chosen: A.** The bar's length is a fraction of the screen because it follows
the screen. The drawer is a panel of a fixed size, so pixels are right, and the
two are stored apart.

## The change

### `src/state.ts`

The sessions you can pick from are their own thing, not part of the live
state, because they change far less often than it does:

```ts
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

/** Every session the island knows about, running or finished, newest first. */
export type SessionPicks = SessionPick[]

/** A prompt waiting for a session's turn to end. */
export interface QueuedPrompt {
  /** The id the server gave it, so it can be cancelled. */
  id: string
  text: string
}
```

`IslandMessage` does **not** grow a picks field. The picks are sent on their
own channel, only when they change: two hundred sessions is roughly 30KB of
JSON, and the live state is published on every token of every answer. The
island keeps the picks in its own state.

### `src/model.ts`

The model already seeds itself from `client.session.list({limit: 200})` at
startup and keeps idle sessions in its map; it filters them out only when
building the rows. So the island already knows the finished sessions. The
change is to keep that knowledge across the boundary:

- The seed's sessions are kept in a `picks` list, trimmed to `id`, `title`,
  `agent`, `directory`, `status`, `updated`, newest first, and capped at 200.
  This list is **not** evicted with the rows: it keeps a session until the
  session is deleted or falls off the end of the cap.
- `session.created` adds to it; `session.deleted` removes from it;
  `session.renamed` updates the title.
- A new `prompt(sessionID, text, delivery)` method calls
  `client.session.prompt({sessionID, text, delivery})`.
- A new `queued(sessionID)` method calls `client.session.inbox.list({sessionID})`
  and returns the items whose delivery is `"queue"`.

The picks list is seeded once, at startup, and the server's list is not
ordered by recency, so the island sorts it itself. A session started after the
island connected arrives through `session.created`, which is already watched.

**The queue is asked for, not counted.** The island does not keep a running
count of queued prompts per session: the events that would tell it arrive only
for prompts queued while the island is connected, so a count would be wrong for
anything queued before. Instead the queue menu asks the server what is queued
for the session in hand, and shows that. The answer is right for every
session, including one queued before the island started.

### `src/gui.tsx` (the plugin's main half)

- `onPrompt` is wired to the model. The island is told whether the send
  worked: the IPC is a request, and it answers with the result.
- `onQueued` is wired to the model the same way, so the queue menu can ask
  what is waiting for the selected session.
- The window's size now has two parts. The bar keeps its share; the drawer
  keeps its own width and height, and the window is told which one applies
  when the island opens or closes.

### `src/window.ts` and `src/island/preload.cjs`

- New IPC: `opencode-island:prompt` carries `{sessionID, text, delivery}` and
  answers `{ok: true}` or `{ok: false, error}`. The island is the one that
  shows the failure, because the island is where the user is.
- New IPC: `opencode-island:queued` carries a session id and answers with the
  queued prompts, each with the id the server gave it, so one can be cancelled.
- New IPC: `opencode-island:cancel` carries `{sessionID, inboxID}`.
- New IPC for the picks list, sent only when it changes.
- The window holds a `drawer` size beside the bar's `size`, and applies
  whichever the island is currently showing.
- New IPC for the drawer's own resize, mirroring the bar's: the drag reports
  the pointer position and the window does the arithmetic, so the edge follows
  the mouse exactly.

### `src/island/app/components/island.tsx` (the island's window)

- The drawer gets a **composer** at the bottom, below the permission panel and
  above the resize grips, so it is the last thing in the drawer and never
  scrolls out of reach.
- The composer has a **target chip** on the left. It names the selected
  session. Clicking it opens the **session list**: every session the island
  knows, running and finished, newest first, each showing its title, its agent,
  and its project directory's last path segment. The running ones are marked,
  so a finished session is not confused with a live one.
- Clicking a row in the list selects it and closes the list. Clicking a row in
  the session list above does the same, so the fast path and the dropdown are
  the same selection. The selection survives closing and reopening the drawer.
- The text field is a plain input. **Enter steers.** A button beside it opens a
  small menu with *Queue* (send after the current turn) and the prompts
  already queued for this session, each of which can be cancelled.
- **A failed send is shown in the composer.** The text stays in the field and
  a line under it says what went wrong. The island is the only place the user
  is, so the island is where the failure is shown.
- After a successful send the field clears itself. The **keyboard goes back to
  the app**, and the drawer closes the way it closes when you click away,
  unless something is holding it open (a permission waiting for an answer).
  The bar keeps showing the session and its words, so the agent picking the
  prompt up is still visible without a click.
- **The drawer resizes from two grips**: the bottom edge (vertical) and the
  left edge (horizontal). The island keeps one vertical centre, and the drawer
  is centred on it when it opens. Dragging the bottom edge holds the top still
  and grows the drawer downward; on release the island's centre moves to the
  drawer's new centre, so the island stays where it was put. Dragging the left
  edge grows the drawer leftward, because the right edge is the screen edge
  and never moves.
- **The height is the content's height until you drag it.** Today the drawer
  is as tall as its content, between about 110 and 350 pixels, and the session
  list scrolls inside it. That is the feel of the island today, so it stays the
  default. Once the bottom edge is dragged, the drawer keeps the size it was
  given, in `localStorage` under `opencode-island:size`, and the width keeps
  the same way. A dragged height is clamped to 240 up to 80% of the screen; a
  dragged width to 320-640.

### Focus

The island's window is created with `acceptFirstMouse` and never takes focus on
its own. Clicking into the composer focuses the island's window, which is what
a text field needs.

**After a send, the keyboard goes back to the app.** This is a correction to
the shape first agreed, and it is forced by the anti-goals: an island that
keeps the keyboard after a send eats the user's keystrokes, and a stray Enter
in the empty field would send a second prompt. The island gives the keyboard
back by blurring its own window, and the drawer's existing close-on-blur rule
then closes it. The bar remains, showing the session and its words, so the
agent picking the prompt up is still visible.

The one exception is a session waiting on a permission: the island already
stays open for that, and it keeps doing so. A permission is a question the
user has to answer, and the composer is right there to answer it.

A half-typed prompt is lost when you click away. That is deliberate: the island
is a display that also takes messages, and a draft that survives you walking
away is a draft you will send by accident.

To keep a stray keystroke from starting work, the composer only sends on
**Enter**, the field must have text in it, and the target is always shown
beside the field. Nothing is sent by focus alone, by blur, or by a button that
is not the send action.

## The parts of the how the human partner decided

- One composer at the bottom of the drawer, not a field per row.
- The target is shown on the composer, so you always see where the text goes.
- Both **Steer** and **Queue**, because they are different actions: steer
  interrupts the running turn now, queue waits for it to end.
- The island stays where it is and does not open a window, popup or
  notification on a send.
- The closed bar keeps its own share of the screen; the drawer gets its own
  pixel size, kept in `localStorage`.
- Clicking a row selects it, as a shortcut for picking a running session.
- The dropdown lists every session, running and finished, so a finished session
  can be picked and prompted.

## Open questions for the human partner

These came out of the builder's review of this document. The first is a change
to what was agreed, and it needs an answer; the rest are decisions that are
theirs to make.

**1. The keyboard goes back to the app after a send, and the drawer closes.**
This is a correction to the agreed shape, where the island kept focus and the
row updated in place. Keeping the focus is not safe: the user's next
keystrokes would land in the island's empty field, and a stray Enter would
send a second prompt to the same session. Giving the keyboard back means the
drawer's existing close-on-blur rule closes it, so the row is no longer on
screen. The bar keeps showing that session's words, so the agent picking the
prompt up is still visible.

The alternative is to change the close-on-blur rule, so the drawer stays open
when the island gives the keyboard back, and closes only when the user clicks
away on purpose. That keeps the row on screen but changes when the island
disappears, which is a thing people notice.

**2. The drawer's height.** Its height today is the content's height, about
110 to 350 pixels, and the session list scrolls inside it. The plan was for it
to become a fixed 240, which would make it shorter than it is today with four
sessions running and add a scrollbar. The plan is now to keep the
content-driven height as the default, and only fix the height once the bottom
edge is dragged. Is that what you want, or would you rather the drawer open at
a fixed size?

**3. The drawer is centred on the island's vertical centre, as it is today.**
Dragging its bottom edge grows it downward and moves the island's centre to
match. The alternative is that the drawer hangs from the island's top edge and
grows down from there, which keeps the island's centre fixed and means the
drawer's top never moves.

**4. Cancelling a queued prompt cancels one at a time**, the newest first, as
each is offered in the queue menu. The alternative is one button that cancels
all of them.

**5. The session list is a scrolling list, not a search box.** With two
hundred sessions, scrolling is a lot of clicking to reach one from a week ago.
A search field costs a little room in the drawer but finds one in two
keystrokes.

## Left to the builder

- The exact pixel values of the grips and the composer's padding.
- Whether the session list opens above or below the target chip.
- The wording of the buttons.
- How the session list is sorted when two sessions have the same `updated`.
