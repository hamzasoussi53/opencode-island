import { BrowserWindow, ipcMain, screen } from "electron"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import islandHtml from "../dist/island/index.html?raw"
import islandPreload from "./island/preload.cjs?raw"
import type { IslandMessage, PermissionDecision } from "./state"

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

export interface Reply extends Record<string, unknown> {
  sessionID: string
  requestID: string
  decision: PermissionDecision
}

export interface IslandWindowOptions {
  /** The page installed its listeners; send it the first state. */
  onReady: () => void
  onToggle: () => void
  /** The island lost focus, so it should contract. */
  onBlur: () => void
  onReply: (reply: Reply) => void
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
  // Where the tab's centre sits on the right edge; null means "middle".
  let center: number | null = null
  // While the bar is being resized its top stays put, so the bottom follows
  // the mouse instead of drifting away from it.
  let anchorTop: number | null = null

  const place = (animate = false) => {
    if (window.isDestroyed()) return
    const area = screen.getPrimaryDisplay().workArea
    const middle = area.y + (area.height - size.height) / 2
    const y =
      anchorTop != null
        ? Math.min(area.y + area.height - size.height, Math.max(area.y, anchorTop))
        : center == null
          ? middle
          : Math.min(area.y + area.height - size.height, Math.max(area.y, center - size.height / 2))
    window.setBounds(
      {
        x: Math.round(area.x + area.width - size.width),
        y: Math.round(y),
        width: size.width,
        height: size.height,
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
    if (width === size.width && height === size.height) return
    size = { width, height }
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

  // The bar is resized from its bottom edge: hold the top still and let the
  // bottom follow the mouse.
  const onResizeStart = (event: Electron.IpcMainEvent) => {
    if (!ours(event.sender)) return
    anchorTop = window.getBounds().y
  }

  const onResize = (event: Electron.IpcMainEvent, screenY: number) => {
    if (!ours(event.sender) || anchorTop == null) return
    const area = screen.getPrimaryDisplay().workArea
    const height = Math.min(area.height, Math.max(24, Math.round(screenY - anchorTop)))
    if (height === size.height) return
    size = { ...size, height }
    place(false)
  }

  const onResizeEnd = (event: Electron.IpcMainEvent) => {
    if (!ours(event.sender)) return
    if (anchorTop != null) center = anchorTop + size.height / 2
    anchorTop = null
  }

  // The page sizes itself against the screen, so it needs to know how big it is.
  const onScreen = () => {
    const area = screen.getPrimaryDisplay().workArea
    return { width: area.width, height: area.height }
  }

  ipcMain.on(`${CHANNEL}:ready`, onReady)
  ipcMain.on(`${CHANNEL}:size`, onSize)
  ipcMain.on(`${CHANNEL}:toggle`, onToggle)
  ipcMain.on(`${CHANNEL}:reply`, onReply)
  ipcMain.on(`${CHANNEL}:drag-start`, onDragStart)
  ipcMain.on(`${CHANNEL}:drag-end`, onDragEnd)
  ipcMain.on(`${CHANNEL}:ignore`, onIgnore)
  ipcMain.on(`${CHANNEL}:resize-start`, onResizeStart)
  ipcMain.on(`${CHANNEL}:resize`, onResize)
  ipcMain.on(`${CHANNEL}:resize-end`, onResizeEnd)
  ipcMain.handle(`${CHANNEL}:screen`, onScreen)

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
    send(message: IslandMessage) {
      if (window.isDestroyed()) return
      window.webContents.send(`${CHANNEL}:state`, message)
    },
    dispose() {
      ipcMain.removeListener(`${CHANNEL}:ready`, onReady)
      ipcMain.removeListener(`${CHANNEL}:size`, onSize)
      ipcMain.removeListener(`${CHANNEL}:toggle`, onToggle)
      ipcMain.removeListener(`${CHANNEL}:reply`, onReply)
      ipcMain.removeListener(`${CHANNEL}:drag-start`, onDragStart)
      ipcMain.removeListener(`${CHANNEL}:drag-end`, onDragEnd)
      ipcMain.removeListener(`${CHANNEL}:ignore`, onIgnore)
      ipcMain.removeListener(`${CHANNEL}:resize-start`, onResizeStart)
      ipcMain.removeListener(`${CHANNEL}:resize`, onResize)
      ipcMain.removeListener(`${CHANNEL}:resize-end`, onResizeEnd)
      ipcMain.removeHandler(`${CHANNEL}:screen`)
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
