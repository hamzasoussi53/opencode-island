import { BrowserWindow, ipcMain, screen } from "electron"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import islandHtml from "./island/island.html?raw"
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
const MIN_WIDTH = 60
const MAX_WIDTH = 640
const MAX_HEIGHT = 720

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

  const window = new BrowserWindow({
    width: 460,
    height: 240,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
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

  // Float above full-screen apps and every Space, without ever taking focus
  // when it appears.
  window.setAlwaysOnTop(true, "screen-saver")
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  let size = { width: 460, height: 240 }

  const place = () => {
    if (window.isDestroyed()) return
    const area = screen.getPrimaryDisplay().workArea
    window.setBounds({
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: Math.round(area.y),
      width: size.width,
      height: size.height,
    })
  }

  const ours = (sender: Electron.WebContents) => !window.isDestroyed() && sender === window.webContents

  const onReady = (event: Electron.IpcMainEvent) => {
    if (ours(event.sender)) options.onReady()
  }

  const onSize = (event: Electron.IpcMainEvent, next: { width?: number; height?: number }) => {
    if (!ours(event.sender)) return
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(next?.width ?? 0)))
    const height = Math.min(MAX_HEIGHT, Math.max(24, Math.round(next?.height ?? 0)))
    if (width === size.width && height === size.height) return
    size = { width, height }
    place()
    if (!window.isVisible()) {
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

  ipcMain.on(`${CHANNEL}:ready`, onReady)
  ipcMain.on(`${CHANNEL}:size`, onSize)
  ipcMain.on(`${CHANNEL}:toggle`, onToggle)
  ipcMain.on(`${CHANNEL}:reply`, onReply)

  window.on("blur", () => options.onBlur())
  window.on("closed", () => options.log("debug", "island window closed"))
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
      screen.removeListener("display-metrics-changed", onDisplaysChanged)
      screen.removeListener("display-added", onDisplaysChanged)
      screen.removeListener("display-removed", onDisplaysChanged)
      if (!window.isDestroyed()) window.destroy()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
