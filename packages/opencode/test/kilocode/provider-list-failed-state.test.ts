// kilocode_change - new file
// Verifies that:
//   1. ModelCache.failedProviders() surfaces providers that encountered errors.
//   2. ModelCache.getFailure() returns the typed error for a failed provider.
//   3. Clear removes failure state.

import { beforeEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type { ModelsDev } from "@opencode-ai/core/models-dev"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Failure = { kind: "unauthorized" | "network" | "schema" | "http"; status?: number }
type Result = { models: ModelsDev.Provider["models"]; error?: Failure }

let result: Result = { models: {} }
let error: Error | undefined

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

function layer() {
  const models = Layer.succeed(
    ModelCache.KiloModelsService,
    ModelCache.KiloModelsService.of({
      fetch: () => (error ? Effect.fail(error) : Effect.succeed(result)),
    }),
  )
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(models),
  )
}

const it = testEffect(Layer.empty)

beforeEach(() => {
  result = { models: {} }
  error = undefined
})

it.live("failedProviders returns empty array when no fetch has occurred", () =>
  ModelCache.Service.use((cache) =>
    Effect.gen(function* () {
      expect(yield* cache.failedProviders()).not.toContain("kilo")
    }),
  ).pipe(Effect.provide(layer())),
)

it.live("getFailure returns undefined when fetch succeeds", () =>
  Effect.gen(function* () {
    result = {
      models: {
        "test/model": {
          id: "test/model",
          name: "Test",
          attachment: false,
          reasoning: false,
          release_date: "",
          temperature: true,
          tool_call: true,
          cost: { input: 1, output: 2 },
          limit: { context: 128000, output: 4096 },
        },
      },
    }
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo")
        expect(yield* cache.getFailure("kilo")).toBeUndefined()
        expect(yield* cache.failedProviders()).not.toContain("kilo")
      }),
    ).pipe(Effect.provide(layer()))
  }),
)

it.live("failedProviders includes provider after auth error", () =>
  Effect.gen(function* () {
    result = { models: {}, error: { kind: "unauthorized", status: 401 } }
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo")
        expect(yield* cache.failedProviders()).toContain("kilo")
        expect(yield* cache.getFailure("kilo")).toMatchObject({ kind: "unauthorized", status: 401 })
      }),
    ).pipe(Effect.provide(layer()))
  }),
)

it.live("gateway rejection remains recoverable through the Effect error channel", () =>
  Effect.gen(function* () {
    error = new Error("gateway failed")
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        const models = yield* cache.fetch("kilo").pipe(Effect.catch(() => Effect.succeed({})))
        expect(models).toEqual({})
      }),
    ).pipe(Effect.provide(layer()))
  }),
)

it.live("clear removes failure state", () =>
  Effect.gen(function* () {
    result = { models: {}, error: { kind: "network" } }
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo")
        expect(yield* cache.failedProviders()).toContain("kilo")
        yield* cache.clear("kilo")
        expect(yield* cache.failedProviders()).not.toContain("kilo")
        expect(yield* cache.getFailure("kilo")).toBeUndefined()
      }),
    ).pipe(Effect.provide(layer()))
  }),
)

it.live("failure state is cleared when subsequent refresh succeeds", () =>
  Effect.gen(function* () {
    result = { models: {}, error: { kind: "unauthorized", status: 401 } }
    yield* ModelCache.Service.use((cache) =>
      Effect.gen(function* () {
        yield* cache.fetch("kilo")
        expect(yield* cache.failedProviders()).toContain("kilo")
        result = {
          models: {
            "test/model": {
              id: "test/model",
              name: "Test",
              attachment: false,
              reasoning: false,
              release_date: "",
              temperature: true,
              tool_call: true,
              cost: { input: 1, output: 2 },
              limit: { context: 128000, output: 4096 },
            },
          },
        }
        yield* cache.refresh("kilo")
        expect(yield* cache.failedProviders()).not.toContain("kilo")
        expect(yield* cache.getFailure("kilo")).toBeUndefined()
      }),
    ).pipe(Effect.provide(layer()))
  }),
)
