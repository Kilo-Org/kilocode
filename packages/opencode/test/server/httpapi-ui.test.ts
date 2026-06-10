import { createHash } from "node:crypto"
import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { ConfigProvider, Effect, Layer } from "effect"
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ServerAuth } from "../../src/server/auth"
import { authorizationRouterMiddleware } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { serveEmbeddedUIEffect, serveUIEffect } from "../../src/server/shared/ui"
import { Server } from "../../src/server/server"

void Log.init({ print: false })

const original = {
  KILO_DISABLE_EMBEDDED_WEB_UI: Flag.KILO_DISABLE_EMBEDDED_WEB_UI,
  KILO_SERVER_PASSWORD: Flag.KILO_SERVER_PASSWORD,
  KILO_SERVER_USERNAME: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
}

afterEach(() => {
  Flag.KILO_DISABLE_EMBEDDED_WEB_UI = original.KILO_DISABLE_EMBEDDED_WEB_UI
  Flag.KILO_SERVER_PASSWORD = original.KILO_SERVER_PASSWORD
  Flag.KILO_SERVER_USERNAME = original.KILO_SERVER_USERNAME
  restoreEnv("KILO_SERVER_PASSWORD", original.envPassword)
  restoreEnv("KILO_SERVER_USERNAME", original.envUsername)
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    ExperimentalHttpApiServer.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: input?.password,
            KILO_SERVER_USERNAME: input?.username,
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        ExperimentalHttpApiServer.context,
      )
    },
  }
}

function uiApp(input?: { password?: string; username?: string; client?: Layer.Layer<HttpClient.HttpClient> }) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        yield* router.add("*", "/*", (request) => serveUIEffect(request, { fs, client }))
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
      Layer.provide([
        AppFileSystem.defaultLayer,
        input?.client ?? httpClient(new Response("ui")),
        HttpServer.layerServices,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: input?.password,
            KILO_SERVER_USERNAME: input?.username,
          }),
        ),
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        ExperimentalHttpApiServer.context,
      )
    },
  }
}

function httpClient(response: Response, onRequest?: (request: HttpClientRequest.HttpClientRequest) => void) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      onRequest?.(request)
      return Effect.succeed(HttpClientResponse.fromWeb(request, response))
    }),
  )
}

describe("HttpApi UI fallback", () => {
  // kilocode_change start - embedded UI is the only supported fallback; never proxy to app.opencode.ai
  test("returns not found without proxying when embedded UI is disabled", async () => {
    Flag.KILO_DISABLE_EMBEDDED_WEB_UI = true
    let proxied = false

    const response = await uiApp({
      client: httpClient(new Response("ui"), () => {
        proxied = true
      }),
    }).request("/")

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not Found" })
    expect(proxied).toBe(false)
  })
  // kilocode_change end

  test("serves embedded UI assets when Bun can read them but access reports missing", async () => {
    let readPath: string | undefined

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        return yield* serveEmbeddedUIEffect(
          "/assets/app.js",
          {
            ...fs,
            existsSafe: () => Effect.die("embedded UI should not rely on filesystem access checks"),
            readFile: (path) => {
              readPath = path
              return path === "/$bunfs/root/assets/app.js"
                ? Effect.succeed(new TextEncoder().encode("console.log('embedded')"))
                : Effect.die(`unexpected embedded UI path: ${path}`)
            },
          },
          { "assets/app.js": "/$bunfs/root/assets/app.js" },
        )
      }).pipe(Effect.provide(AppFileSystem.defaultLayer), Effect.map(HttpServerResponse.toWeb)),
    )

    expect(response.status).toBe(200)
    expect(readPath).toBe("/$bunfs/root/assets/app.js")
    expect(response.headers.get("content-type")).toContain("text/javascript")
    expect(await response.text()).toBe("console.log('embedded')")
  })

  test("allows embedded UI terminal wasm and theme preload CSP", async () => {
    const script = 'document.documentElement.dataset.theme = "dark"'

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        return yield* serveEmbeddedUIEffect(
          "/",
          {
            ...fs,
            readFile: (path) => {
              return path === "/$bunfs/root/index.html"
                ? Effect.succeed(
                    new TextEncoder().encode(
                      `<html><head><script id="oc-theme-preload-script">${script}</script></head></html>`,
                    ),
                  )
                : Effect.die(`unexpected embedded UI path: ${path}`)
            },
          },
          { "index.html": "/$bunfs/root/index.html" },
        )
      }).pipe(Effect.provide(AppFileSystem.defaultLayer), Effect.map(HttpServerResponse.toWeb)),
    )

    const csp = response.headers.get("content-security-policy") ?? ""
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`)
    expect(csp).toContain("connect-src * data:")
  })

  test("keeps matched API routes ahead of the UI fallback", async () => {
    const response = await Server.Default().app.request("/session/ses_nope")

    expect(response.status).toBe(404)
  })

  test("requires server password for the web UI", async () => {
    Flag.KILO_DISABLE_EMBEDDED_WEB_UI = true

    const response = await uiApp({ password: "secret", username: "kilo" }).request("/") // kilocode_change

    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
  })

  test("accepts auth token for the web UI", async () => {
    Flag.KILO_DISABLE_EMBEDDED_WEB_UI = true

    const response = await uiApp({
      password: "secret",
      // kilocode_change start
      username: "kilo",
    }).request(`/?auth_token=${btoa("kilo:secret")}`)

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not Found" })
    // kilocode_change end
  })

  test("accepts basic auth for the web UI", async () => {
    Flag.KILO_DISABLE_EMBEDDED_WEB_UI = true

    // kilocode_change start
    const response = await uiApp({ password: "secret", username: "kilo" }).request("/", {
      headers: { authorization: `Basic ${btoa("kilo:secret")}` },
      // kilocode_change end
    })

    // kilocode_change start
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not Found" })
    // kilocode_change end
  })

  // Regression for #25698 (Ope): the browser fetches the PWA manifest and
  // its icons via flows that don't carry app-managed credentials (the
  // `<link rel="manifest">` request is not under page-auth control), so the
  // server returning 401 breaks PWA install. These specific public assets
  // should bypass auth.
  test("allows public PWA assets through auth without proxying", async () => {
    // kilocode_change
    Flag.KILO_DISABLE_EMBEDDED_WEB_UI = true

    for (const path of ["/site.webmanifest", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]) {
      const response = await uiApp({
        password: "secret",
        username: "kilo", // kilocode_change
        client: httpClient(new Response("ok")),
      }).request(path)
      expect(response.status).toBe(404) // kilocode_change
    }
  })

  test("allows web UI preflight without auth", async () => {
    const response = await app({ password: "secret", username: "kilo" }).request("/", {
      // kilocode_change
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
      },
    })

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })
})
