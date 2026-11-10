import { Plugin } from "@opencode/plugin"

/**
 * The server part exists so the desktop app discovers the plugin and reads its
 * `./gui-experimental` bundle. Everything the island needs it reads from the
 * app's own server in the main process, so there is nothing to do here.
 */
export default Plugin.define({
  id: "opencode-island",
  setup() {},
})
