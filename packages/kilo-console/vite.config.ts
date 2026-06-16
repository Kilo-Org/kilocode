import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  base: process.env.KILO_CONSOLE_BASE ?? "/",
  plugins: [solidPlugin()],
  server: {
    host: "127.0.0.1",
    port: 3017,
  },
  resolve: {
    conditions: ["browser", "solid", "module", "import"],
    dedupe: ["solid-js", "solid-js/web", "solid-js/store", "@pierre/diffs"],
  },
  build: {
    target: "esnext",
  },
  worker: {
    format: "es",
  },
})
