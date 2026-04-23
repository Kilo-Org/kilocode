import { Flag } from "@/flag/flag"
import { Hono } from "hono"
import { getMimeType } from "hono/utils/mime"
import fs from "node:fs/promises"

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

const embeddedUI = await (async () => {
  if (Flag.KILO_DISABLE_EMBEDDED_WEB_UI) return null
  try {
    // @ts-expect-error - generated file at build time
    const module = await import("opencode-web-ui.gen.ts")
    return module.default as Record<string, string>
  } catch {
    return null
  }
})()

export const UIRoutes = (): Hono =>
  new Hono().all("/*", async (c) => {
    const path = c.req.path

    if (embeddedUI) {
      const match = embeddedUI[path.replace(/^\//, "")] ?? embeddedUI["index.html"] ?? null
      if (!match) return c.json({ error: "Not Found" }, 404)

      if (await fs.exists(match)) {
        const mime = getMimeType(match) ?? "text/plain"
        c.header("Content-Type", mime)
        if (mime.startsWith("text/html")) {
          c.header("Content-Security-Policy", DEFAULT_CSP)
        }
        return c.body(new Uint8Array(await fs.readFile(match)))
      } else {
        return c.json({ error: "Not Found" }, 404)
      }
    } else {
      // kilocode_change - return 404 instead of proxying to app.opencode.ai
      return c.json({ error: "Not Found" }, 404)
    }
  })
