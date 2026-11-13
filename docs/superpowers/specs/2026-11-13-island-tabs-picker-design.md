# The picker lists the sessions open in OpenCode

The island's composer lets you send a prompt to a session. The picker that
chooses the session should list **the tabs open in OpenCode**, not every
session the island has ever heard of.

## What the server gives us

`Session.Info.time.viewed` is the epoch millis of when a session was last
opened. The server keeps it in the `time_viewed` column of `session_v2`, and
`client.session.list()` returns it in `Session.Info.time.viewed`. The client
type confirms it: `readonly time: { created; updated; busy?; idle?; viewed?;
archived? }`.

A session that has never been opened has no `viewed` at all. That is the
signal: **a session with a `viewed` time is one that has been open in
OpenCode.** The most recently viewed is the one you were last looking at.

`session.viewed` is also a published event on the stream, with the session id
and the idle time, so the server tells us when a session is opened.

## What this changes

- `SessionPick` gains a `viewed` field: the epoch millis of when the session
  was last opened in OpenCode, or undefined when it never was.
- `picks()` returns only the sessions that have been viewed, ordered by
  `viewed` newest first. A session that was never opened is not a tab, so it
  is not offered.
- The picker's rows show the session's title, its agent, and the last segment
  of its project path, in the order the tabs were last used.
- The composer's target resolves against `picks`, so a picked session is one
  the island knows about even when it is no longer running and so is not in
  the live rows.

## Why not the running sessions

The live rows are the sessions working right now. A tab open in OpenCode may
be idle, finished, or waiting for you. That is exactly the session you want
to steer, and it is the one the picker could not reach before.

## Ruling

Ruling: the picker lists viewed sessions, ordered by `viewed` newest first, and
nothing else. Ruling: a session that has never been opened in OpenCode is not
offered, because the request was for the open tabs, not for every session the
server remembers. — Costs: a session created by an agent that never had a tab
opened for it cannot be picked. That is the requested behaviour, and the
running sessions are still reachable by clicking their row.
