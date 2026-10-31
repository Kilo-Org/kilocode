// kilocode_change - new file
// The endpoint discovery route resolves its gateway URL and credentials through
// ModelCache.options, the same resolution the models catalog uses, and applies
// the catalog's organization compatibility rule before any request leaves.
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { NodeHttpServer } from "@effect/platform-node"
import { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { HEADER_ORGANIZATIONID } from "@kilocode/kilo-gateway"
import { Auth } from "../../../src/auth"
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

Log.init({ print: false })

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(KiloGatewayApi)
const state: { options: ModelCache.Options | undefined } = { options: undefined }
const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(new Auth.Api({ type: "api", key: "test-token" })),
})
const config = TestConfig.layer({ get: () => Effect.succeed({}) })
const store = Layer.mock(InstanceStore.Service)({})
// The public catalog must never consult the Kilo credentials.
const cache = Layer.mock(ModelCache.Service)({
  options: () =>
    state.options ? Effect.succeed(state.options) : Effect.die(new Error("unexpected credential resolution")),
})
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

type Captured = { url: string; headers: Headers }

function stub(requests: Captured[]) {
  // Scope the process-global override and delegate in-process server traffic.
  const original = globalThis.fetch
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith("http://127.0.0.1:")) return original(input, init)
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
      requests.push({ url, headers })
      return Response.json({ data: { endpoints: [{ tag: "gmicloud/fp8", provider_name: "GMICloud" }] } })
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

function resolving(options: ModelCache.Options | undefined) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      state.options = options
    }),
    () =>
      Effect.sync(() => {
        state.options = undefined
      }),
  )
}

const endpoints = [{ provider: "gmicloud/fp8", name: "GMICloud" }]

describe("Kilo gateway model endpoints", () => {
  it.live("sends the kilo catalog request to the resolved gateway with its credentials", () =>
    Effect.gen(function* () {
      yield* resolving({
        baseURL: "https://gateway.test",
        kilocodeToken: "private-token",
        kilocodeOrganizationId: "org-a",
      })
      const requests: Captured[] = []
      yield* stub(requests)

      const response = yield* HttpClient.get(`${KiloGatewayPaths.modelEndpoints}?model=z-ai/glm-4.6`)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual(endpoints)
      expect(requests.map((request) => request.url)).toEqual([
        "https://gateway.test/api/gateway/models/z-ai/glm-4.6/endpoints",
      ])
      expect(requests[0]?.headers.get("authorization")).toBe("Bearer private-token")
      expect(requests[0]?.headers.get(HEADER_ORGANIZATIONID)).toBe("org-a")
    }),
  )

  it.live("rejects an organization the resolved gateway URL is not scoped to without a request", () =>
    Effect.gen(function* () {
      yield* resolving({
        baseURL: "https://gateway.test/api/organizations/org-pinned",
        kilocodeToken: "private-token",
        kilocodeOrganizationId: "org-env",
      })
      const requests: Captured[] = []
      yield* stub(requests)

      const response = yield* HttpClient.get(`${KiloGatewayPaths.modelEndpoints}?model=z-ai/glm-4.6`)

      expect(response.status).toBe(400)
      expect(requests).toEqual([])
    }),
  )

  it.live("queries the public catalog without resolving or sending Kilo credentials", () =>
    Effect.gen(function* () {
      const requests: Captured[] = []
      yield* stub(requests)

      const response = yield* HttpClient.get(`${KiloGatewayPaths.modelEndpoints}?model=z-ai/glm-4.6&catalog=public`)

      expect(response.status).toBe(200)
      expect(yield* response.json).toEqual(endpoints)
      expect(requests.map((request) => request.url)).toEqual([
        "https://openrouter.ai/api/v1/models/z-ai/glm-4.6/endpoints",
      ])
      expect(requests[0]?.headers.get("authorization")).toBeNull()
      expect(requests[0]?.headers.get(HEADER_ORGANIZATIONID)).toBeNull()
    }),
  )
})
