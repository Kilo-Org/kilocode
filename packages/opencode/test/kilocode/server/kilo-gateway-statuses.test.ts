import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { NodeHttpServer } from "@effect/platform-node"
import { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"
import { describe, expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import type { Config } from "../../../src/config/config"
import { TestConfig } from "../../fixture/config"
import { KiloGatewayApi, KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { kiloGatewayHandlers } from "../../../src/kilocode/server/httpapi/handlers/kilo-gateway"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { Session } from "../../../src/session/session"
import { Storage } from "../../../src/storage/storage"
import { Authorization } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { testEffect } from "../../lib/effect"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(KiloGatewayApi)
const state: { info: Auth.Info | undefined; config: Config.Info } = {
  info: new Auth.Api({ type: "api", key: "test-token" }),
  config: {},
}
const auth = Layer.mock(Auth.Service)({
  get: () => Effect.sync(() => state.info),
})
const config = TestConfig.layer({ get: () => Effect.sync(() => state.config) })
const store = Layer.mock(InstanceStore.Service)({})
const cache = Layer.mock(ModelCache.Service)({})
const session = Layer.mock(Session.Service)({})
const storage = Layer.mock(Storage.Service)({})
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
      config,
      store,
      cache,
      session,
      AppNodeBuilder.build(EventV2Bridge.node),
    ]),
    Layer.provide(AppNodeBuilder.build(Database.node)),
    Layer.provide(storage),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
const it = testEffect(layer)

function stub(run: (url: string) => Response | Promise<Response>) {
  // These tests run sequentially; scope the process-global override and delegate in-process server traffic.
  const original = globalThis.fetch
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      if (url.startsWith("http://127.0.0.1:") && headers.get("authorization") !== "Bearer test-token") {
        return original(input, init)
      }
      return run(url)
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
  const error = new Error("ConnectionRefused")
  for (const failure of [
    {
      name: "network error",
      run: () => Promise.reject(error),
      message: "Error fetching balance",
      extra: { error },
    },
    {
      name: "HTTP error",
      run: () => new Response(null, { status: 503 }),
      message: "Failed to fetch balance",
      extra: { status: 503 },
    },
    {
      name: "invalid JSON",
      run: () => new Response("invalid"),
      message: "Error fetching balance",
      extra: { error: expect.any(SyntaxError) },
    },
  ]) {
    it.live(`keeps balance failures out of the terminal: ${failure.name}`, () =>
      Effect.gen(function* () {
        const previous = state.info
        const spies = yield* Effect.acquireRelease(
          Effect.sync(() => {
            state.info = new Auth.Oauth({ type: "oauth", access: "test-token", refresh: "", expires: 0 })
            return {
              console: spyOn(console, "warn").mockImplementation(() => {}),
              log: spyOn(Log.create({ service: "kilo-gateway" }), "warn").mockImplementation(() => {}),
            }
          }),
          (spies) =>
            Effect.sync(() => {
              state.info = previous
              spies.console.mockRestore()
              spies.log.mockRestore()
            }),
        )
        yield* stub((url) => {
          if (new URL(url).pathname === "/api/profile/balance") return failure.run()
          if (new URL(url).pathname === "/api/profile") return Response.json({ email: "test@example.com" })
          return Response.json({ subscription: null })
        })

        const response = yield* HttpClient.get(KiloGatewayPaths.profile)

        expect(response.status).toBe(200)
        expect(yield* response.json).toMatchObject({
          profile: { email: "test@example.com" },
          balance: null,
          kiloPass: null,
          currentOrgId: null,
        })
        expect(spies.console).not.toHaveBeenCalled()
        expect(spies.log.mock.calls).toEqual([[failure.message, failure.extra]])
      }),
    )
  }

  it.live("reports locally stored API authentication without a Gateway request", () =>
    Effect.gen(function* () {
      yield* stub(() => Promise.reject(new Error("unexpected Gateway request")))

      const response = yield* HttpClient.get(KiloGatewayPaths.authStatus)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual({ authenticated: true, type: "api" })
    }),
  )

  for (const context of [
    { name: "config", config: true, organization: "org-config" },
    { name: "oauth", config: true, oauth: true, organization: "org-oauth" },
    { name: "env", config: true, oauth: true, env: true, organization: "org-env" },
    { name: "url", url: true, organization: "org-url" },
    { name: "oauth over url", url: true, oauth: true, organization: "org-oauth" },
    { name: "env over url", url: true, oauth: true, env: true, organization: "org-env" },
    { name: "personal" },
    { name: "anonymous", anonymous: true, env: true, organization: "org-env" },
    { name: "anonymous config", anonymous: true, config: true, organization: "org-config" },
    { name: "anonymous url", anonymous: true, url: true, organization: "org-url" },
    { name: "anonymous-personal", anonymous: true },
  ] satisfies {
    name: string
    config?: boolean
    oauth?: boolean
    env?: boolean
    url?: boolean
    anonymous?: boolean
    organization?: string
  }[]) {
    it.live(`reports ${context.name} organization context locally without secrets`, () =>
      Effect.gen(function* () {
        const previous = { ...state }
        const env = process.env.KILO_ORG_ID
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            state.config = context.config
              ? { provider: { kilo: { options: { kilocodeOrganizationId: "org-config" } } } }
              : context.url
                ? { provider: { kilo: { options: { baseURL: "https://gateway.test/api/organizations/org-url" } } } }
                : {}
            state.info = context.anonymous
              ? undefined
              : new Auth.Oauth({
                  type: "oauth",
                  access: "test-token",
                  refresh: "private-refresh",
                  expires: Date.now() + 3600000,
                  ...(context.oauth ? { accountId: "org-oauth" } : {}),
                })
            if (context.env) process.env.KILO_ORG_ID = "org-env"
            else delete process.env.KILO_ORG_ID
          }),
          () =>
            Effect.sync(() => {
              Object.assign(state, previous)
              if (env === undefined) delete process.env.KILO_ORG_ID
              else process.env.KILO_ORG_ID = env
            }),
        )
        yield* stub(() => Promise.reject(new Error("unexpected Gateway request")))
        const response = yield* HttpClient.get(KiloGatewayPaths.authStatus)
        expect(response.status).toBe(200)
        expect(yield* response.json).toEqual({
          authenticated: !context.anonymous,
          ...(!context.anonymous ? { type: "oauth" } : {}),
          ...(context.organization ? { organizationId: context.organization } : {}),
        })
      }),
    )
  }

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
})
