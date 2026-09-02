import { describe, expect } from "bun:test"
import { NodeHttpServer } from "@effect/platform-node"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Effect, Layer } from "effect"
import { HttpClient, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { Auth } from "../../../src/auth"
import { KiloViewers } from "../../../src/kilocode/presence/service"
import { InstanceStore } from "../../../src/project/instance-store"
import { Session } from "../../../src/session/session"
import { ModelCache } from "../../../src/provider/model-cache"
import { Provider } from "../../../src/provider/provider"
import { ProviderAuth } from "../../../src/provider/auth"
import { ProviderApi } from "../../../src/server/routes/instance/httpapi/groups/provider"
import { providerHandlers } from "../../../src/server/routes/instance/httpapi/handlers/provider"
import { Authorization } from "../../../src/server/routes/instance/httpapi/middleware/authorization"
import { InstanceContextMiddleware } from "../../../src/server/routes/instance/httpapi/middleware/instance-context"
import {
  WorkspaceRouteContext,
  WorkspaceRoutingMiddleware,
} from "../../../src/server/routes/instance/httpapi/middleware/workspace-routing"
import { schemaErrorLayer } from "../../../src/server/routes/instance/httpapi/middleware/schema-error"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"

function catalog(id: string): ModelsDev.Provider {
  return {
    id,
    name: id,
    env: [],
    models: {
      model: {
        id: "model",
        name: "Model",
        release_date: "2026-01-01",
        attachment: false,
        reasoning: false,
        temperature: true,
        tool_call: true,
        limit: { context: 32000, output: 4096 },
      },
    },
  }
}

const catalogs = { external: catalog("external"), kilo: catalog("kilo") }
const providers = {
  external: Provider.fromModelsDevProvider(catalogs.external),
  kilo: Provider.fromModelsDevProvider(catalogs.kilo),
}
const state = { failure: false, connected: true }
const layer = HttpRouter.serve(
  HttpApiBuilder.layer(HttpApi.make("opencode-instance").addHttpApi(ProviderApi)).pipe(
    Layer.provide(providerHandlers),
    Layer.provide(schemaErrorLayer),
    Layer.provide([
      TestConfig.layer({ get: () => Effect.succeed({ enabled_providers: ["external", "kilo"] }) }),
      Layer.mock(Provider.Service)({
        list: () => Effect.succeed(state.connected ? providers : { external: providers.external }),
      }),
      Layer.mock(ProviderAuth.Service)({}),
      Layer.mock(ModelCache.Service)({ failedProviders: () => Effect.succeed([]) }),
      Layer.mock(Auth.Service)({
        get: () =>
          state.failure
            ? Effect.fail(new Auth.AuthError({ message: "Cannot read credentials" }))
            : Effect.succeed(undefined),
      }),
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
  { disableListenLog: true, disableLogger: true },
).pipe(
  Layer.provide([
    Layer.mock(ModelsDev.Service)({ get: () => Effect.succeed(catalogs) }),
    Layer.mock(InstanceStore.Service)({}),
    Layer.mock(Session.Service)({}),
    Layer.mock(KiloViewers.Service)({}),
  ]),
  Layer.provideMerge(NodeHttpServer.layerTest),
)
const it = testEffect(layer)

function configure(failure: boolean, connected: boolean) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const previous = { state: { ...state }, env: process.env.KILO_ORG_ID }
      Object.assign(state, { failure, connected })
      delete process.env.KILO_ORG_ID
      return previous
    }),
    (previous) =>
      Effect.sync(() => {
        Object.assign(state, previous.state)
        if (previous.env === undefined) {
          delete process.env.KILO_ORG_ID
          return
        }
        process.env.KILO_ORG_ID = previous.env
      }),
  )
}

describe("provider catalog authentication failures", () => {
  for (const connected of [false, true]) {
    it.live(`keeps other providers available when Kilo auth fails (connected: ${connected})`, () =>
      Effect.gen(function* () {
        yield* configure(true, connected)
        const response = yield* HttpClient.get("/provider")
        expect(response.status).toBe(200)
        const body = yield* response.json
        expect(body).toMatchObject({
          all: [{ id: "external" }],
          default: { external: "model" },
          connected: ["external"],
        })
        expect(JSON.stringify(body)).not.toContain('"kilo"')

        state.failure = false
        const recovered = yield* HttpClient.get("/provider")
        expect(recovered.status).toBe(200)
        expect(yield* recovered.json).toMatchObject({
          all: [{ id: "external" }, { id: "kilo" }],
          default: { external: "model", kilo: "model" },
          connected: connected ? ["external", "kilo"] : ["external"],
        })
      }),
    )
  }

  it.live("keeps the Personal catalog when credentials are absent rather than unreadable", () =>
    Effect.gen(function* () {
      yield* configure(false, false)
      const response = yield* HttpClient.get("/provider")
      expect(response.status).toBe(200)
      expect(yield* response.json).toMatchObject({
        all: [{ id: "external" }, { id: "kilo" }],
        default: { external: "model", kilo: "model" },
        connected: ["external"],
      })
    }),
  )
})
