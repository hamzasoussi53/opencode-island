import { OpenCode } from "@opencode/client"
import { Plugin } from "@opencode/plugin/gui"
import { app } from "electron"
import { createModel } from "./model"
import { islandShouldExist } from "./lifecycle"
import { createIslandWindow } from "./window"
import type { IslandMessage, IslandState } from "./state"

/**
 * The island lives in the desktop app's main process, not in a window.
 *
 * Main also has `serverEndpoints`, so the island can read the app's own server
 * directly and sees sessions from every project on the machine.
 *
 * It exists only while the app has a window of its own: the island must not
 * outlive OpenCode, or it stays on the screen after the app is gone and keeps
 * its process alive. It comes back with the next window.
 */
export default Plugin.define({
  main(ctx) {
    let state: IslandState = { sessions: [], working: 0, waiting: 0 }
    let open = false
    let lastWaiting = 0
    let model: ReturnType<typeof createModel> | undefined
    let controller: AbortController | undefined
    let connected = ""
    let island: ReturnType<typeof createIslandWindow> | undefined

    const message = (): IslandMessage => ({ ...state, open })
    const send = () => island?.send(message())

    // The picks go on their own channel, and only when they change: the state
    // is published on every token of every answer.
    let picksSent = ""
    const sendPicks = () => {
      if (!island || !model) return
      const picks = model.picks()
      const key = JSON.stringify(picks)
      if (key === picksSent) return
      picksSent = key
      island.picks(picks)
    }

    const create = () => {
      if (island) return
      island = createIslandWindow({
        log: (level, text, data) => ctx.log.write(level, text, data),
        onReady: () => {
          send()
          sendPicks()
        },
        onToggle: () => {
          open = !open
          send()
        },
        onBlur: () => {
          if (!open) return
          // An island that is asking for an answer stays up: the window never
          // has focus, so the app taking focus back would close it mid-question.
          if (state.sessions.some((session) => session.permission)) return
          open = false
          send()
        },
        onReply: (reply) => {
          open = false
          send()
          void model?.reply(reply).catch((error: unknown) => {
            ctx.log.write("warn", "island permission reply failed", { error: String(error) })
          })
        },
        onPrompt: (request) =>
          model
            ? model.prompt(request.sessionID, request.text, request.delivery)
            : Promise.resolve({ ok: false, error: "OpenCode is not connected" }),
        onQueued: (sessionID) =>
          model ? model.queued(sessionID) : Promise.reject(new Error("OpenCode is not connected")),
        onCancel: (request) => {
          void model?.cancel(request.sessionID, request.inboxID).then((answer) => {
            if (answer.ok) return
            ctx.log.write("warn", "island prompt cancel failed", { error: answer.error })
          })
        },
        onDrawerSize: (size) => {
          ctx.log.write("debug", "island drawer resized", size)
        },
        onOpenApp: () => {
          // The island floats above everything and never takes focus, so this is
          // the way back to the app itself. The island's own window is not in
          // the list, but its id is checked so it can never be the one focused.
          for (const window of ctx.windows.list()) {
            if (window.id === island?.id) continue
            if (window.isMinimized()) window.restore()
            window.show()
            window.focus()
          }
        },
        onQuit: () => {
          // The island and OpenCode are one process, so quitting the app is
          // what closes the island too.
          app.quit()
        },
      })
    }

    const destroy = () => {
      island?.dispose()
      island = undefined
      // A fresh page has not been sent the picks yet.
      picksSent = ""
    }

    // The app's own windows, counted so the island can follow them.
    const windows = new Set(ctx.windows.list().map((window) => window.id))
    const sync = () => {
      if (islandShouldExist(windows.size)) create()
      else destroy()
    }
    ctx.windows.on("open", (window) => {
      windows.add(window.id)
      sync()
    })
    ctx.windows.on("close", (window) => {
      windows.delete(window.id)
      sync()
    })
    sync()

    // The sidecar appears after startup and moves when it restarts, so the
    // endpoint is followed rather than read once. A restart keeps the URL but
    // rotates the password, so the headers are part of the identity.
    const connect = () => {
      const endpoint = ctx.serverEndpoints.get("sidecar")
      if (!endpoint) return
      const key = endpoint.url + JSON.stringify(endpoint.headers)
      if (key === connected) return
      connected = key
      controller?.abort()
      controller = new AbortController()
      model = createModel(
        OpenCode.make({ baseUrl: endpoint.url, headers: endpoint.headers }),
        (next) => {
          // A new approval opens the island; the user collapsing it stands.
          if (next.waiting > lastWaiting) open = true
          lastWaiting = next.waiting
          state = next
          send()
          sendPicks()
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
      destroy()
    }
  },
})
