// kilocode_change - new file
// When the injected Kilo models source returns a 401 error result, ModelCache surfaces
// the failure and caches empty models (allowing re-auth via /connect).
// The real fetchKiloModels 401-fallback unit test lives in packages/kilo-gateway/test/api/models.test.ts.

import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

const models = Layer.succeed(
  ModelCache.KiloModelsService,
  ModelCache.KiloModelsService.of({
    fetch: () => Effect.succeed({ models: {}, error: { kind: "unauthorized", status: 401 } }),
  }),
)

const layer = Layer.fresh(ModelCache.layer).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(TestConfig.layer()),
  Layer.provide(auth),
  Layer.provide(models),
)

const it = testEffect(layer)

it.live("401 from Kilo models sets provider as failed in ModelCache", () =>
  Effect.gen(function* () {
    const cache = yield* ModelCache.Service
    yield* cache.fetch("kilo")
    expect(yield* cache.failedProviders()).toContain("kilo")
    expect(yield* cache.getFailure("kilo")).toMatchObject({ kind: "unauthorized", status: 401 })
  }),
)

it.live("401 from Kilo models caches empty models (not undefined)", () =>
  Effect.gen(function* () {
    const cache = yield* ModelCache.Service
    yield* cache.fetch("kilo")
    expect(yield* cache.get("kilo")).toEqual({})
  }),
)
