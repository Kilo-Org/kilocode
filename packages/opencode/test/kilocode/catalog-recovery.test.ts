import { expect, spyOn } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Option, Ref, ScopedCache } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { FetchHttpClient } from "effect/unstable/http"
import type { KiloModelsResult } from "@kilocode/kilo-gateway"
import * as Core from "@opencode-ai/core/models-dev"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { InstanceState } from "../../src/effect/instance-state"
import * as ModelsRefresh from "../../src/kilocode/provider/models-refresh"
import { ModelCache } from "../../src/provider/model-cache"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { TestConfig } from "../fixture/config"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Options = Parameters<ModelCache.KiloModels["fetch"]>[0]

const catalog = {
  models: {
    allowed: {
      id: "allowed",
      name: "Allowed",
      release_date: "",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      limit: { context: 128000, output: 4096 },
    },
  },
}

function layer(
  calls: Ref.Ref<Options[]>,
  results: KiloModelsResult[],
  cfg = TestConfig.layer(),
  gates?: { started: Deferred.Deferred<void>; wait: Deferred.Deferred<void> },
) {
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(cfg),
    Layer.provide(Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })),
    Layer.provide(
      Layer.succeed(ModelCache.KiloModelsService, {
        fetch: (options) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (list) => [...list, options])
            if (gates && (yield* Ref.get(calls)).length === 1) {
              yield* Deferred.succeed(gates.started, undefined)
              yield* Deferred.await(gates.wait)
            }
            return results.at((yield* Ref.get(calls)).length - 1) ?? results.at(-1)!
          }),
      }),
    ),
  )
}

const it = testEffect(testInstanceStoreLayer)
const options = { kilocodeOrganizationId: "org-a", kilocodeToken: "org-token" }

it.effect("continues catalog recovery after its only caller times out", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const caller = yield* cache.fetch("kilo", options).pipe(Effect.timeoutOption("1 second"), Effect.forkChild)
        yield* Deferred.await(started)
        yield* TestClock.adjust("1 second")
        expect(Option.isNone(yield* Fiber.join(caller))).toBe(true)
        yield* Deferred.succeed(wait, undefined)
        yield* TestClock.adjust("30 seconds")
        expect(yield* cache.get("kilo")).toEqual(catalog.models)
        expect(yield* Ref.get(calls)).toEqual([options, options])
      }),
    ).pipe(
      Effect.provide(
        layer(calls, [{ models: {}, error: { kind: "network" } }, catalog], TestConfig.layer(), { started, wait }),
      ),
    )
  }),
)

for (const result of [
  { models: {}, error: { kind: "network" } },
  { models: {}, error: { kind: "http", status: 503 } },
  { models: {} },
] satisfies KiloModelsResult[]) {
  it.effect(`recovers initialized worktrees after ${result.error?.kind ?? "empty"} catalog results`, () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<Options[]>([])
      yield* Effect.gen(function* () {
        const cache = yield* ModelCache.Service
        const state = yield* InstanceState.make(() => cache.fetch("kilo", options))
        yield* ModelsRefresh.watch(state)
        expect(yield* ScopedCache.get(state.cache, "first")).toEqual({})
        expect(yield* ScopedCache.get(state.cache, "second")).toEqual({})
        expect((yield* Ref.get(calls)).length).toBe(1)
        yield* TestClock.adjust("29 seconds")
        expect((yield* Ref.get(calls)).length).toBe(1)
        yield* TestClock.adjust("1 second")
        expect(yield* cache.get("kilo")).toEqual(catalog.models)
        expect(yield* ScopedCache.get(state.cache, "first")).toEqual(catalog.models)
        expect(yield* ScopedCache.get(state.cache, "second")).toEqual(catalog.models)
        expect(yield* cache.getFailure("kilo")).toBeUndefined()
        expect(yield* Ref.get(calls)).toEqual([options, options])
        yield* TestClock.adjust("10 minutes")
        expect((yield* Ref.get(calls)).length).toBe(2)
      }).pipe(Effect.provide(layer(calls, [result, catalog])), provideInstance(process.cwd()))
    }),
  )
}

