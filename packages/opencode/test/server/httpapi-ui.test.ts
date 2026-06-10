import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
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
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { ServerAuth } from "../../src/server/auth"
import { authorizationRouterMiddleware } from "../../src/server/routes/instance/httpapi/middleware/authorization"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { serveEmbeddedUIEffect, serveUIEffect } from "../../src/server/shared/ui"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const testStateLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const original = {
      KILO_SERVER_PASSWORD: Flag.KILO_SERVER_PASSWORD,
      KILO_SERVER_USERNAME: Flag.KILO_SERVER_USERNAME,
      envPassword: process.env.KILO_SERVER_PASSWORD,
      envUsername: process.env.KILO_SERVER_USERNAME,
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        Flag.KILO_SERVER_PASSWORD = original.KILO_SERVER_PASSWORD
        Flag.KILO_SERVER_USERNAME = original.KILO_SERVER_USERNAME
        restoreEnv("KILO_SERVER_PASSWORD", original.envPassword)
        restoreEnv("KILO_SERVER_USERNAME", original.envUsername)
      }),
    )
  }),
)

const it = testEffect(Layer.mergeAll(testStateLayer, AppFileSystem.defaultLayer, RuntimeFlags.layer()))

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function app(input?: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
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
      return Effect.promise((): Promise<Response> =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function uiApp(input?: {
  password?: string
  username?: string
  client?: Layer.Layer<HttpClient.HttpClient>
  disableEmbeddedWebUi?: boolean
}) {
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        const flags = yield* RuntimeFlags.Service
        yield* router.add("*", "/*", (request) =>
          serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
        )
      }),
    ).pipe(
      Layer.provide(authorizationRouterMiddleware.layer.pipe(Layer.provide(ServerAuth.Config.defaultLayer))),
      Layer.provide([
        AppFileSystem.defaultLayer,
        input?.client ?? httpClient(new Response("ui")),
        RuntimeFlags.layer({ disableEmbeddedWebUi: input?.disableEmbeddedWebUi ?? false }),
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
      return Effect.promise((): Promise<Response> =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
      )
    },
  }
}

