// kilocode_change - new file
import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { pollWithTimeout, testEffect } from "../lib/effect"

type Hit = { readonly url: string }

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

const it = testEffect(Layer.empty)

function layer(
  hits: Ref.Ref<Hit[]>,
  cfg = TestConfig.layer(),
  access = auth,
  gates?: {
    readonly started: Deferred.Deferred<void>
    readonly wait: Deferred.Deferred<void>
    readonly count?: number
  },
  fail?: number,
) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [...list, { url: request.url }])
      const count = (yield* Ref.get(hits)).length
      if (gates && count === (gates.count ?? 1)) {
        yield* Deferred.succeed(gates.started, undefined)
        yield* Deferred.await(gates.wait)
      }
      return HttpClientResponse.fromWeb(
        request,
        Response.json(count === fail ? null : { data: [{ id: `apertis-${count}`, owned_by: "apertis" }] }),
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

it.live("retries after a failed refresh", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const out = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const failed = yield* cache.fetch("apertis", { apiKey: "test-key" }).pipe(Effect.exit)
        const models = yield* cache.fetch("apertis", { apiKey: "test-key" })
        return { failed, models }
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, undefined, 1)))

    expect(Exit.isFailure(out.failed)).toBe(true)
    expect(Object.keys(out.models)).toEqual(["apertis-2"])
    expect((yield* Ref.get(hits)).length).toBe(2)
  }),
)

it.live("keeps a shared refresh alive when one waiter times out", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const out = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const first = yield* cache
          .fetch("apertis", { apiKey: "test-key" })
          .pipe(Effect.timeoutOption("10 millis"), Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* cache.fetch("apertis", { apiKey: "test-key" }).pipe(Effect.forkChild)
        expect(Option.isNone(yield* Fiber.join(first))).toBe(true)
        yield* Deferred.succeed(wait, undefined)
        const models = yield* Fiber.join(second)
        return { models, cached: yield* cache.get("apertis") }
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait })))

    expect(Object.keys(out.models)).toEqual(["apertis-1"])
    expect(out.cached).toEqual(out.models)
    expect((yield* Ref.get(hits)).length).toBe(1)
  }),
)

it.live("commits a refresh after its only waiter times out", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const cached = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const caller = yield* cache
          .fetch("apertis", { apiKey: "test-key" })
          .pipe(Effect.timeoutOption("10 millis"), Effect.forkChild)
        yield* Deferred.await(started)
        expect(Option.isNone(yield* Fiber.join(caller))).toBe(true)
        yield* Deferred.succeed(wait, undefined)
        return yield* pollWithTimeout(
          cache.get("apertis"),
          "service-owned refresh did not commit after its waiter timed out",
        )
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait })))

    expect(Object.keys(cached)).toEqual(["apertis-1"])
    expect((yield* Ref.get(hits)).length).toBe(1)
  }),
)

it.live("deduplicates overlapping refresh calls", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const started = yield* Deferred.make<void>()
    const wait = yield* Deferred.make<void>()
    const out = yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("apertis", { apiKey: "test-key" })
        const first = yield* cache.refresh("apertis", { apiKey: "test-key" }).pipe(Effect.forkChild)
        yield* Deferred.await(started)
        const second = yield* cache.refresh("apertis", { apiKey: "test-key" }).pipe(Effect.forkChild)
        yield* Effect.yieldNow
        yield* Deferred.succeed(wait, undefined)
        return { first: yield* Fiber.join(first), second: yield* Fiber.join(second) }
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait, count: 2 })))

    expect(Object.keys(out.first)).toEqual(["apertis-2"])
    expect(out.second).toEqual(out.first)
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

it.live("promotes a cached result after a newer option load fails", () =>
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
        const failed = yield* cache
          .fetch("apertis", { apiKey: "second", baseURL: "https://second.test/v1" })
          .pipe(Effect.exit)
        yield* Deferred.succeed(wait, undefined)
        yield* Fiber.join(first)
        const models = yield* cache.fetch("apertis", { apiKey: "first", baseURL: "https://first.test/v1" })
        return { failed, models, current: yield* cache.get("apertis") }
      }),
    ).pipe(Effect.provide(layer(hits, TestConfig.layer(), auth, { started, wait }, 2)))

    expect(Exit.isFailure(out.failed)).toBe(true)
    expect(Object.keys(out.models)).toEqual(["apertis-1"])
    expect(out.current).toEqual(out.models)
    expect((yield* Ref.get(hits)).length).toBe(2)
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

function aimlapiLayer(hits: Ref.Ref<Hit[]>, item: unknown) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [...list, { url: request.url }])
      return HttpClientResponse.fromWeb(request, Response.json({ data: [item] }))
    }),
  )
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

it.live("maps aimlapi pricing units to per-1M model cost", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const item = {
      id: "vendor/chat-model",
      type: "openai/chat-completions",
      info: { name: "Chat Model", contextLength: 200000 },
      pricing: {
        units: [
          { type: "charge", name: "token", content: "text", origin: "provided", price: 3.25, per: 1_000_000 },
          // per normalization: 0.000013 per 1 token == 13 per 1M
          { type: "charge", name: "token", content: "text", origin: "generated", price: 0.000013, per: 1 },
          { type: "charge", name: "token", content: "text", origin: "cached", price: 1.625, per: 1_000_000 },
          { type: "charge", name: "token", content: "text", origin: "cache_write", price: 6, per: 1_000_000 },
          // ignored: audio input, tool-call charge, and a duplicate generated row
          { type: "charge", name: "token", content: "audio", origin: "provided", price: 999, per: 1_000_000 },
          { type: "charge", name: "call", content: "structured", origin: "generated", price: 0.05, per: 1 },
          { type: "charge", name: "token", content: "text", origin: "generated", price: 99, per: 1_000_000 },
        ],
      },
    }
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("aimlapi", { baseURL: "https://aiml.test/v1" }),
    ).pipe(Effect.provide(aimlapiLayer(hits, item)))

    expect(models["vendor/chat-model"]!.cost).toEqual({ input: 3.25, output: 13, cache_read: 1.625, cache_write: 6 })
    expect((yield* Ref.get(hits))[0]!.url).toContain("include=capabilities,modalities,pricing")
  }),
)

it.live("leaves aimlapi cost at zero when the model carries no pricing", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const item = { id: "vendor/free-model", type: "openai/chat-completions", info: { name: "Free Model" } }
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("aimlapi", { baseURL: "https://aiml.test/v1" }),
    ).pipe(Effect.provide(aimlapiLayer(hits, item)))

    expect(models["vendor/free-model"]!.cost).toEqual({ input: 0, output: 0 })
    // No description in the catalog → no options blurb for the detail panel.
    expect((models["vendor/free-model"] as { options?: unknown }).options).toBeUndefined()
  }),
)

it.live("exposes the catalog description via model options", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const item = {
      id: "vendor/described",
      type: "openai/chat-completions",
      info: { name: "Described", description: "  A capable coding model.  " },
    }
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("aimlapi", { baseURL: "https://aiml.test/v1" }),
    ).pipe(Effect.provide(aimlapiLayer(hits, item)))

    const model = models["vendor/described"] as { options?: { description?: string } }
    expect(model.options?.description).toBe("A capable coding model.")
  }),
)
