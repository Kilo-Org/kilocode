// kilocode_change - new file
import { afterEach, expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Hit = { readonly url: string; readonly auth: string | null }

const originalKey = process.env.NEARAI_API_KEY
const originalURL = process.env.NEARAI_BASE_URL

const auth = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
})

const it = testEffect(Layer.empty)

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

afterEach(() => {
  restoreEnv("NEARAI_API_KEY", originalKey)
  restoreEnv("NEARAI_BASE_URL", originalURL)
})

function nearaiBody() {
  return {
    models: [
      {
        modelId: "zai-org/GLM-5.1-FP8",
        inputCostPerToken: { amount: 600, scale: 9, currency: "USD" },
        outputCostPerToken: { amount: 2600, scale: 9, currency: "USD" },
        cacheReadCostPerToken: { amount: 200, scale: 9, currency: "USD" },
        metadata: {
          contextLength: 200000,
          modelDisplayName: "GLM 5.1 FP8",
          ownedBy: "zai-org",
          architecture: {
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
          },
        },
      },
      {
        modelId: "Qwen/Qwen3-Embedding-0.6B",
        metadata: {
          architecture: {
            inputModalities: ["text"],
            outputModalities: ["embedding"],
          },
        },
      },
      {
        modelId: "black-forest-labs/FLUX.2-klein-4B",
        metadata: {
          architecture: {
            inputModalities: ["text"],
            outputModalities: ["image"],
          },
        },
      },
      {
        modelId: "Qwen/Qwen3-Reranker-0.6B",
        metadata: {
          architecture: {
            inputModalities: ["text"],
            outputModalities: ["text"],
          },
        },
      },
      {
        modelId: "openai/privacy-filter",
        metadata: {
          architecture: {
            inputModalities: ["text"],
            outputModalities: ["text"],
          },
        },
      },
    ],
  }
}

function layer(hits: Ref.Ref<Hit[]>) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [
        ...list,
        { url: request.url, auth: request.headers["authorization"] ?? null },
      ])
      return HttpClientResponse.fromWeb(request, Response.json(nearaiBody()))
    }),
  )

  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

it.live("nearai model cache fetches chat models and maps metadata", () =>
  Effect.gen(function* () {
    delete process.env.NEARAI_API_KEY
    delete process.env.NEARAI_BASE_URL
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) => cache.fetch("nearai")).pipe(Effect.provide(layer(hits)))

    expect(yield* Ref.get(hits)).toEqual([{ url: "https://cloud-api.near.ai/v1/model/list", auth: null }])
    expect(Object.keys(models)).toEqual(["zai-org/GLM-5.1-FP8"])
    expect(models["zai-org/GLM-5.1-FP8"]).toMatchObject({
      id: "zai-org/GLM-5.1-FP8",
      name: "GLM 5.1 FP8",
      family: "zai-org",
      attachment: true,
      reasoning: false,
      temperature: true,
      tool_call: true,
      cost: { input: 0.6, output: 2.6, cache_read: 0.2 },
      limit: { context: 200000, output: 32768 },
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
    })
  }),
)

it.live("nearai model cache honors env key and base URL overrides", () =>
  Effect.gen(function* () {
    process.env.NEARAI_API_KEY = "test-key"
    process.env.NEARAI_BASE_URL = "https://example.test/v1/"
    const hits = yield* Ref.make<Hit[]>([])
    yield* ModelCache.Service.use((cache) => cache.fetch("nearai")).pipe(Effect.provide(layer(hits)))

    expect(yield* Ref.get(hits)).toEqual([{ url: "https://example.test/v1/model/list", auth: "Bearer test-key" }])
  }),
)

it.live("nearai model cache treats NEARAI_BASE_URL as the versioned catalog base", () =>
  Effect.gen(function* () {
    delete process.env.NEARAI_API_KEY
    process.env.NEARAI_BASE_URL = "https://example.test/api/"
    const hits = yield* Ref.make<Hit[]>([])
    yield* ModelCache.Service.use((cache) => cache.fetch("nearai")).pipe(Effect.provide(layer(hits)))

    expect(yield* Ref.get(hits)).toEqual([{ url: "https://example.test/api/model/list", auth: null }])
  }),
)
