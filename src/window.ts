import { BrowserWindow, ipcMain, screen } from "electron"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import islandHtml from "../dist/island/index.html?raw"
import islandPreload from "./island/preload.cjs?raw"
import type { IslandMessage, PermissionDecision, QueuedPrompt, SessionPicks } from "./state"

/**
 * The only file that touches raw Electron.
 *
 * The GUI API is experimental and has no way to create a window of its own
 * (`ctx.windows` lists the app's windows, `ctx.embeds` places pages inside
 * them), so the island is a BrowserWindow we own. Keeping that here means the
 * off-contract surface is one small file if the API changes.
 *
 * The page and its preload are written to a temp directory at startup because
 * the app reads a plugin's GUI bundle from the server and evaluates it as
 * code: there is no path on disk to load sibling files from.
 */

const CHANNEL = "opencode-island"
const MIN_WIDTH = 24
const MAX_WIDTH = 640
// The open drawer is a panel of a fixed size, so it is clamped in pixels; its
// ceiling is the same as the bar's width, and its height a share of the screen.
const MIN_DRAWER_WIDTH = 320
const MIN_DRAWER_HEIGHT = 240
const DRAWER_HEIGHT_SHARE = 0.8

export interface Reply extends Record<string, unknown> {
  sessionID: string
  requestID: string
  decision: PermissionDecision
}

export interface PromptRequest {
  sessionID: string
  text: string
  delivery: "steer" | "queue"
}

export interface IslandWindowOptions {
  /** The page installed its listeners; send it the first state. */
  onReady: () => void
  onToggle: () => void
  /** The island lost focus, so it should contract. */
  onBlur: () => void
  onReply: (reply: Reply) => void
  /** Send a prompt to a session; the answer says whether it went. */
  onPrompt: (request: PromptRequest) => Promise<{ ok: boolean; error?: string }>
  /** What the server has queued for a session. */
  onQueued: (sessionID: string) => Promise<QueuedPrompt[]>
  onCancel: (request: { sessionID: string; inboxID: string }) => void
  /** The drawer was resized, so its size is known for the next open. */
  onDrawerSize: (size: { width: number; height: number }) => void
  /** Bring the OpenCode window to the front. */
  onOpenApp: () => void
  /** Close the island and OpenCode with it. */
  onQuit: () => void
  log: (
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>,
  ) => void
}

