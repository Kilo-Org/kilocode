// kilocode_change - new file
import { expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Hit = { readonly url: string }

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

const it = testEffect(Layer.empty)

function layer(
  hits: Ref.Ref<Hit[]>,
  cfg = TestConfig.layer(),
  access = auth,
  gates?: { readonly started: Deferred.Deferred<void>; readonly wait: Deferred.Deferred<void> },
) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [...list, { url: request.url }])
      const count = (yield* Ref.get(hits)).length
      if (gates && count === 1) {
        yield* Deferred.succeed(gates.started, undefined)
        yield* Deferred.await(gates.wait)
      }
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ data: [{ id: `apertis-${count}`, owned_by: "apertis" }] }),
      )
    }),
  )

  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(cfg),
    Layer.provide(access),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

it.live("fetches Apertis models through the injected HttpClient", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("apertis", { apiKey: "test-key", baseURL: "https://apertis.test/v1" }),
    ).pipe(Effect.provide(layer(hits)))

    expect(Object.keys(models)).toEqual(["apertis-1"])
    expect((yield* Ref.get(hits)).map((hit) => hit.url)).toEqual(["https://apertis.test/v1/models"])
  }),
)

it.live("reuses cached values and refresh invalidates the provider cell", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const run = ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const first = yield* cache.fetch("apertis", { apiKey: "test-key" })
        const cached = yield* cache.fetch("apertis", { apiKey: "test-key" })
        const refreshed = yield* cache.refresh("apertis", { apiKey: "test-key" })
        return { first, cached, refreshed }
      }),
    ).pipe(Effect.provide(layer(hits)))
    const out = yield* run

    expect(Object.keys(out.first)).toEqual(["apertis-1"])
    expect(Object.keys(out.cached)).toEqual(["apertis-1"])
    expect(Object.keys(out.refreshed)).toEqual(["apertis-2"])
    expect((yield* Ref.get(hits)).length).toBe(2)
  }),
)

it.live("keeps concurrent request options isolated", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const out = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const first = yield* cache
          .fetch("apertis", { apiKey: "first", baseURL: "https://first.test/v1" })
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* cache
          .fetch("apertis", { apiKey: "second", baseURL: "https://second.test/v1" })
          .pipe(Effect.forkChild)
        yield* Effect.sleep("10 millis")
        yield* Deferred.succeed(wait, undefined)
        const firstModels = yield* Fiber.join(first)
        const secondModels = yield* Fiber.join(second)
        return { first: firstModels, second: secondModels, current: yield* cache.get("apertis") }
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait })))

    expect(Object.keys(out.first)).toEqual(["apertis-1"])
    expect(Object.keys(out.second)).toEqual(["apertis-2"])
    expect(out.current).toEqual(out.second)
    expect((yield* Ref.get(hits)).map((hit) => hit.url)).toEqual([
      "https://first.test/v1/models",
      "https://second.test/v1/models",
    ])
  }),
)

it.live("does not let an older fetch override a newer refresh", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const models = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const stale = yield* cache
          .fetch("apertis", { apiKey: "first", baseURL: "https://first.test/v1" })
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const fresh = yield* cache.refresh("apertis", { apiKey: "second", baseURL: "https://second.test/v1" })
        yield* Deferred.succeed(wait, undefined)
        yield* Fiber.join(stale)
        return { fresh, current: yield* cache.get("apertis") }
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait })))

    expect(models.current).toEqual(models.fresh)
    expect(Object.keys(models.current ?? {})).toEqual(["apertis-2"])
  }),
)

it.live("does not restore a fetch that was cleared while pending", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const current = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const pending = yield* cache
          .fetch("apertis", { apiKey: "first", baseURL: "https://first.test/v1" })
          .pipe(Effect.forkChild)
        yield* Deferred.await(started)
        yield* cache.clear("apertis")
        yield* Deferred.succeed(wait, undefined)
        yield* Fiber.join(pending)
        return yield* cache.get("apertis")
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait })))

    expect(current).toBeUndefined()
  }),
)

it.live("exposes the most recently refreshed provider value", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("apertis", { apiKey: "first", baseURL: "https://first.test/v1" })
        const refreshed = yield* cache.refresh("apertis", { apiKey: "second", baseURL: "https://second.test/v1" })
        const current = yield* cache.get("apertis")
        return { refreshed, current }
      }),
    ).pipe(Effect.provide(layer(hits)))

    expect(models.current).toEqual(models.refreshed)
    expect(Object.keys(models.current ?? {})).toEqual(["apertis-2"])
  }),
)

it.live("does not resolve auth or config for unsupported providers", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const configs = yield* Ref.make(0)
    const auths = yield* Ref.make(0)
    const cfg = TestConfig.layer({
      get: () => Ref.update(configs, (count) => count + 1).pipe(Effect.as({})),
    })
    const access = Layer.mock(Auth.Service)({
      get: () => Ref.update(auths, (count) => count + 1).pipe(Effect.as(undefined)),
    })
    const models = yield* ModelCache.Service.use((cache) => cache.fetch("openai")).pipe(
      Effect.provide(layer(hits, cfg, access)),
    )

    expect(models).toEqual({})
    expect(yield* Ref.get(configs)).toBe(0)
    expect(yield* Ref.get(auths)).toBe(0)
    expect(yield* Ref.get(hits)).toEqual([])
  }),
)
