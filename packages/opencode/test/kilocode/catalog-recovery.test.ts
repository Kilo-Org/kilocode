import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { FetchHttpClient } from "effect/unstable/http"
import type { KiloModelsResult } from "@kilocode/kilo-gateway"
import * as Core from "@opencode-ai/core/models-dev"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Plugin } from "../../src/plugin"
import { FormatError } from "../../src/cli/error"
import { unavailable } from "../../src/kilocode/provider/catalog-recovery"
import { ModelCache } from "../../src/provider/model-cache"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { TestConfig } from "../fixture/config"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Options = Parameters<ModelCache.KiloModels["fetch"]>[0]
const options = { kilocodeOrganizationId: "org-a", kilocodeToken: "org-token" }
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
const network: KiloModelsResult = { models: {}, error: { kind: "network" } }

function layer(calls: Ref.Ref<Options[]>, results: KiloModelsResult[]) {
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(TestConfig.layer()),
    Layer.provide(Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })),
    Layer.provide(
      Layer.succeed(ModelCache.KiloModelsService, {
        fetch: (options) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (list) => [...list, options])
            return results.at((yield* Ref.get(calls)).length - 1) ?? results.at(-1)!
          }),
      }),
    ),
  )
}

const it = testEffect(testInstanceStoreLayer)

it.effect("refreshes initialized provider state after a prolonged outage and reports the catalog failure", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const notifications = yield* Ref.make(0)
    yield* ModelsRefresh.watch(() => Ref.update(notifications, (count) => count + 1))
    const cfg = TestConfig.layer({ get: () => Effect.succeed({ provider: { kilo: { options } } }) })
    const access = Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined), all: () => Effect.succeed({}) })
    const models = ModelsDev.layer.pipe(
      Layer.provide(layer(calls, [...Array.from({ length: 8 }, () => network), catalog])),
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
        expect(missing.modelsEmpty).toBe(true)
        expect(missing.message).toContain("Failed to load the Kilo model catalog (network)")
        const message = "Failed to load the Kilo model catalog (network). Check your connection and credentials."
        expect(missing.catalogError).toBe(message)
        expect(FormatError(missing)).toContain(message)
        expect(FormatError({ name: "ProviderModelNotFoundError", data: missing })).toContain(message)
        expect(unavailable(missing)).toBe(message)
        expect((yield* provider.list())[id]).toBeUndefined()
        expect(yield* Ref.get(notifications)).toBe(0)
        // Continue beyond the former six-retry cutoff without another caller or hourly refresh.
        for (const delay of [30, 60, 120, 240, 300, 300, 300, 300]) {
          const count = (yield* Ref.get(calls)).length
          yield* TestClock.adjust(`${delay - 1} seconds`)
          expect((yield* Ref.get(calls)).length).toBe(count)
          yield* TestClock.adjust("1 second")
          expect((yield* Ref.get(calls)).length).toBe(count + 1)
        }
        expect(yield* Ref.get(notifications)).toBe(1)
        expect((yield* provider.list())[id].models[model]).toMatchObject({ id: "allowed", providerID: "kilo" })
        expect(yield* provider.getModel(id, model)).toMatchObject({ id: "allowed", providerID: "kilo" })
        const typo = yield* provider.getModel(id, ModelV2.ID.make("typo")).pipe(Effect.flip)
        expect(typo.modelsEmpty).toBe(false)
        expect(typo.catalogError).toBeUndefined()
        yield* TestClock.adjust("10 minutes")
        expect((yield* Ref.get(calls)).length).toBe(9)
        expect(yield* Ref.get(notifications)).toBe(1)
      }),
    ).pipe(Effect.provide(graph), provideInstance(process.cwd()))
  }),
)

for (const error of [
  { kind: "unauthorized", status: 401 },
  { kind: "unauthorized", status: 403 },
  { kind: "http", status: 404 },
  { kind: "schema" },
] satisfies NonNullable<KiloModelsResult["error"]>[]) {
  it.effect(`does not retry permanent ${error.kind} ${error.status ?? ""} failures`, () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<Options[]>([])
      yield* ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          yield* cache.fetch("kilo", options)
          yield* TestClock.adjust("1 hour")
          expect((yield* Ref.get(calls)).length).toBe(1)
          expect(yield* cache.getFailure("kilo")).toEqual(error)
        }),
      ).pipe(Effect.provide(layer(calls, [{ models: {}, error }])))
    }),
  )
}

for (const result of [
  { models: {}, error: { kind: "http", status: 503 } },
  { models: {}, error: { kind: "http", status: 503, retryAfter: 120 } },
  { models: {}, error: { kind: "http", status: 408, retryAfter: 90 } },
  { models: {}, error: { kind: "http", status: 429, retryAfter: 90 } },
  { models: {} },
] satisfies KiloModelsResult[]) {
  it.effect(`recovers ${result.error?.status ?? "empty"} catalogs with the correct delay`, () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<Options[]>([])
      yield* ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          yield* cache.fetch("kilo", options)
          const seconds = result.error?.retryAfter ?? 30
          yield* TestClock.adjust(`${seconds - 1} seconds`)
          expect((yield* Ref.get(calls)).length).toBe(1)
          yield* TestClock.adjust("1 second")
          expect(yield* cache.get("kilo")).toEqual(catalog.models)
          expect(yield* cache.getFailure("kilo")).toBeUndefined()
        }),
      ).pipe(Effect.provide(layer(calls, [result, catalog])))
    }),
  )
}

it.effect("stops recovering after an unexpected fetch failure instead of retrying it as a network error", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const cache = Layer.fresh(ModelCache.layer).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(TestConfig.layer()),
      Layer.provide(Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })),
      Layer.provide(
        Layer.succeed(ModelCache.KiloModelsService, {
          fetch: (options) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (list) => [...list, options])
              if ((yield* Ref.get(calls)).length === 1) return network
              return yield* Effect.fail(new Error("unexpected"))
            }),
        }),
      ),
    )
    yield* ModelCache.Service.use((service) =>
      Effect.gen(function* () {
        yield* service.fetch("kilo", options)
        yield* TestClock.adjust("30 seconds")
        expect((yield* Ref.get(calls)).length).toBe(2)
        yield* TestClock.adjust("1 hour")
        expect((yield* Ref.get(calls)).length).toBe(2)
      }),
    ).pipe(Effect.provide(cache))
  }),
)

it.effect("isolates account switches, reselected failed cells and cache clearing", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<Options[]>([])
    const next = { ...options, kilocodeOrganizationId: "org-b", kilocodeToken: "other-token" }
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo", options)
        expect(yield* cache.fetch("kilo", next)).toEqual(catalog.models)
        yield* TestClock.adjust("30 seconds")
        expect(yield* Ref.get(calls)).toEqual([options, next])
        expect(yield* cache.fetch("kilo", options)).toEqual({})
        yield* TestClock.adjust("30 seconds")
        expect(yield* cache.get("kilo")).toEqual(catalog.models)
        // A warm catalog from the previous account must not suppress this failed fetch.
        expect(yield* cache.refresh("kilo", next)).toEqual({})
        yield* cache.clear("kilo")
        yield* TestClock.adjust("1 hour")
        expect(yield* Ref.get(calls)).toEqual([options, next, options, next])
        expect(yield* cache.get("kilo")).toBeUndefined()
      }),
    ).pipe(Effect.provide(layer(calls, [network, catalog, catalog, network])))
  }),
)
