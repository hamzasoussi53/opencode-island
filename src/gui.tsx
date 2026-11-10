import { OpenCode } from "@opencode/client"
import { Plugin } from "@opencode/plugin/gui"
import { createModel } from "./model"
import { createIslandWindow } from "./window"
import type { IslandMessage, IslandState } from "./state"

/**
 * The island lives in the desktop app's main process, not in a window.
 *
 * A window setup would stop when the last app window closes, which is exactly
 * when the island is most useful. Main also has `serverEndpoints`, so the
 * island can read the app's own server directly and sees sessions from every
 * project on the machine.
 */
export default Plugin.define({
  main(ctx) {
    let state: IslandState = { sessions: [], working: 0, waiting: 0 }
    let open = false
    let lastWaiting = 0
    let model: ReturnType<typeof createModel> | undefined
    let controller: AbortController | undefined
    let connected = ""

    const message = (): IslandMessage => ({ ...state, open })

    const island = createIslandWindow({
      log: (level, text, data) => ctx.log.write(level, text, data),
      onReady: () => island.send(message()),
      onToggle: () => {
        open = !open
        island.send(message())
      },
      onBlur: () => {
        if (!open) return
        open = false
        island.send(message())
      },
      onReply: (reply) => {
        open = false
        island.send(message())
        void model?.reply(reply).catch((error: unknown) => {
          ctx.log.write("warn", "island permission reply failed", { error: String(error) })
        })
      },
    })

    // The sidecar appears after startup and moves when it restarts, so the
    // endpoint is followed rather than read once.
    const connect = () => {
      const endpoint = ctx.serverEndpoints.get("sidecar")
      if (!endpoint || endpoint.url === connected) return
      connected = endpoint.url
      controller?.abort()
      controller = new AbortController()
      model = createModel(
        OpenCode.make({ baseUrl: endpoint.url, headers: endpoint.headers }),
        (next) => {
          // A new approval opens the island; the user collapsing it stands.
          if (next.waiting > lastWaiting) open = true
          lastWaiting = next.waiting
          state = next
          island.send(message())
        },
      )
      model.start(controller.signal)
      ctx.log.write("info", "island connected", { url: endpoint.url })
    }

    connect()
    const timer = setInterval(connect, 1000)

    return () => {
      clearInterval(timer)
      controller?.abort()
      island.dispose()
    }
  },
})
