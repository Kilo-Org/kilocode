/** Local static server for the browser fixtures, plus the submission log the checkers read. */
import { FRAMES, PAGES, type Recorded } from "./fixtures"

export type FixtureServer = {
  url: string
  records: (task: string) => Recorded[]
  reset: () => void
  stop: () => void
}

type Body = { task?: unknown; kind?: unknown; data?: unknown }

export function serve(port = 0): FixtureServer {
  const log = new Map<string, Recorded[]>()
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "POST" && url.pathname === "/__record") {
        const body = (await request.json().catch(() => ({}))) as Body
        if (typeof body.task !== "string" || typeof body.kind !== "string") {
          return new Response("bad record", { status: 400 })
        }
        const list = log.get(body.task) ?? []
        list.push({ kind: body.kind, data: (body.data ?? {}) as Record<string, unknown> })
        log.set(body.task, list)
        return Response.json({ ok: true })
      }
      if (request.method === "POST" && url.pathname === "/__reset") {
        log.clear()
        return Response.json({ ok: true })
      }
      const match = url.pathname.match(/^\/t\/([a-z0-9-]+)(\/panel|\/form)?$/)
      const frame = match?.[2]
      if (match && frame) {
        const html = FRAMES[match[1]]
        return html === undefined ? new Response("not found", { status: 404 }) : htmlResponse(html)
      }
      if (match) {
        const html = PAGES[match[1]]
        if (html !== undefined) return htmlResponse(html)
      }
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 })
      if (url.pathname === "/") {
        return htmlResponse(
          `<!doctype html><html><body><h1>Browser bench fixtures</h1><ul>${Object.keys(PAGES)
            .map((id) => `<li><a href="/t/${id}">${id}</a></li>`)
            .join("")}</ul></body></html>`,
        )
      }
      return new Response("not found", { status: 404 })
    },
  })
  const host = `http://127.0.0.1:${server.port}`
  return {
    url: host,
    records: (task) => log.get(task) ?? [],
    reset: () => log.clear(),
    stop: () => server.stop(true),
  }
}

function htmlResponse(html: string) {
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } })
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 47831)
  const server = serve(port)
  console.log(`fixtures on ${server.url}`)
}
