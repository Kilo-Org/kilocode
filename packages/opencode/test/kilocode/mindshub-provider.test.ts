// kilocode_change - new file
// Verifies MindsHub (https://mindshub.ai) is registered as a first-class provider by
// ModelsDev.get(), the same way Apertis is: an OpenAI-compatible gateway injected when the
// upstream models.dev catalog doesn't already carry it, with models fetched live from
// GET /v1/models and its own env-var / config auth resolution.
import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http"
import * as CoreModels from "@opencode-ai/core/models-dev"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { TestConfig } from "../fixture/config"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

type Hit = { readonly url: string; readonly authorization: string | null }

// A representative slice of MindsHub's real GET /v1/models response shape
// (see docs/public/models.mdx): aliases carry a human label, a reasoning-effort
// ladder that can be null, and an `embedding` flag for rows that don't belong
// in a chat model picker.
const MINDSHUB_MODELS_RESPONSE = {
  object: "list",
  data: [
    {
      id: "sonnet",
      label: "Claude Sonnet 5",
      object: "model",
      created: 0,
      enabled: true,
      reasoning_efforts: ["low", "medium", "high", "max"],
      default_reasoning_effort: "high",
      embedding: false,
      supported_params: ["stop_sequences", "max_tokens", "reasoning_effort", "thinking", "tool_choice"],
      provider: "anthropic",
      family: "sonnet",
    },
    {
      id: "kimi",
      label: "Kimi K3",
      object: "model",
      created: 0,
      enabled: true,
      reasoning_efforts: null,
      embedding: false,
      provider: "moonshot",
      family: "kimi",
    },
    {
      id: "embed-small",
      label: "Text Embedding 3 (small)",
      object: "model",
      created: 0,
      enabled: true,
      reasoning_efforts: null,
      embedding: true,
      provider: "openai",
      family: "embed-small",
    },
  ],
}

const seedWithoutMindsHub: Record<string, CoreModels.Provider> = {
  acme: {
    id: "acme",
    name: "Acme",
    env: ["ACME_API_KEY"],
    models: {},
  },
}

function fakeHttp(hits: Ref.Ref<Hit[]>) {
  return HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [
        ...list,
        { url: request.url, authorization: request.headers["authorization"] ?? null },
      ])
      return HttpClientResponse.fromWeb(request, Response.json(MINDSHUB_MODELS_RESPONSE))
    }),
  )
}

function authLayer(key: string | undefined) {
  return Layer.mock(Auth.Service)({
    get: (id: string) => Effect.succeed(id === "mindshub" && key ? { type: "api" as const, key } : undefined),
  })
}

function coreLayer(seed: Record<string, CoreModels.Provider>) {
  return Layer.succeed(
    CoreModels.Service,
    CoreModels.Service.of({
      get: () => Effect.succeed(seed),
      refresh: () => Effect.void,
    }),
  )
}

// Stub out the real Kilo Gateway model fetch: ModelsDev.get() always fetches "kilo" models
// too, and these tests only care about the MindsHub injection, not a live network call.
const kiloModelsStub = Layer.succeed(
  ModelCache.KiloModelsService,
  ModelCache.KiloModelsService.of({ fetch: () => Effect.succeed({ models: {} }) }),
)

function layer(hits: Ref.Ref<Hit[]>, opts: { key?: string; seed?: Record<string, CoreModels.Provider> } = {}) {
  const cfg = TestConfig.layer()
  const access = authLayer(opts.key)
  const http = fakeHttp(hits)
  const cache = Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(cfg),
    Layer.provide(access),
    Layer.provide(kiloModelsStub),
  )
  return Layer.fresh(ModelsDev.layer).pipe(
    Layer.provide(coreLayer(opts.seed ?? seedWithoutMindsHub)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(cfg),
    Layer.provide(access),
    Layer.provide(cache),
  )
}

const it = testEffect(testInstanceStoreLayer)

it.live("registers MindsHub with an OpenAI-compatible route and its dedicated env var", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const providers = yield* ModelsDev.Service.use((models) => models.get()).pipe(
      Effect.provide(layer(hits, { key: "test-key" })),
      provideInstance(process.cwd()),
    )

    expect(providers.mindshub).toMatchObject({
      id: "mindshub",
      name: "MindsHub",
      env: ["MINDSHUB_API_KEY"],
      api: "https://api.mindshub.ai/v1",
      npm: "@ai-sdk/openai-compatible",
    })

    const hit = (yield* Ref.get(hits))[0]
    expect(hit?.url).toBe("https://api.mindshub.ai/v1/models")
    expect(hit?.authorization).toBe("Bearer test-key")
  }),
)

it.live("maps aliases to models, drops embedding-only rows, and derives the reasoning flag", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const providers = yield* ModelsDev.Service.use((models) => models.get()).pipe(
      Effect.provide(layer(hits, { key: "test-key" })),
      provideInstance(process.cwd()),
    )
    const mindshub = Provider.fromModelsDevProvider(providers.mindshub)

    expect(Object.keys(mindshub.models).sort()).toEqual(["kimi", "sonnet"])
    expect(mindshub.models.sonnet).toMatchObject({
      id: "sonnet",
      providerID: "mindshub",
      name: "Claude Sonnet 5",
      family: "sonnet",
      capabilities: { reasoning: true, toolcall: true },
    })
    expect(mindshub.models.kimi).toMatchObject({
      id: "kimi",
      name: "Kimi K3",
      family: "kimi",
      capabilities: { reasoning: false },
    })
  }),
)

it.live("skips the fetch and reports no models without an API key", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const providers = yield* ModelsDev.Service.use((models) => models.get()).pipe(
      Effect.provide(layer(hits, { key: undefined })),
      provideInstance(process.cwd()),
    )

    expect(providers.mindshub?.models).toEqual({})
    expect(yield* Ref.get(hits)).toEqual([])
  }),
)

it.live("does not override an entry the upstream models.dev catalog already provides", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const upstream: CoreModels.Provider = {
      id: "mindshub",
      name: "MindsHub (upstream)",
      env: ["MINDSHUB_API_KEY"],
      models: {
        placeholder: {
          id: "placeholder",
          name: "Placeholder",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: false,
          temperature: true,
          tool_call: true,
          limit: { context: 128000, output: 8192 },
        },
      },
    }
    const providers = yield* ModelsDev.Service.use((models) => models.get()).pipe(
      Effect.provide(layer(hits, { key: "test-key", seed: { ...seedWithoutMindsHub, mindshub: upstream } })),
      provideInstance(process.cwd()),
    )

    expect(providers.mindshub).toBe(upstream)
    expect(yield* Ref.get(hits)).toEqual([])
  }),
)
