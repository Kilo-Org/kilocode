// kilocode_change - new file
import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
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

function layer(hits: Ref.Ref<Hit[]>, cfg = TestConfig.layer(), access = auth) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [...list, { url: request.url }])
      const count = (yield* Ref.get(hits)).length
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
