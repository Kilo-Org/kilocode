// Zero-dependency dev server for the Design Mode canvas fixture.
//
// Serves ./public with live reload: a tiny WebSocket pushes a "reload" whenever
// a file under ./public changes, so edits the design agent makes show up in the
// browser instantly — the visible half of the speak → edit → see loop.

import { watch } from "fs"
import path from "path"

const root = path.join(import.meta.dir, "public")
const port = Number(process.env.PORT ?? 4321)

const LIVE_RELOAD = `
<script>
(() => {
  const connect = () => {
    const ws = new WebSocket(\`ws://\${location.host}/__lr\`)
    ws.onmessage = (e) => { if (e.data === "reload") location.reload() }
    ws.onclose = () => setTimeout(connect, 600)
  }
  connect()
})()
</script>
`

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
}

const server = Bun.serve({
  port,
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === "/__lr") {
      if (server.upgrade(req)) return undefined as unknown as Response
      return new Response("expected websocket", { status: 426 })
    }

    const rel = url.pathname === "/" ? "/index.html" : url.pathname
    const file = Bun.file(path.join(root, rel))
    if (!(await file.exists())) return new Response("not found", { status: 404 })

    const ext = path.extname(rel)
    if (ext === ".html") {
      const html = (await file.text()).replace("</body>", `${LIVE_RELOAD}</body>`)
      return new Response(html, { headers: { "content-type": MIME[".html"] } })
    }
    return new Response(file, { headers: { "content-type": MIME[ext] ?? "application/octet-stream" } })
  },
  websocket: {
    open(ws) {
      ws.subscribe("lr")
    },
    message() {},
    close(ws) {
      ws.unsubscribe("lr")
    },
  },
})

let debounce: ReturnType<typeof setTimeout> | undefined
watch(root, { recursive: true }, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => server.publish("lr", "reload"), 80)
})

const fixtureDir = import.meta.dir
process.stdout.write(
  [
    ``,
    `  Design canvas → http://localhost:${port}`,
    ``,
    `  In another terminal, from the repo root, run:`,
    ``,
    `    ./bin/kilodev design --voice local --url http://localhost:${port} --dir ${fixtureDir}`,
    ``,
    `  (use --voice fake to drive it by typing instead of talking)`,
    ``,
    `  Watching ${path.relative(process.cwd(), root) || root} for changes — edits hot-reload.`,
    ``,
  ].join("\n") + "\n",
)
