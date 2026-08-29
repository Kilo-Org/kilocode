// kilocode_change - new file
// Tests that unauthenticated Kilo models are assembled with paid models and autoloaded anonymously.

import { expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ModelsDev } from "../../src/provider/models"
import * as CoreModels from "@opencode-ai/core/models-dev"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { kiloCustomLoaders, patchKiloProviderPrivacy } from "../../src/kilocode/provider/provider"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { Provider } from "../../src/provider/provider"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"

const input = {
  id: "kilo",
  env: ["KILO_API_KEY"],
  models: {
    "free-model": {
      id: "free-model",
      name: "Free Model",
      cost: { input: 0, output: 0 },
      limit: { context: 128000, output: 4096 },
    },
    "paid-model": {
      id: "paid-model",
      name: "Paid Model",
      cost: { input: 1, output: 2 },
      limit: { context: 128000, output: 4096 },
    },
  },
}

const seed: Record<string, ModelsDev.Provider> = {
  apertis: {
    id: "apertis",
    name: "Apertis",
    env: ["APERTIS_API_KEY"],
    models: {},
  },
}

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

const files = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...fs,
      readJson: () => Effect.succeed(seed),
      stat: () => fs.stat(import.meta.path),
    })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

function load(data?: { auth?: object; config?: object; env?: Record<string, string | undefined> }) {
  return kiloCustomLoaders({
    auth: () => Effect.succeed(data?.auth),
    config: () => Effect.succeed(data?.config ?? {}),
    env: () => Effect.succeed(data?.env ?? {}),
    get: () => Effect.succeed(undefined),
  }).kilo(input)
}

function layer() {
  const cfg = TestConfig.layer()
  const models = Layer.succeed(
    ModelCache.KiloModelsService,
    ModelCache.KiloModelsService.of({
      fetch: () =>
        Effect.succeed({
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 128000, output: 4096 },
            },
            "paid-model": {
              id: "paid-model",
              name: "Paid Model",
              cost: { input: 1, output: 2 },
              isFree: false,
              mayTrainOnYourPrompts: true,
              limit: { context: 128000, output: 4096 },
            },
          },
        }),
    }),
  )
  const cache = Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(cfg),
    Layer.provide(auth),
    Layer.provide(models),
  )
  const core = Layer.succeed(
    CoreModels.Service,
    CoreModels.Service.of({
      get: () => Effect.succeed(seed),
      refresh: () => Effect.void,
    }),
  )
  return Layer.fresh(ModelsDev.layer).pipe(
    Layer.provide(core),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(files),
    Layer.provide(cfg),
    Layer.provide(auth),
    Layer.provide(cache),
  )
}

const it = testEffect(testInstanceStoreLayer)

it.live("assembles paid Kilo models without auth", () =>
  Effect.gen(function* () {
    const providers = yield* ModelsDev.Service.use((models) => models.get()).pipe(
      Effect.provide(layer()),
      provideInstance(process.cwd()),
    )
    const kilo = Provider.fromModelsDevProvider(providers.kilo)

    expect(kilo.models["paid-model"]).toMatchObject({
      id: "paid-model",
      providerID: "kilo",
      cost: { input: 1, output: 2 },
      isFree: false,
      mayTrainOnYourPrompts: true,
    })
  }),
)

it.live("does not infer free status from zero catalog prices", () =>
  Effect.gen(function* () {
    const providers = yield* ModelsDev.Service.use((models) => models.get()).pipe(
      Effect.provide(layer()),
      provideInstance(process.cwd()),
    )
    const kilo = Provider.fromModelsDevProvider(providers.kilo)

    expect(kilo.models["free-model"].isFree).toBeUndefined()
  }),
)

it.effect("enables a paid catalog anonymously without auth", () =>
  Effect.gen(function* () {
    const result = yield* load()
    expect(result.autoload).toBe(true)
    expect(result.options).toEqual({ apiKey: "anonymous" })
  }),
)

it.effect("enables a paid catalog when config apiKey is present", () =>
  Effect.gen(function* () {
    const result = yield* load({ config: { provider: { kilo: { options: { apiKey: "test-key" } } } } })
    expect(result.autoload).toBe(true)
    expect(result.options).toEqual({})
  }),
)

it.effect("denies provider data collection when prompt-training models are hidden", () =>
  Effect.gen(function* () {
    const result = yield* load({ config: { hide_prompt_training_models: true } })
    expect(result.options).toEqual({ apiKey: "anonymous", dataCollection: "deny" })
  }),
)

it.effect("keeps data collection denied after configured options are applied", () =>
  Effect.sync(() => {
    const provider = { options: { dataCollection: "allow", baseURL: "https://api.kilo.ai" } }
    patchKiloProviderPrivacy(provider, { hide_prompt_training_models: true })
    expect(provider.options).toEqual({ dataCollection: "deny", baseURL: "https://api.kilo.ai" })
  }),
)

it.effect("enables a paid catalog when auth exists", () =>
  Effect.gen(function* () {
    const result = yield* load({ auth: { type: "api", key: "test-key" } })
    expect(result.autoload).toBe(true)
    expect(result.options).toEqual({})
  }),
)

it.effect("hands the model's provider routing to every gateway transport", () =>
  Effect.gen(function* () {
    const calls: Array<{ transport: string; modelID: string; options: unknown }> = []
    const sdk = Object.fromEntries(
      ["languageModel", "anthropic", "openai", "openaiCompatible"].map((transport) => [
        transport,
        (modelID: string, options: unknown) => {
          calls.push({ transport, modelID, options })
          return { modelId: modelID }
        },
      ]),
    )
    const routing = { order: ["gmicloud/fp8"], only: ["gmicloud/fp8"], allow_fallbacks: false }
    const models = {
      "paid-model": {},
      "anthropic/claude": { ai_sdk_provider: "anthropic" },
      "openai/gpt": { ai_sdk_provider: "openai" },
      "compatible/model": { ai_sdk_provider: "openai-compatible" },
    }
    const result = yield* kiloCustomLoaders({
      auth: () => Effect.succeed(undefined),
      config: () => Effect.succeed({}),
      env: () => Effect.succeed({}),
      get: () => Effect.succeed(undefined),
    }).kilo({ ...input, models })

    for (const modelID of Object.keys(models)) {
      yield* Effect.promise(() => result.getModel!(sdk, modelID, { dataCollection: "deny", provider: routing }))
    }
    yield* Effect.promise(() => result.getModel!(sdk, "paid-model", { provider: "not-an-object" }))

    expect(calls).toEqual([
      { transport: "languageModel", modelID: "paid-model", options: { provider: routing } },
      { transport: "anthropic", modelID: "anthropic/claude", options: { provider: routing } },
      { transport: "openai", modelID: "openai/gpt", options: { provider: routing } },
      { transport: "openaiCompatible", modelID: "compatible/model", options: { provider: routing } },
      { transport: "languageModel", modelID: "paid-model", options: { provider: undefined } },
    ])
  }),
)
