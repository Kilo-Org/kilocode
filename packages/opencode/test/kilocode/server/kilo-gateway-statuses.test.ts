import { NodeHttpServer } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import { KiloGatewayApi, KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { kiloGatewayHandlers } from "../../../src/kilocode/server/httpapi/handlers/kilo-gateway"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { Session } from "../../../src/session/session"
import { Authorization } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { testEffect } from "../../lib/effect"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(KiloGatewayApi)
let authInfo: Auth.Info = new Auth.Api({ type: "api", key: "test-token" })
let disposedInstanceCount = 0
let clearedModelCacheCount = 0
const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(authInfo),
  set: (_providerID, info) =>
    Effect.sync(() => {
      authInfo = info
    }),
})
const store = Layer.mock(InstanceStore.Service)({
  disposeAll: () =>
    Effect.sync(() => {
      disposedInstanceCount += 1
    }),
})
const cache = Layer.mock(ModelCache.Service)({
  clear: () =>
    Effect.sync(() => {
      clearedModelCacheCount += 1
    }),
})
const session = Layer.mock(Session.Service)({})
const passthroughAuthorization = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)
const passthroughInstanceContext = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => effect),
)
const testWorkspaceRouting = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) =>
    effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory: process.cwd() }))),
  ),
)
const layer = HttpRouter.serve(
  HttpApiBuilder.layer(TestHttpApi).pipe(
    Layer.provide(kiloGatewayHandlers),
    Layer.provide(schemaErrorLayer),
    Layer.provide([
      passthroughAuthorization,
      passthroughInstanceContext,
      testWorkspaceRouting,
      auth,
      store,
      cache,
      session,
    ]),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
const it = testEffect(layer)

function stub(run: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  // These tests run sequentially; scope the process-global override and delegate in-process server traffic.
  const original = globalThis.fetch
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith("http://127.0.0.1:")) return original(input, init)
      return run(input, init)
    },
    { preconnect: original.preconnect },
  )
  return Effect.acquireRelease(
    Effect.sync(() => {
      globalThis.fetch = fetch
    }),
    () =>
      Effect.sync(() => {
        globalThis.fetch = original
      }),
  )
}

function post(path: string, body: Record<string, unknown>) {
  return HttpClientRequest.post(path).pipe(HttpClientRequest.bodyJson(body), Effect.flatMap(HttpClient.execute))
}

describe("Kilo gateway HttpApi statuses", () => {
  it.live("reports locally stored API authentication without a Gateway request", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new Error("unexpected Gateway request")))

      const response = yield* HttpClient.get(KiloGatewayPaths.authStatus)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ authenticated: true, type: "api" })
    }),
  )

  it.live("preserves cloud session list rate limits", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("rate limited", { status: 429 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSessions)

      expect(response.status).toBe(429)
      expect(yield* response.json).toEqual({ error: "Cloud sessions fetch failed: 429" })
    }),
  )

  it.live("maps cloud session list transport failures to internal errors", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSessions)

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Internal error" })
    }),
  )

  it.live("preserves missing cloud session previews", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("missing", { status: 404 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSession.replace(":id", "missing"))

      expect(response.status).toBe(404)
      expect(yield* response.json).toEqual({ error: "Session not found" })
    }),
  )

  it.live("preserves cloud session preview server failures", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("failed", { status: 500 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSession.replace(":id", "failed"))

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Failed to fetch session" })
    }),
  )

  it.live("maps cloud session preview transport failures to internal errors", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* HttpClient.get(KiloGatewayPaths.cloudSession.replace(":id", "failed"))

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Internal error" })
    }),
  )

  it.live("preserves cloud session import authentication failures", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("unauthorized", { status: 401 }))

      const response = yield* post(KiloGatewayPaths.cloudSessionImport, { sessionId: "unauthorized" })

      expect(response.status).toBe(401)
      expect(yield* response.json).toEqual({ error: "Import failed: 401" })
    }),
  )

  it.live("maps cloud session import transport failures to internal errors", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* post(KiloGatewayPaths.cloudSessionImport, { sessionId: "failed" })

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "Internal error" })
    }),
  )

  it.live("preserves KiloClaw worker failures", () =>
    Effect.gen(function* () {
      yield* stub(() => new Response("worker failed", { status: 500 }))

      const response = yield* HttpClient.get(KiloGatewayPaths.clawStatus)

      expect(response.status).toBe(500)
      expect(yield* response.json).toEqual({ error: "KiloClaw request failed: 500 worker failed" })
    }),
  )

  it.live("normalizes numeric KiloClaw timestamps", () =>
    Effect.gen(function* () {
      const started = 1_700_000_000_000
      yield* stub(() =>
        Response.json({
          status: "running",
          sandboxId: "sandbox",
          userId: "user",
          lastStartedAt: started,
          lastStoppedAt: null,
        }),
      )

      const response = yield* HttpClient.get(KiloGatewayPaths.clawStatus)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        status: "running",
        sandboxId: "sandbox",
        userId: "user",
        lastStartedAt: new Date(started).toISOString(),
        lastStoppedAt: null,
      })
    }),
  )

  it.live("maps KiloClaw transport failures to bad gateway", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new TypeError("network error")))

      const response = yield* HttpClient.get(KiloGatewayPaths.clawStatus)

      expect(response.status).toBe(502)
      expect(yield* response.json).toEqual({ error: "Failed to reach KiloClaw" })
    }),
  )

  it.live("clears a selected organization omitted from the profile", () =>
    Effect.gen(function* () {
      const expires = Date.now() + 60_000
      authInfo = new Auth.Oauth({
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires,
        accountId: "parent-organization",
        enterpriseUrl: "https://enterprise.example.com",
      })
      disposedInstanceCount = 0
      clearedModelCacheCount = 0

      yield* stub((input, init) => {
        const request = new Request(input, init)
        if (request.url.endsWith("/api/profile")) {
          return Response.json({
            user: { email: "member@example.com" },
            organizations: [{ id: "child-organization", name: "Child Organization", role: "member" }],
          })
        }
        if (request.url.endsWith("/api/profile/balance")) {
          expect(request.headers.get("x-kilocode-organizationid")).toBeNull()
          return Response.json({ balance: 42 })
        }
        return new Response("unexpected Gateway request", { status: 500 })
      })

      const response = yield* HttpClient.get(KiloGatewayPaths.profile)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({
        profile: {
          email: "member@example.com",
          name: null,
          organizations: [{ id: "child-organization", name: "Child Organization", role: "member" }],
        },
        balance: { balance: 42 },
        currentOrgId: null,
      })
      expect(authInfo).toEqual(
        new Auth.Oauth({
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires,
          enterpriseUrl: "https://enterprise.example.com",
        }),
      )
      expect(clearedModelCacheCount).toBe(1)
      expect(disposedInstanceCount).toBe(1)
    }),
  )
})
