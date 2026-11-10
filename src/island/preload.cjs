const { contextBridge, ipcRenderer } = require("electron")

/**
 * The island page's only way out. It can report its size, ask for a toggle and
 * answer a permission; it cannot reach Node, the filesystem or the network.
 */
contextBridge.exposeInMainWorld("island", {
  ready: () => ipcRenderer.send("opencode-island:ready"),
  size: (width, height) => ipcRenderer.send("opencode-island:size", { width, height }),
  toggle: () => ipcRenderer.send("opencode-island:toggle"),
  reply: (reply) => ipcRenderer.send("opencode-island:reply", reply),
  dragStart: () => ipcRenderer.send("opencode-island:drag-start"),
  dragEnd: () => ipcRenderer.send("opencode-island:drag-end"),
  ignore: (ignore) => ipcRenderer.send("opencode-island:ignore", ignore),
  resizeStart: () => ipcRenderer.send("opencode-island:resize-start"),
  resize: (screenY) => ipcRenderer.send("opencode-island:resize", screenY),
  resizeEnd: () => ipcRenderer.send("opencode-island:resize-end"),
  screen: () => ipcRenderer.invoke("opencode-island:screen"),
  onState: (handler) => ipcRenderer.on("opencode-island:state", (_event, state) => handler(state)),
})