function routeOrderingApp() {
  let proxiedUrl: string | undefined
  const handler = HttpRouter.toWebHandler(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const client = yield* HttpClient.HttpClient
        const flags = yield* RuntimeFlags.Service
        yield* router.add("GET", "/session/:sessionID", () =>
          Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })),
        )
        yield* router.add("*", "/*", (request) =>
          serveUIEffect(request, { fs, client, disableEmbeddedWebUi: flags.disableEmbeddedWebUi }),
        )
      }),
    ).pipe(
      Layer.provide([
        AppFileSystem.defaultLayer,
        RuntimeFlags.layer({ disableEmbeddedWebUi: true }),
        httpClient(new Response("ui"), (request) => {
          proxiedUrl = request.url
        }),
        HttpServer.layerServices,
      ]),
    ),
    { disableLogger: true },
  ).handler
  return {
    proxiedUrl: () => proxiedUrl,
    request(input: string | URL | Request, init?: RequestInit) {
      return Effect.promise((): Promise<Response> =>
        Promise.resolve(
          handler(
            input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
            HttpApiApp.context,
          ),
        ),
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

function responseText(response: Response) {
  return Effect.promise(() => response.text())
}

describe("HttpApi UI fallback", () => {
  // kilocode_change start - embedded UI is the only supported fallback; never proxy to app.opencode.ai
  it.live("returns not found without proxying when embedded UI is disabled", () =>
    Effect.gen(function* () {
      let proxied = false
      const response = yield* uiApp({
        disableEmbeddedWebUi: true,
        client: httpClient(new Response("ui"), () => {
          proxied = true
        }),
      }).request("/")

      expect(response.status).toBe(404)
      expect(yield* Effect.promise(() => response.json())).toEqual({ error: "Not Found" })
      expect(proxied).toBe(false)
    }),
  )
  // kilocode_change end

  it.live("serves embedded UI assets when Bun can read them but access reports missing", () =>
    Effect.gen(function* () {
      let readPath: string | undefined

      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
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
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      expect(response.status).toBe(200)
      expect(readPath).toBe("/$bunfs/root/assets/app.js")
      expect(response.headers.get("content-type")).toContain("text/javascript")
      expect(yield* responseText(response)).toBe("console.log('embedded')")
    }),
  )

  it.live("allows embedded UI terminal wasm and theme preload CSP", () =>
    Effect.gen(function* () {
      const script = 'document.documentElement.dataset.theme = "dark"'

      const fs = yield* AppFileSystem.Service
      const response = yield* serveEmbeddedUIEffect(
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
      ).pipe(Effect.map(HttpServerResponse.toWeb))

      const csp = response.headers.get("content-security-policy") ?? ""
      expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'")
      expect(csp).toContain(`'sha256-${createHash("sha256").update(script).digest("base64")}'`)
      expect(csp).toContain("connect-src * data:")
    }),
  )

  it.live("keeps matched API routes ahead of the UI fallback", () =>
    Effect.gen(function* () {
      const server = routeOrderingApp()
      const response = yield* server.request("/session/ses_nope")

      expect(response.status).toBe(404)
      expect(server.proxiedUrl()).toBeUndefined()
    }),
  )

  it.live("requires server password for the web UI", () =>
    Effect.gen(function* () {
      const response = yield* uiApp({
        password: "secret",
        username: "kilo", // kilocode_change
        disableEmbeddedWebUi: true,
      }).request("/")

      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="Secure Area"')
    }),
  )

  it.live("accepts auth token for the web UI", () =>
    Effect.gen(function* () {
      let proxied = false // kilocode_change
      const response = yield* uiApp({
        password: "secret",
        username: "kilo", // kilocode_change
        disableEmbeddedWebUi: true,
        // kilocode_change start - authenticated requests still must not proxy when embedded UI is disabled
        client: httpClient(new Response("<html>kilo</html>", { headers: { "content-type": "text/html" } }), () => {
          proxied = true
        }),
        // kilocode_change end
      }).request(`/?auth_token=${btoa("kilo:secret")}`)

      // kilocode_change start
      expect(response.status).toBe(404)
      expect(yield* Effect.promise(() => response.json())).toEqual({ error: "Not Found" })
      expect(proxied).toBe(false)
      // kilocode_change end
    }),
  )

  it.live("accepts basic auth for the web UI", () =>
    Effect.gen(function* () {
      let proxied = false // kilocode_change
      const response = yield* uiApp({
        password: "secret",
        username: "kilo", // kilocode_change
        disableEmbeddedWebUi: true,
        // kilocode_change start
        client: httpClient(new Response("ui"), () => {
          proxied = true
        }),
        // kilocode_change end
      }).request("/", {
        headers: { authorization: `Basic ${btoa("kilo:secret")}` },
      })

      // kilocode_change start
      expect(response.status).toBe(404)
      expect(yield* Effect.promise(() => response.json())).toEqual({ error: "Not Found" })
      expect(proxied).toBe(false)
      // kilocode_change end
    }),
  )

  // Regression for #25698 (Ope): the browser fetches the PWA manifest and
  // its icons via flows that don't carry app-managed credentials (the
  // `<link rel="manifest">` request is not under page-auth control), so the
  // server returning 401 breaks PWA install. These specific public assets
  // should bypass auth.
  it.live("serves the PWA manifest without auth even when a server password is set", () =>
    Effect.gen(function* () {
      for (const path of ["/site.webmanifest", "/web-app-manifest-192x192.png", "/web-app-manifest-512x512.png"]) {
        const response = yield* uiApp({
          password: "secret",
          username: "kilo", // kilocode_change
          disableEmbeddedWebUi: true,
          client: httpClient(new Response("ok")),
        }).request(path)
        expect(response.status).not.toBe(401)
      }
    }),
  )

  it.live("allows web UI preflight without auth", () =>
    Effect.gen(function* () {
      const response = yield* app({ password: "secret", username: "kilo" }).request("/", {
        // kilocode_change
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "GET",
        },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
    }),
  )
})
