import { defineConfig } from "vite"
import { gui } from "@opencode/plugin/gui/vite"

export default defineConfig({
  plugins: [gui()],
  // dist/island is built first and inlined into this bundle.
  build: { emptyOutDir: false },
})
