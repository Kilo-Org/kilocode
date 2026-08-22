import { NodeHttpServer } from "@effect/platform-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Integration } from "@opencode-ai/core/integration"
import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { KiloGatewayApi, KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { kiloGatewayHandlers } from "../../../src/kilocode/server/httpapi/handlers/kilo-gateway"
import { InstanceStore } from "../../../src/project/instance-store"
import { ModelCache } from "../../../src/provider/model-cache"
import { Authorization } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { Session } from "../../../src/session/session"
import { Storage } from "../../../src/storage/storage"
import { testEffect } from "../../lib/effect"

const TestHttpApi = HttpApi.make("opencode-instance").addHttpApi(KiloGatewayApi)
const AuthFile = Schema.Record(Schema.String, Auth.Info)
const state: { file: Record<string, Auth.Info>; cleared: boolean; disposed: boolean; fail: boolean } = {
  file: {},
  cleared: false,
  disposed: false,
  fail: false,
}
const auth = Layer.mock(Auth.Service)({
  get: (key) => Effect.sync(() => state.file[key]),
  set: (key, info) =>
    Effect.sync(() => {
      state.file = { ...state.file, [key]: info }
    }),
})
const store = Layer.mock(InstanceStore.Service)({
  disposeAll: () => Effect.sync(() => void (state.disposed = true)),
})
const cache = Layer.mock(ModelCache.Service)({
  clear: () => Effect.sync(() => void (state.cleared = true)),
})
const session = Layer.mock(Session.Service)({})
const storage = Layer.mock(Storage.Service)({})
const fs = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const service = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...service,
      readJson: () => Effect.sync(() => state.file),
      writeJson: (_path, data) =>
        Effect.suspend(() => {
          if (state.fail) {
            state.fail = false
            return Effect.fail(new FSUtil.FileSystemError({ method: "writeJson" }))
          }
          state.file = Schema.decodeUnknownSync(AuthFile)(data)
          return Effect.void
        }),
    })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))
