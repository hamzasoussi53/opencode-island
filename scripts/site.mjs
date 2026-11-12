/**
 * Builds the landing page's demo island.
 *
 * The page shows the real plugin, not a picture of it: the built island is
 * copied into docs/island/ with a small stub that feeds it fake sessions.
 * The stub is what the island's preload would have provided.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const source = join(root, "dist", "island", "index.html")
const target = join(root, "docs", "island", "index.html")

/** The stub that stands in for the Electron preload bridge. */
const stub = `<script>
(function () {
  var q = new URLSearchParams(location.search)
  var now = Date.now()
  var sessions = []
  var send = function () {}

  function session(over) {
    return Object.assign({
      id: Math.random().toString(),
      title: "",
      agent: "",
      directory: "/tmp",
      status: "busy",
      phase: "working",
      cost: 0,
      tokens: 0,
      updated: now,
      created: now - 60000,
    }, over)
  }

  var answers = [
    "let me look at the token refresh path in the session store",
    "it rotates the credentials every thirty minutes",
    "so the cache is the thing that goes stale first",
    "I will move the rotation into the refresh call",
    "that keeps the session store free of stale keys",
    "now the tests, then the changelog entry",
  ]

  var step = 0
  var words = answers[0]

  function build() {
    var waiting = q.get("demo") === "approval"
    sessions = [
      session({
        id: "one",
        title: "Refactor the token refresh",
        agent: "build",
        phase: waiting ? "waiting" : "thinking",
        stream: words,
      }),
      session({
        id: "two",
        title: "Find the timeout config",
        phase: "working",
        tool: "grep",
        updated: now - 1000,
      }),
      session({
        id: "three",
        parentID: "one",
        title: "Explore the session store",
        phase: "working",
        tool: "read",
        updated: now - 2000,
      }),
      session({
        id: "four",
        title: "Write the changelog entry",
        phase: "writing",
        stream: "and that is why it went stale",
        updated: now - 3000,
      }),
    ]
    if (waiting) {
      sessions[0].permission = {
        id: "p1",
        sessionID: "one",
        action: "Run the migration",
        resources: ["src/model.ts"],
      }
    }
    return {
      sessions: sessions,
      working: waiting ? 3 : 4,
      waiting: waiting ? 1 : 0,
      // The drawer is 420px wide, so it only opens where it fits.
      open: (q.get("demo") === "open" || waiting) && window.innerWidth >= 460,
    }
  }

  window.island = {
    ready: function () {},
    size: function () {},
    toggle: function () {},
    reply: function () {},
    dragStart: function () {},
    dragEnd: function () {},
    ignore: function () {},
    resizeStart: function () {},
    resize: function () {},
    resizeEnd: function () {},
    screen: function () { return Promise.resolve({ width: 1920, height: 1200 }) },
    onState: function (handler) {
      send = handler
      handler(build())
      // The answer keeps arriving, the way it does while an agent talks.
      setInterval(function () {
        step = (step + 1) % answers.length
        words = answers[step]
        send(build())
      }, 2600)
    },
  }
})()
</script>`

const html = await readFile(source, "utf8")
await mkdir(dirname(target), { recursive: true })
await writeFile(target, html.replace("<head>", "<head>" + stub))
console.log(`demo island written to ${target}`)
