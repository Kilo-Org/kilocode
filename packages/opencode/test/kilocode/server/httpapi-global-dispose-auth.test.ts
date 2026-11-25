import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { MoveSession } from "@opencode-ai/core/control-plane/move-session"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import { GlobalBus, type GlobalEvent } from "../../../src/bus/global"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { Installation } from "../../../src/installation"
import { registerBeforeDisposer } from "../../../src/kilocode/effect/instance-registry"
import { KiloViewers } from "../../../src/kilocode/presence/service"
import { KiloGatewayApi, KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { kiloGatewayHandlers } from "../../../src/kilocode/server/httpapi/handlers/kilo-gateway"
import { InstanceStore } from "../../../src/project/instance-store"
import { ProviderAuth } from "../../../src/provider/auth"
import { ModelCache } from "../../../src/provider/model-cache"
import { Provider } from "../../../src/provider/provider"
import { ServerAuth } from "../../../src/server/auth"
import { Event } from "../../../src/server/event"
import { RootHttpApi } from "../../../src/server/routes/instance/httpapi/api"
import { GlobalPaths } from "../../../src/server/routes/instance/httpapi/groups/global"
import { ProviderApi } from "../../../src/server/routes/instance/httpapi/groups/provider"
import { controlHandlers } from "../../../src/server/routes/instance/httpapi/handlers/control"
import { controlPlaneHandlers } from "../../../src/server/routes/instance/httpapi/handlers/control-plane"
import { globalHandlers } from "../../../src/server/routes/instance/httpapi/handlers/global"
import { providerHandlers } from "../../../src/server/routes/instance/httpapi/handlers/provider"
import { Authorization, authorizationLayer } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { Storage } from "../../../src/storage/storage"
import { TestConfig } from "../../fixture/config"
import { testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const state = {
  records: {} as Record<string, Auth.Info>,
  cleared: [] as string[],
  presence: 0,
}

const auth = Layer.succeed(
  Auth.Service,
  Auth.Service.of({
    get: (id) => Effect.sync(() => state.records[id]),
    all: () => Effect.sync(() => ({ ...state.records })),
    set: (id, value) =>
      Effect.sync(() => {
        state.records[id] = value
      }),
    remove: (id) =>
      Effect.sync(() => {
        delete state.records[id]
      }),
  }),
)

const cache = Layer.mock(ModelCache.Service)({
  clear: (id) =>
    Effect.sync(() => {
      state.cleared.push(id)
    }),
})

const viewers = Layer.mock(KiloViewers.Service)({
  invalidateAuth: () =>
    Effect.sync(() => {
      state.presence += 1
    }),
})

const credentials = Layer.mock(Credential.Service)({
  list: () => Effect.succeed([]),
  remove: () => Effect.void,
})

const InstanceApi = HttpApi.make("opencode-instance").addHttpApi(ProviderApi).addHttpApi(KiloGatewayApi)

const api = HttpRouter.serve(
  Layer.mergeAll(
    HttpApiBuilder.layer(RootHttpApi).pipe(
      Layer.provide([controlHandlers, controlPlaneHandlers, globalHandlers]),
      Layer.provide([authorizationLayer, schemaErrorLayer]),
    ),
    HttpApiBuilder.layer(InstanceApi).pipe(
      Layer.provide([providerHandlers, kiloGatewayHandlers]),
      Layer.provide(schemaErrorLayer),
      Layer.provide([
        Layer.succeed(
          Authorization,
          Authorization.of((effect) => effect),
        ),
        Layer.succeed(
          InstanceContextMiddleware,
          InstanceContextMiddleware.of((effect) => effect),
        ),
        Layer.succeed(
          WorkspaceRoutingMiddleware,
          WorkspaceRoutingMiddleware.of((effect) =>
            effect.pipe(
              Effect.provideService(WorkspaceRouteContext, WorkspaceRouteContext.of({ directory: process.cwd() })),
            ),
          ),
        ),
      ]),
    ),
  ),
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(testInstanceStoreLayer),
  Layer.provide(auth),
  Layer.provide(TestConfig.layer()),
  Layer.provide(cache),
  Layer.provide(viewers),
  Layer.provide(credentials),
  Layer.provide(Layer.mock(MoveSession.Service)({})),
  Layer.provide(Layer.mock(Installation.Service)({})),
  Layer.provide(Layer.mock(Provider.Service)({})),
  Layer.provide(
    Layer.mock(ProviderAuth.Service)({
      callback: () => Effect.void,
    }),
  ),
  Layer.provide(Layer.mock(ModelsDev.Service)({ get: () => Effect.succeed({}) })),
  Layer.provide(AppNodeBuilder.build(EventV2Bridge.node)),
  Layer.provide(AppNodeBuilder.build(Database.node)),
  Layer.provide(Layer.mock(Storage.Service)({})),
  Layer.provide(ServerAuth.Config.configLayer({ password: Option.none(), username: "opencode" })),
  // Raw HttpApi routes expose an opaque handler context at the web boundary.
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  Layer.provide(Layer.succeedContext(Context.empty() as Context.Context<unknown>)),
)

const it = testEffect(api)

function capture() {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const list: GlobalEvent[] = []
      const on = (event: GlobalEvent) => {
        list.push(event)
      }
      GlobalBus.on("event", on)
      return { list, on }
    }),
    (item) =>
      Effect.sync(() => {
        GlobalBus.off("event", item.on)
      }),
  ).pipe(Effect.map((item) => item.list))
}