const database = Database.layerFromPath(":memory:")
const credentials = Credential.layer.pipe(
  Layer.provide(database),
  Layer.provide(fs),
  Layer.provide(Global.layerWith({ data: "/test" })),
)
const authorization = Layer.succeed(
  Authorization,
  Authorization.of((effect) => effect),
)
const instance = Layer.succeed(
  InstanceContextMiddleware,
  InstanceContextMiddleware.of((effect) => effect),
)
const workspace = Layer.succeed(
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingMiddleware.of((effect) =>
    effect.pipe(Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory: process.cwd() }))),
  ),
)
const server = HttpRouter.serve(
  HttpApiBuilder.layer(TestHttpApi).pipe(
    Layer.provide(kiloGatewayHandlers),
    Layer.provide(schemaErrorLayer),
    Layer.provide([
      authorization,
      instance,
      workspace,
      auth,
      store,
      cache,
      session,
      AppNodeBuilder.build(EventV2Bridge.node),
    ]),
    Layer.provide(database),
    Layer.provide(storage),
    Layer.provide(credentials),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(Layer.provideMerge(NodeHttpServer.layerTest))
const it = testEffect(Layer.mergeAll(server, credentials))

function select(organizationId: string | null) {
  return HttpClientRequest.post(KiloGatewayPaths.organization).pipe(
    HttpClientRequest.bodyJson({ organizationId }),
    Effect.flatMap(HttpClient.execute),
  )
}

function oauth(metadata: Record<string, unknown>) {
  return Credential.OAuth.make({
    type: "oauth",
    methodID: Integration.MethodID.make("oauth"),
    refresh: "core-refresh",
    access: "core-access",
    expires: 456,
    metadata,
  })
}

describe("Kilo organization selection", () => {
  it.live("synchronizes Personal to organization without restarting the backend", () =>
    Effect.gen(function* () {
      state.file = {}
      state.cleared = false
      state.disposed = false
      state.fail = false
      const service = yield* Credential.Service
      const created = yield* service.create({
        integrationID: Integration.ID.make("kilo"),
        label: "Kilo",
        value: oauth({ enterpriseURL: "https://enterprise.example.com" }),
      })
      state.file = {
        kilo: new Auth.Oauth({
          type: "oauth",
          refresh: "legacy-refresh",
          access: "legacy-access",
          expires: 123,
          enterpriseUrl: "https://legacy.example.com",
        }),
      }

      const response = yield* select("org-new")

      expect(response.status).toBe(200)
      expect(state.file.kilo).toEqual(
        new Auth.Oauth({
          type: "oauth",
          refresh: "legacy-refresh",
          access: "legacy-access",
          expires: 123,
          enterpriseUrl: "https://legacy.example.com",
          accountId: "org-new",
        }),
      )
      expect((yield* service.get(created.id))?.value).toEqual(
        oauth({ enterpriseURL: "https://enterprise.example.com", accountID: "org-new" }),
      )
      expect(state.cleared).toBe(true)
      expect(state.disposed).toBe(true)
    }),
  )

  it.live("synchronizes organization to Personal without restarting the backend", () =>
    Effect.gen(function* () {
      state.file = {}
      state.cleared = false
      state.disposed = false
      state.fail = false
      const service = yield* Credential.Service
      const created = yield* service.create({
        integrationID: Integration.ID.make("kilo"),
        label: "Kilo",
        value: oauth({ enterpriseURL: "https://enterprise.example.com", accountID: "org-old" }),
      })
      state.file = {
        kilo: new Auth.Oauth({
          type: "oauth",
          refresh: "legacy-refresh",
          access: "legacy-access",
          expires: 123,
          enterpriseUrl: "https://legacy.example.com",
          accountId: "org-old",
        }),
      }

      const response = yield* select(null)
      const value = (yield* service.get(created.id))?.value

      expect(response.status).toBe(200)
      expect(state.file.kilo).toEqual(
        new Auth.Oauth({
          type: "oauth",
          refresh: "legacy-refresh",
          access: "legacy-access",
          expires: 123,
          enterpriseUrl: "https://legacy.example.com",
        }),
      )
      expect(value).toEqual(oauth({ enterpriseURL: "https://enterprise.example.com" }))
      expect(value?.metadata).not.toHaveProperty("accountID")
      expect(state.cleared).toBe(true)
      expect(state.disposed).toBe(true)
    }),
  )

  it.live("does not update Auth or dispose locations without an active Core OAuth credential", () =>
    Effect.gen(function* () {
      const initial = new Auth.Oauth({
        type: "oauth",
        refresh: "legacy-refresh",
        access: "legacy-access",
        expires: 123,
      })
      state.file = { kilo: initial }
      state.cleared = false
      state.disposed = false
      state.fail = false

      const response = yield* select("org-new")

      expect(response.status).toBe(401)
      expect(state.file.kilo).toEqual(initial)
      expect(state.cleared).toBe(false)
      expect(state.disposed).toBe(false)
    }),
  )

  it.live("rolls back Core when its legacy Auth write fails", () =>
    Effect.gen(function* () {
      state.file = {}
      state.cleared = false
      state.disposed = false
      state.fail = false
      const service = yield* Credential.Service
      const created = yield* service.create({
        integrationID: Integration.ID.make("kilo"),
        label: "Kilo",
        value: oauth({ enterpriseURL: "https://enterprise.example.com" }),
      })
      const initial = new Auth.Oauth({
        type: "oauth",
        refresh: "legacy-refresh",
        access: "legacy-access",
        expires: 123,
        enterpriseUrl: "https://legacy.example.com",
      })
      state.file = { kilo: initial }
      state.fail = true

      const response = yield* select("org-new")

      expect(response.status).toBe(500)
      expect(state.file.kilo).toEqual(initial)
      expect((yield* service.get(created.id))?.value).toEqual(
        oauth({ enterpriseURL: "https://enterprise.example.com" }),
      )
      expect(state.cleared).toBe(false)
      expect(state.disposed).toBe(false)
    }),
  )
})
