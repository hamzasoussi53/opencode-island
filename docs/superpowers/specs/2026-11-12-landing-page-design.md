# Landing page for opencode-island

## Intent

The README is a fine README. It is not a landing page. A link in a tweet has
one job: make someone want the thing. The page has to show the island, not
describe it, and end with the install command.

## Goals

- Show the island working, live, on the page.
- One command to install, copyable.
- A URL worth putting in a tweet: `https://hamzasoussi53.github.io/opencode-island/`
- Dark, quiet, macOS-native. The product is a black pill on a screen edge;
  the page should look like it belongs to the same world.

## Non-goals

- No build step for the page itself: plain HTML, CSS and a little JS.
- No second repo, no framework, no analytics, no cookie banner.
- Not a documentation site. One page, then the README for the details.

## Approaches

1. **The real island in a frame (chosen).** The page embeds the built island
   (`dist/island/index.html`) in an iframe, with a small stub injected at
   deploy time that feeds it fake sessions. The demo is the actual plugin —
   the real orbs, the real streaming text, the real styles — so it cannot
   drift from the product. Cost: the deploy workflow builds the plugin and
   injects the stub.
2. **A CSS replica of the island on the page.** No build, no iframe, fully in
   our control — but it is a drawing of the product, and it can drift.
3. **A screenshot and a video.** Honest and simple, but the thing we are
   selling is motion.

## The design

- `docs/index.html` — the page. `docs/site.css` — its styles.
  `docs/island/index.html` — generated at deploy time, not committed.
- `scripts/site.mjs` — reads `dist/island/index.html`, injects a demo stub
  (fake sessions, cycling between a normal island and an approval waiting),
  writes `docs/island/index.html`.
- `.github/workflows/pages.yml` — on push to `main`: install, build, run the
  site script, deploy `docs/` with `actions/deploy-pages`.
- The page:
  - **Hero** — the name, one line on what it is, the install command with a
    copy button, and the island live on the right edge of a mock screen.
  - **Three blocks** — every session on the screen edge; thinking orbs; and
    approvals answered in place.
  - **Install** — the two ways: the CLI, and from source.
  - **Footer** — GitHub, npm, X, MIT.
- The demo cycles: normal island, then an approval waiting (the island turns
  orange), then back.
- Type is the system stack, like the app. One accent each for green
  (working) and orange (approval). No gradients, no glow, no emoji.

## After the page is live

- Set the repo's homepage to the page URL.
- Point the README at it and keep the GitHub link too.
- Use the page URL, not the repo link, in the tweet.