function fail(dir: string) {
  return Effect.acquireRelease(
    Effect.sync(() =>
      registerBeforeDisposer((target) => {
        if (target === dir) throw new Error(`disposer failure for ${dir}`)
        return undefined
      }),
    ),
    (off) => Effect.sync(off),
  )
}

function setup() {
  return Effect.gen(function* () {
    state.records = {}
    state.cleared = []
    state.presence = 0
    const main = yield* tmpdirScoped()
    const worktree = yield* tmpdirScoped()
    const store = yield* InstanceStore.Service
    yield* store.load({ directory: main })
    yield* store.load({ directory: worktree })
    yield* fail(worktree)
    const bus = yield* capture()
    const refreshes = yield* Ref.make(0)
    yield* ModelsRefresh.watch(() => Ref.update(refreshes, (count) => count + 1))
    return { main, worktree, store, bus, refreshes }
  })
}

function disposed(events: GlobalEvent[]) {
  return events.some((event) => event.directory === "global" && event.payload.type === Event.Disposed.type)
}

describe("global dispose and auth lifecycle HttpApi", () => {
  it.live("POST /global/dispose returns 200 and emits global.disposed even when a worktree disposer fails", () =>
    Effect.gen(function* () {
      const ctx = yield* setup()

      const res = yield* HttpClient.execute(HttpClientRequest.post(GlobalPaths.dispose))

      expect(res.status).toBe(200)
      expect(yield* res.json).toBe(true)
      expect(yield* ctx.store.list()).toEqual([])
      expect(disposed(ctx.bus)).toBe(true)
    }),
  )

  it.live(
    "PUT /auth/:providerID emits global.disposed and notifies ModelsRefresh despite worktree disposer failure",
    () =>
      Effect.gen(function* () {
        const ctx = yield* setup()

        const res = yield* HttpClientRequest.put("/auth/kilo").pipe(
          HttpClientRequest.bodyJsonUnsafe({ type: "api", key: "kilo-secret" }),
          HttpClient.execute,
        )

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
        expect(state.cleared).toEqual(["kilo"])
        expect(state.presence).toBe(1)
        expect(yield* ctx.store.list()).toEqual([])
        expect(yield* Ref.get(ctx.refreshes)).toBe(1)
        expect(disposed(ctx.bus)).toBe(true)
      }),
  )

  it.live(
    "DELETE /auth/:providerID emits global.disposed and notifies ModelsRefresh despite worktree disposer failure",
    () =>
      Effect.gen(function* () {
        const ctx = yield* setup()
        state.records.kilo = new Auth.Api({ type: "api", key: "kilo-secret" })

        const res = yield* HttpClient.execute(HttpClientRequest.delete("/auth/kilo"))

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
        expect(state.records.kilo).toBeUndefined()
        expect(state.cleared).toEqual(["kilo"])
        expect(state.presence).toBe(1)
        expect(yield* ctx.store.list()).toEqual([])
        expect(yield* Ref.get(ctx.refreshes)).toBe(1)
        expect(disposed(ctx.bus)).toBe(true)
      }),
  )

  it.live(
    "POST /provider/:providerID/oauth/callback emits global.disposed and notifies ModelsRefresh despite worktree disposer failure",
    () =>
      Effect.gen(function* () {
        const ctx = yield* setup()

        const res = yield* HttpClientRequest.post("/provider/kilo/oauth/callback").pipe(
          HttpClientRequest.bodyJsonUnsafe({ method: 0 }),
          HttpClient.execute,
        )

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
        expect(state.presence).toBe(1)
        expect(yield* ctx.store.list()).toEqual([])
        expect(yield* Ref.get(ctx.refreshes)).toBe(1)
        expect(disposed(ctx.bus)).toBe(true)
      }),
  )

  it.live(
    "POST /kilo/organization emits global.disposed and notifies ModelsRefresh despite worktree disposer failure",
    () =>
      Effect.gen(function* () {
        const ctx = yield* setup()
        state.records.kilo = new Auth.Oauth({
          type: "oauth",
          access: "kilo-access",
          refresh: "kilo-refresh",
          expires: Date.now() + 3_600_000,
          accountId: "org-1",
        })

        const res = yield* HttpClientRequest.post(KiloGatewayPaths.organization).pipe(
          HttpClientRequest.bodyJsonUnsafe({ organizationId: "org-2" }),
          HttpClient.execute,
        )

        expect(res.status).toBe(200)
        expect(yield* res.json).toBe(true)
        expect(state.records.kilo).toMatchObject({ type: "oauth", accountId: "org-2" })
        expect(state.cleared).toEqual(["kilo"])
        expect(yield* ctx.store.list()).toEqual([])
        expect(yield* Ref.get(ctx.refreshes)).toBe(1)
        expect(disposed(ctx.bus)).toBe(true)
      }),
  )
})
