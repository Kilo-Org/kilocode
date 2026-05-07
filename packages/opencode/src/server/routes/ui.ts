import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"
import { HttpClient, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Hono } from "hono"
import { getMimeType } from "hono/utils/mime"
import fs from "node:fs/promises"

const embeddedUIPromise = Flag.KILO_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

const DEFAULT_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

// kilocode_change - upstream's proxy-to-app.opencode.ai fallback was removed; Kilo serves the embedded UI only
function embeddedUI() {
  if (Flag.KILO_DISABLE_EMBEDDED_WEB_UI) return Promise.resolve(null)
  return embeddedUIPromise
}

export async function serveUI(request: Request) {
  const embeddedWebUI = await embeddedUI()
  const path = new URL(request.url).pathname

  if (embeddedWebUI) {
    const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
    if (!match) return Response.json({ error: "Not Found" }, { status: 404 })

    if (await fs.exists(match)) {
      const mime = getMimeType(match) ?? "text/plain"
      const headers = new Headers({ "content-type": mime })
      if (mime.startsWith("text/html")) headers.set("content-security-policy", DEFAULT_CSP)
      return new Response(new Uint8Array(await fs.readFile(match)), { headers })
    }

    return Response.json({ error: "Not Found" }, { status: 404 })
  }

  // kilocode_change - no proxy fallback to app.opencode.ai; embedded UI only
  return Response.json({ error: "Not Found" }, { status: 404 })
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: AppFileSystem.Interface; client: HttpClient.HttpClient },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI())
    const path = new URL(request.url, "http://localhost").pathname

    if (embeddedWebUI) {
      const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
      if (!match) return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })

      if (yield* services.fs.existsSafe(match)) {
        const mime = getMimeType(match) ?? "text/plain"
        const headers = new Headers({ "content-type": mime })
        if (mime.startsWith("text/html")) headers.set("content-security-policy", DEFAULT_CSP)
        return HttpServerResponse.raw(yield* services.fs.readFile(match), { headers })
      }
      return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
    }

    // kilocode_change - no proxy fallback to app.opencode.ai; embedded UI only
    return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
  })
}

export const UIRoutes = (): Hono => new Hono().all("/*", (c) => serveUI(c.req.raw))