export function createIslandWindow(options: IslandWindowOptions) {
  const dir = mkdtempSync(join(tmpdir(), "opencode-island-"))
  const page = join(dir, "island.html")
  const preload = join(dir, "preload.cjs")
  writeFileSync(page, islandHtml)
  writeFileSync(preload, islandPreload)

  // roundedCorners, hiddenInMissionControl and acceptFirstMouse are macOS
  // only; Electron ignores them elsewhere.
  const window = new BrowserWindow({
    width: 460,
    height: 240,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    // The island shapes its own outer corners; the window mask would round the
    // screen edge too and leave a visible sliver of desktop there.
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // The island must not take the app's taskbar button with it. A window
    // that skips the taskbar is the app's only window here on some setups, and
    // then OpenCode had no Dock or taskbar icon at all: there was nothing to
    // right-click to close it.
    skipTaskbar: false,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })

  // The window paints white where the page paints nothing, and the tab's
  // rounded corners are exactly that: a sliver of white instead of the
  // desktop behind it. Electron's own default is opaque white, so it has to
  // be told to be transparent after the window exists.
  window.setBackgroundColor("#00000000")

  // Float above full-screen apps and every Space, without ever taking focus
  // when it appears. Electron does nothing with setVisibleOnAllWorkspaces on
  // Windows, so the guard below is documentation rather than a fix: Windows
  // hides the island on the virtual desktops it does not belong to, and no
  // Electron API changes that.
  window.setAlwaysOnTop(true, "screen-saver")
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  let size = { width: 460, height: 240 }
  // The open drawer's size: as tall as its content until it is dragged, and the
  // dragged size from then on. It is kept apart from the bar's share of the
  // screen, so neither state can overwrite the other.
  let content: { width: number; height: number } | null = null
  let drawer: { width: number; height: number } | null = null
  // Whether the island is showing its drawer, which decides which size applies.
  let open = false
  // Where the tab's centre sits on the right edge; null means "middle".
  let center: number | null = null
  // While an edge is dragged its opposite edge holds still: the bottom edge of
  // the bar or of the drawer, whose top stays put, or the drawer's left edge,
  // whose right edge is the screen edge.
  let resize: { edge: "bottom" | "left"; top: number; right: number } | null = null

  const place = (animate = false) => {
    if (window.isDestroyed()) return
    const area = screen.getPrimaryDisplay().workArea
    const box = open ? (drawer ?? content ?? size) : size
    const middle = area.y + (area.height - box.height) / 2
    const y =
      resize?.edge === "bottom"
        ? Math.min(area.y + area.height - box.height, Math.max(area.y, resize.top))
        : center == null
          ? middle
          : Math.min(area.y + area.height - box.height, Math.max(area.y, center - box.height / 2))
    window.setBounds(
      {
        x: Math.round(area.x + area.width - box.width),
        y: Math.round(y),
        width: box.width,
        height: box.height,
      },
      animate,
    )
  }

  const ours = (sender: Electron.WebContents) => !window.isDestroyed() && sender === window.webContents

  const onReady = (event: Electron.IpcMainEvent) => {
    if (ours(event.sender)) options.onReady()
  }

  const onSize = (event: Electron.IpcMainEvent, next: { width?: number; height?: number }) => {
    if (!ours(event.sender)) return
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next?.width ?? 0)))
    // The page may ask for a share of the screen, so the ceiling is the screen.
    const height = Math.min(area.height, Math.max(24, Math.round(next?.height ?? 0)))
    // The page reports the size it wants for the state it is in, so a report
    // while the drawer is open belongs to the drawer, never to the bar.
    const current = open ? content : size
    if (width === current?.width && height === current?.height) return
    if (open) content = { width, height }
    else size = { width, height }
    // The first report happens while hidden; every later one is a drawer move.
    const first = !window.isVisible()
    place(!first)
    if (first) {
      window.showInactive()
      options.log("info", "island shown", { width, height })
    }
  }

  const onToggle = (event: Electron.IpcMainEvent) => {
    if (ours(event.sender)) options.onToggle()
  }

  const onReply = (event: Electron.IpcMainEvent, reply: Reply) => {
    if (ours(event.sender)) options.onReply(reply)
  }

  // The island shows a failed send where the user is, so the answer goes back
  // as a value rather than as a rejected request.
  const onPrompt = (event: Electron.IpcMainInvokeEvent, request: PromptRequest) => {
    if (!ours(event.sender)) throw new Error("not the island")
    return options.onPrompt(request)
  }

  // A queue that cannot be read rejects the request on purpose, so the island
  // can say the queue could not be read: an empty list would say it is empty.
  const onQueued = (event: Electron.IpcMainInvokeEvent, sessionID: string) => {
    if (!ours(event.sender)) throw new Error("not the island")
    return options.onQueued(sessionID)
  }

  const onCancel = (
    event: Electron.IpcMainEvent,
    request: { sessionID: string; inboxID: string },
  ) => {
    if (ours(event.sender)) options.onCancel(request)
  }

  // Dragging the closed tab slides it along the edge: the window follows the
  // cursor's vertical position and stays flush right.
  let drag: ReturnType<typeof setInterval> | null = null

  const stopDrag = () => {
    if (drag) clearInterval(drag)
    drag = null
  }

  const onDragStart = (event: Electron.IpcMainEvent) => {
    if (!ours(event.sender) || drag) return
    const start = screen.getCursorScreenPoint().y
    const offset = start - (window.getBounds().y + size.height / 2)
    let last = start
    drag = setInterval(() => {
      if (window.isDestroyed()) return stopDrag()
      const y = screen.getCursorScreenPoint().y
      if (y === last) return
      last = y
      center = y - offset
      place()
    }, 16)
  }

  const onDragEnd = (event: Electron.IpcMainEvent) => {
    if (ours(event.sender)) stopDrag()
  }

  // Click-through: the page decides, since only it knows where the grip is.
  const onIgnore = (event: Electron.IpcMainEvent, ignore: boolean) => {
    if (ours(event.sender)) window.setIgnoreMouseEvents(Boolean(ignore), { forward: true })
  }

  // An edge is dragged from its grip: the bar's bottom edge, or the drawer's
  // bottom or left edge. The window does the arithmetic, so the edge follows
  // the mouse exactly.
  const onResizeStart = (event: Electron.IpcMainEvent, edge: "bottom" | "left" | undefined) => {
    if (!ours(event.sender)) return
    const bounds = window.getBounds()
    resize = {
      edge: edge === "left" ? "left" : "bottom",
      top: bounds.y,
      right: bounds.x + bounds.width,
    }
  }

  const onResize = (event: Electron.IpcMainEvent, at: { x?: number; y?: number }) => {
    if (!ours(event.sender) || !resize) return
    const area = screen.getPrimaryDisplay().workArea
    const box = open ? (drawer ?? content ?? size) : size
    if (resize.edge === "left") {
      // The right edge is the screen edge and never moves, so the drawer grows
      // leftward from it.
      const width = Math.min(
        MAX_WIDTH,
        area.width,
        Math.max(MIN_DRAWER_WIDTH, Math.round(resize.right - (at?.x ?? 0))),
      )
      if (width === box.width) return
      drawer = { width, height: box.height }
      place(false)
      return
    }
    const min = open ? MIN_DRAWER_HEIGHT : 24
    const max = open ? Math.round(area.height * DRAWER_HEIGHT_SHARE) : area.height
    const height = Math.min(max, Math.max(min, Math.round((at?.y ?? 0) - resize.top)))
    if (height === box.height) return
    // A report while the drawer is open belongs to the drawer, never to the bar.
    if (open) drawer = { width: box.width, height }
    else size = { ...size, height }
    place(false)
  }

  const onResizeEnd = (event: Electron.IpcMainEvent) => {
    if (!ours(event.sender)) return
    // A dragged bottom edge holds the top still, so the island's centre moves to
    // the new centre and the island stays where it was put.
    if (resize?.edge === "bottom") {
      const box = open ? (drawer ?? content ?? size) : size
      center = resize.top + box.height / 2
    }
    resize = null
  }

  // The drawer's size is in pixels, so it is clamped against the screen rather
  // than turned into a share of it.
  const onDrawerSize = (
    event: Electron.IpcMainEvent,
    next: { width?: number; height?: number },
  ) => {
    if (!ours(event.sender)) return
    const area = screen.getPrimaryDisplay().workArea
    const width = Math.min(
      MAX_WIDTH,
      area.width,
      Math.max(MIN_DRAWER_WIDTH, Math.round(next?.width ?? 0)),
    )
    const height = Math.min(
      Math.round(area.height * DRAWER_HEIGHT_SHARE),
      Math.max(MIN_DRAWER_HEIGHT, Math.round(next?.height ?? 0)),
    )
    drawer = { width, height }
    options.onDrawerSize(drawer)
    if (open) place()
  }

  // The page sizes itself against the screen, so it needs to know how big it is.
  const onScreen = () => {
    const area = screen.getPrimaryDisplay().workArea
    return { width: area.width, height: area.height }
  }

  // Bring the OpenCode window forward, so the user can go back to it.
  const onOpenApp = (event: Electron.IpcMainEvent) => {
    if (!ours(event.sender)) return
    options.onOpenApp()
  }

  // Close the island and OpenCode together.
  const onQuit = (event: Electron.IpcMainEvent) => {
    if (!ours(event.sender)) return
    options.onQuit()
  }

  ipcMain.on(`${CHANNEL}:ready`, onReady)
  ipcMain.on(`${CHANNEL}:size`, onSize)
  ipcMain.on(`${CHANNEL}:toggle`, onToggle)
  ipcMain.on(`${CHANNEL}:reply`, onReply)
  ipcMain.on(`${CHANNEL}:cancel`, onCancel)
  ipcMain.on(`${CHANNEL}:drag-start`, onDragStart)
  ipcMain.on(`${CHANNEL}:drag-end`, onDragEnd)
  ipcMain.on(`${CHANNEL}:ignore`, onIgnore)
  ipcMain.on(`${CHANNEL}:resize-start`, onResizeStart)
  ipcMain.on(`${CHANNEL}:resize`, onResize)
  ipcMain.on(`${CHANNEL}:resize-end`, onResizeEnd)
  ipcMain.on(`${CHANNEL}:drawer-size`, onDrawerSize)
  ipcMain.on(`${CHANNEL}:open-app`, onOpenApp)
  ipcMain.on(`${CHANNEL}:quit`, onQuit)
  ipcMain.handle(`${CHANNEL}:screen`, onScreen)
  ipcMain.handle(`${CHANNEL}:prompt`, onPrompt)
  ipcMain.handle(`${CHANNEL}:queued`, onQueued)

  window.on("blur", () => options.onBlur())
  window.on("closed", () => {
    stopDrag()
    options.log("debug", "island window closed")
  })
  window.webContents.on("did-fail-load", (_event, code, description) =>
    options.log("error", "island page failed to load", { code, description }),
  )

  // The island belongs on whichever screen is primary now.
  const onDisplaysChanged = () => place()
  screen.on("display-metrics-changed", onDisplaysChanged)
  screen.on("display-added", onDisplaysChanged)
  screen.on("display-removed", onDisplaysChanged)

  place()
  void window.loadFile(page)

  return {
    /** The island's own window, so the app's windows can be told apart from it. */
    id: window.id,
    send(message: IslandMessage) {
      if (window.isDestroyed()) return
      if (message.open !== open) {
        open = message.open
        // The page reports the drawer's content size a moment after it opens,
        // so the window waits for it rather than flashing the bar's width.
        // Closing already has a size: the bar's own.
        if (!open || drawer || content) place()
      }
      window.webContents.send(`${CHANNEL}:state`, message)
    },
    /** The sessions the island can pick from, on their own channel. */
    picks(list: SessionPicks) {
      if (window.isDestroyed()) return
      window.webContents.send(`${CHANNEL}:picks`, list)
    },
    dispose() {
      ipcMain.removeListener(`${CHANNEL}:ready`, onReady)
      ipcMain.removeListener(`${CHANNEL}:size`, onSize)
      ipcMain.removeListener(`${CHANNEL}:toggle`, onToggle)
      ipcMain.removeListener(`${CHANNEL}:reply`, onReply)
      ipcMain.removeListener(`${CHANNEL}:cancel`, onCancel)
      ipcMain.removeListener(`${CHANNEL}:drag-start`, onDragStart)
      ipcMain.removeListener(`${CHANNEL}:drag-end`, onDragEnd)
      ipcMain.removeListener(`${CHANNEL}:ignore`, onIgnore)
      ipcMain.removeListener(`${CHANNEL}:resize-start`, onResizeStart)
      ipcMain.removeListener(`${CHANNEL}:resize`, onResize)
      ipcMain.removeListener(`${CHANNEL}:resize-end`, onResizeEnd)
      ipcMain.removeListener(`${CHANNEL}:drawer-size`, onDrawerSize)
      ipcMain.removeListener(`${CHANNEL}:open-app`, onOpenApp)
      ipcMain.removeListener(`${CHANNEL}:quit`, onQuit)
      ipcMain.removeHandler(`${CHANNEL}:screen`)
      ipcMain.removeHandler(`${CHANNEL}:prompt`)
      ipcMain.removeHandler(`${CHANNEL}:queued`)
      screen.removeListener("display-metrics-changed", onDisplaysChanged)
      screen.removeListener("display-added", onDisplaysChanged)
      screen.removeListener("display-removed", onDisplaysChanged)
      stopDrag()
      if (!window.isDestroyed()) window.destroy()
      // Windows keeps the page and the preload locked for a moment after the
    // window is gone, so the delete is retried before it gives up.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // A locked temp directory is not worth failing the plugin over.
    }
    },
  }
}