it.effect("backs off repeated failures and keeps one retry across explicit refreshes", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const result: KiloModelsResult = { models: {}, error: { kind: "network" } }
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", options)
        yield* cache.refresh("kilo", options)
        yield* TestClock.adjust("30 seconds")
        expect((yield* Ref.get(calls)).length).toBe(3)
        yield* TestClock.adjust("59 seconds")
        expect((yield* Ref.get(calls)).length).toBe(3)
        yield* TestClock.adjust("1 second")
        expect((yield* Ref.get(calls)).length).toBe(4)
        expect(yield* cache.get("kilo")).toEqual(catalog.models)
      }),
    ).pipe(Effect.provide(layer(calls, [result, result, result, catalog])))
  }),
)

for (const error of [
  { kind: "unauthorized", status: 401 },
  { kind: "unauthorized", status: 403 },
  { kind: "http", status: 404 },
  { kind: "http", status: 429 },
  { kind: "schema" },
] satisfies NonNullable<KiloModelsResult["error"]>[]) {
  it.effect(`does not retry permanent ${error.kind} ${error.status ?? ""} failures`, () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<Options[]>([])
      yield* ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          yield* cache.fetch("kilo", options)
          yield* TestClock.adjust("10 minutes")
          expect((yield* Ref.get(calls)).length).toBe(1)
          expect(yield* cache.getFailure("kilo")).toEqual(error)
        }),
      ).pipe(Effect.provide(layer(calls, [{ models: {}, error }])))
    }),
  )
}

it.effect("cancels pending recovery when switching organizations", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", options)
        yield* cache.clear("kilo")
        const next = { ...options, kilocodeOrganizationId: "org-b" }
        yield* cache.fetch("kilo", next)
        yield* TestClock.adjust("10 minutes")
        expect(yield* Ref.get(calls)).toEqual([options, next])
        expect(yield* cache.get("kilo")).toEqual(catalog.models)
      }),
    ).pipe(Effect.provide(layer(calls, [{ models: {}, error: { kind: "network" } }, catalog])))
  }),
)

it.effect("does not retry an old endpoint after a newer endpoint fails", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", options)
        const next = { ...options, baseURL: "https://other.test/api/organizations/org-a" }
        yield* cache.refresh("kilo", next)
        yield* TestClock.adjust("10 minutes")
        expect(yield* Ref.get(calls)).toEqual([options, next])
        expect(yield* cache.getFailure("kilo")).toEqual({ kind: "unauthorized", status: 403 })
      }),
    ).pipe(
      Effect.provide(
        layer(calls, [
          { models: {}, error: { kind: "network" } },
          { models: {}, error: { kind: "unauthorized", status: 403 } },
        ]),
      ),
    )
  }),
)

it.effect("does not reuse another organization's warm catalog", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        expect(yield* cache.fetch("kilo", options)).toEqual(catalog.models)
        const next = { ...options, kilocodeOrganizationId: "org-b" }
        expect(yield* cache.fetch("kilo", next)).toEqual({})
        expect(yield* Ref.get(calls)).toEqual([options, next])
        expect(yield* cache.get("kilo")).toEqual({})
      }),
    ).pipe(Effect.provide(layer(calls, [catalog, { models: {}, error: { kind: "unauthorized", status: 403 } }])))
  }),
)

it.effect("selects a new endpoint through fetch and stops the old recovery", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", options)
        const next = { ...options, baseURL: "https://other.test/api/organizations/org-a" }
        expect(yield* cache.fetch("kilo", next)).toEqual(catalog.models)
        yield* TestClock.adjust("10 minutes")
        expect(yield* Ref.get(calls)).toEqual([options, next])
        expect(yield* cache.get("kilo")).toEqual(catalog.models)
      }),
    ).pipe(Effect.provide(layer(calls, [{ models: {}, error: { kind: "network" } }, catalog])))
  }),
)

