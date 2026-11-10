import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

const app = fileURLToPath(new URL("./src/island/app", import.meta.url))

export default defineConfig({
  root: app,
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: { "@": app },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/island", import.meta.url)),
    emptyOutDir: true,
  },
})
