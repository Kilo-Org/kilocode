import fs from "node:fs/promises"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Hono } from "hono"
import { embeddedUI, cspForHtml } from "../shared/ui"

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = AppFileSystem.mimeType(match)
      const headers = new Headers({ "content-type": mime })
      const body = new Uint8Array(await fs.readFile(match))
      if (mime.startsWith("text/html")) {
        headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
      }
      return new Response(body, { headers })
    }

    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  // kilocode_change - no proxy fallback to app.opencode.ai; embedded UI only
  return Response.json({ error: "Not Found" }, { status: 404 })
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
