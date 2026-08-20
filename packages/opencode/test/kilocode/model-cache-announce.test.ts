// kilocode_change - new file
import { expect } from "bun:test"
import { Effect, Exit, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Auth } from "../../src/auth"
import { GlobalBus, type GlobalEvent } from "../../src/bus/global"
import { ModelCache } from "../../src/provider/model-cache"
import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

const it = testEffect(Layer.empty)

/** Serves `ids[hit]`, clamping to the last entry so extra fetches repeat it. `null` = unusable body. */
function layer(ids: (string[] | null)[]) {
  let hit = 0
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const entry = ids[Math.min(hit++, ids.length - 1)]
      if (!entry) return HttpClientResponse.fromWeb(request, Response.json(null))
      const data = entry.map((id) => ({ id, owned_by: "apertis" }))
      return HttpClientResponse.fromWeb(request, Response.json({ data }))
    }),
  )

  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

/**
 * Records both halves of an announcement: the in-process invalidation that drops derived
 * provider snapshots, and the wire event that tells already-connected clients to refetch.
 */
function watch<A, E, R>(run: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const invalidations = yield* Ref.make(0)
    const wire: GlobalEvent[] = []
    const onEvent = (event: GlobalEvent) => {
      if (event.payload?.type === "models-dev.refreshed") wire.push(event)
    }
    GlobalBus.on("event", onEvent)
    yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", onEvent)))
    yield* ModelsRefresh.watch(() => Ref.update(invalidations, (count) => count + 1))

    const value = yield* run
    return { value, wire, invalidations: yield* Ref.get(invalidations) }
  })
}

const key = { apiKey: "test-key" }

it.live("announces when a later fetch replaces the catalog clients already have", () =>
  Effect.gen(function* () {
    const out = yield* watch(
      ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          // Mirrors the Gateway fallback path: the first load returns nothing, so the caller
          // serves a stale snapshot and forks a refresh that lands later.
          const first = yield* cache.fetch("apertis", key)
          const second = yield* cache.refresh("apertis", key)
          return { first, second }
        }),
      ).pipe(Effect.provide(layer([[], ["apertis-live"]]))),
    )

    expect(Object.keys(out.value.first)).toEqual([])
    expect(Object.keys(out.value.second)).toEqual(["apertis-live"])
    expect(out.invalidations).toBe(1)
    expect(out.wire.length).toBe(1)
  }),
)

it.live("stays quiet on the first load and on unchanged refetches", () =>
  Effect.gen(function* () {
    const out = yield* watch(
      ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          const first = yield* cache.fetch("apertis", key)
          const again = yield* cache.refresh("apertis", key)
          return { first, again }
        }),
      ).pipe(Effect.provide(layer([["apertis-live"]]))),
    )

    expect(Object.keys(out.value.first)).toEqual(["apertis-live"])
    expect(Object.keys(out.value.again)).toEqual(["apertis-live"])
    expect(out.invalidations).toBe(0)
    expect(out.wire.length).toBe(0)
  }),
)

it.live("announces when the catalog arrives after a failed first load", () =>
  Effect.gen(function* () {
    const out = yield* watch(
      ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          const failed = yield* cache.fetch("apertis", key).pipe(Effect.exit)
          const recovered = yield* cache.fetch("apertis", key)
          return { failed, recovered }
        }),
      ).pipe(Effect.provide(layer([null, ["apertis-live"]]))),
    )

    expect(Exit.isFailure(out.value.failed)).toBe(true)
    expect(Object.keys(out.value.recovered)).toEqual(["apertis-live"])
    expect(out.invalidations).toBe(1)
    expect(out.wire.length).toBe(1)
  }),
)

it.live("treats the load after an org switch as a first load, not a replacement", () =>
  Effect.gen(function* () {
    const out = yield* watch(
      ModelCache.Service.use((cache) =>
        Effect.gen(function* () {
          const personal = yield* cache.fetch("apertis", key)
          // `/teams` clears the provider cell before the instance is disposed and rebootstrapped.
          yield* cache.clear("apertis")
          const org = yield* cache.fetch("apertis", key)
          return { personal, org }
        }),
      ).pipe(Effect.provide(layer([["apertis-personal"], ["apertis-org"]]))),
    )

    expect(Object.keys(out.value.personal)).toEqual(["apertis-personal"])
    expect(Object.keys(out.value.org)).toEqual(["apertis-org"])
    expect(out.invalidations).toBe(0)
    expect(out.wire.length).toBe(0)
  }),
)
