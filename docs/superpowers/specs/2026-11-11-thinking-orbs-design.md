# Thinking orbs in the island

## Intent

The island says what your agents are doing, but it says it with a 7px colored dot.
A green dot means "something is busy"; it cannot tell you that this one is
searching the web and that one is writing code.

[Thinking orbs](https://libraries.dev/orbs) (`thinking-orbs`, MIT) are small dotted
3D orbs on a 2D canvas with nine hand-tuned states. Each live session gets one,
so the closed bar and the opened panel show what is actually happening.

## Goals

- A session that is thinking, writing or running a tool shows an orb, not a dot,
  in the closed bar and in the opened panel.
- The orb names the activity: thinking, writing, searching, running code.
- One dependency, no build changes, correct in light and dark.

## Non-goals

- No orb for an idle session, and none for a session waiting on an approval:
  those keep the plain dot, so the orange warning signal stays a dot.
- No cursor gravity, no 64px avatars, no Studio tuning. Free options only.
- No change on the plugin side (main process, model, state). The data is already
  there.

## Constraints

- `thinking-orbs` is a React component; the island app is React 19, so it fits.
  The app is bundled with `vite-plugin-singlefile`, so the canvas ships inside
  the single HTML file with nothing else to configure.
- `theme="auto"` resolves from an ancestor `data-theme` attribute, which the
  island shell already sets to `dark` or `light`. Light and dark need no extra
  work.
- The closed bar is 36px wide with 8px of side padding, so a 20px orb fits the
  same column as the 20px grip handle.
- The orb paints continuously. One orb per live row, never one per idle row.

## Approaches

1. **Tool-aware mapping (chosen).** Phase sets the base state, the running tool
   refines it: `thinking → breathing`, `writing → composing`,
   `retrying → solving`, and while `working`: search, grep and fetch tools →
   `searching`, bash → `solving`, edit and write → `composing`, a spawned
   subagent → `weaving`, anything else → `working`. The model already knows the
   tool name, so a web search and a shell command stop looking identical.
2. **Phase-only mapping.** Four states, one fewer decision, but every tool run
   looks the same.
3. **One state.** Always `working`. Cheapest, and throws away the point of nine
   tuned states.

## The design

- New `src/island/app/components/orb.tsx`: the mapping from a session to an orb
  state, and a small `Orb` component that renders `ThinkingOrb` at `size={20}`
  with the island's theme.
- Closed bar (`island.tsx`, the dot next to the grip): the dot becomes an orb
  when the top active session is live. The top session is the same one the
  streamed words come from. Idle and approval keep the dot.
- Opened panel (`island.tsx`, the dot at the head of each row): the same rule,
  per row. A row waiting on an approval keeps the orange dot.
- Accessibility: the row orb is `aria-hidden`, because the row already prints
  its phase in text. The closed bar orb keeps its own `aria-label`, since the
  bar's text is the agent's words rather than its status.

## Left to the builder

- Install `thinking-orbs`.
- Add the wrapper and wire the two spots.
- `npm run typecheck` and `npm run build`.
- Look at the island in both themes, closed and open.
