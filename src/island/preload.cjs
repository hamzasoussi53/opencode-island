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
  onState: (handler) => ipcRenderer.on("opencode-island:state", (_event, state) => handler(state)),
})