it.effect("keys implicit catalog requests by their resolved credentials", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const account = yield* Ref.make("org-a")
    const cfg = TestConfig.layer({
      get: () =>
        Ref.get(account).pipe(
          Effect.map((id) => ({ provider: { kilo: { options: { ...options, kilocodeOrganizationId: id } } } })),
        ),
    })
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo")
        yield* Ref.set(account, "org-b")
        expect(yield* cache.fetch("kilo")).toEqual({})
        expect((yield* Ref.get(calls)).map((call) => call.kilocodeOrganizationId)).toEqual(["org-a", "org-b"])
      }),
    ).pipe(Effect.provide(layer(calls, [catalog, { models: {}, error: { kind: "unauthorized", status: 403 } }], cfg)))
  }),
)

it.effect("caps retry delays at five minutes", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", options)
        for (const delay of [30, 60, 120, 240, 300, 300]) {
          const count = (yield* Ref.get(calls)).length
          yield* TestClock.adjust(`${delay - 1} seconds`)
          expect((yield* Ref.get(calls)).length).toBe(count)
          yield* TestClock.adjust("1 second")
          expect((yield* Ref.get(calls)).length).toBe(count + 1)
        }
      }),
    ).pipe(Effect.provide(layer(calls, [{ models: {}, error: { kind: "network" } }])))
  }),
)

it.effect("invalidates worktree state when a normal fetch recovers an expired catalog", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const clock = yield* Effect.acquireRelease(
      Effect.sync(() => spyOn(Date, "now").mockReturnValue(0)),
      (clock) => Effect.sync(() => clock.mockRestore()),
    )
    yield* Effect.gen(function* () {
      const cache = yield* ModelCache.Service
      const state = yield* InstanceState.make(() => cache.fetch("kilo", options))
      yield* ModelsRefresh.watch(state)
      expect(yield* ScopedCache.get(state.cache, "worktree")).toEqual({})
      clock.mockReturnValue(300001)
      expect(yield* cache.fetch("kilo", options)).toEqual(catalog.models)
      expect(yield* ScopedCache.get(state.cache, "worktree")).toEqual(catalog.models)
      yield* TestClock.adjust("30 seconds")
      expect((yield* Ref.get(calls)).length).toBe(2)
    }).pipe(
      Effect.provide(layer(calls, [{ models: {}, error: { kind: "network" } }, catalog])),
      provideInstance(process.cwd()),
    )
  }),
)

it.effect("reports an empty catalog and recovers the real Provider.getModel path", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const cfg = TestConfig.layer({ get: () => Effect.succeed({ provider: { kilo: { options } } }) })
    const access = Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined), all: () => Effect.succeed({}) })
    const models = ModelsDev.layer.pipe(
      Layer.provide(layer(calls, [{ models: {}, error: { kind: "network" } }, catalog], cfg)),
      Layer.provide(cfg),
      Layer.provide(access),
      Layer.provide(Layer.mock(Core.Service)({ get: () => Effect.succeed({}), refresh: () => Effect.void })),
    )
    const graph = LayerNode.compile(Provider.node, [
      [ModelsDev.node, models],
      [Config.node, cfg],
      [Auth.node, access],
      [Plugin.node, Layer.mock(Plugin.Service)({ list: () => Effect.succeed([]) })],
    ])
    yield* Provider.Service.use((provider) =>
      Effect.gen(function* () {
        const id = ProviderV2.ID.make("kilo")
        const model = ModelV2.ID.make("allowed")
        const missing = yield* provider.getModel(id, model).pipe(Effect.flip)
        expect(missing._tag).toBe("ProviderModelNotFoundError")
        expect(missing.modelsEmpty).toBe(true)
        yield* TestClock.adjust("30 seconds")
        expect(yield* provider.getModel(id, model)).toMatchObject({ id: "allowed", providerID: "kilo" })
        const typo = yield* provider.getModel(id, ModelV2.ID.make("typo")).pipe(Effect.flip)
        expect(typo.modelsEmpty).toBe(false)
      }),
    ).pipe(Effect.provide(graph), provideInstance(process.cwd()))
  }),
)
