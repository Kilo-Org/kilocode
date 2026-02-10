import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import fs from "fs"
import path from "path"

export default defineConfig({
  plugins: [
    solidPlugin(),
    {
      name: "write-vite-port",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          const addr = server.httpServer?.address()
          const port = typeof addr === "object" && addr ? addr.port : 5173
          const portFile = path.resolve(__dirname, "../.vite-port")
          fs.writeFileSync(portFile, String(port), "utf8")
          console.log(`[vite] Wrote port ${port} to ${portFile}`)
        })
      },
    },
  ],
  root: ".",
  server: {
    port: 5173,
    strictPort: false,
    cors: true,
    // Allow webview origin to connect
    hmr: {
      protocol: "ws",
      host: "localhost",
    },
  },
  build: {
    target: "esnext",
  },
})
