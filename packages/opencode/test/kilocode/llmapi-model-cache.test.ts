// kilocode_change - new file
import { expect } from "bun:test"
import { Effect, Layer, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Auth } from "../../src/auth"
import { ModelCache } from "../../src/provider/model-cache"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

type Hit = { readonly url: string; readonly auth: string | undefined }

const auth = Layer.mock(Auth.Service)({ get: () => Effect.succeed(undefined) })
const it = testEffect(Layer.empty)

function layer(hits: Ref.Ref<Hit[]>, body: unknown = { data: [{ id: "gpt-4o-mini", owned_by: "openai" }] }) {
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(hits, (list) => [...list, { url: request.url, auth: request.headers["authorization"] }])
      return HttpClientResponse.fromWeb(request, Response.json(body))
    }),
  )
  return Layer.fresh(ModelCache.layer).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(TestConfig.layer()),
    Layer.provide(auth),
    Layer.provide(ModelCache.kiloModelsLayer),
  )
}

it.live("fetches llmapi models from /v1/models with the bearer key", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("llmapi", { apiKey: "sk-test", baseURL: "https://api.llmapi.test/v1" }),
    ).pipe(Effect.provide(layer(hits)))

    expect(Object.keys(models)).toEqual(["gpt-4o-mini"])
    const recorded = yield* Ref.get(hits)
    expect(recorded.map((h) => h.url)).toEqual(["https://api.llmapi.test/v1/models"])
    expect(recorded[0]?.auth).toBe("Bearer sk-test")
  }),
)

it.live("fetches the public llmapi catalog even without an api key", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) => cache.fetch("llmapi", {})).pipe(
      Effect.provide(layer(hits)),
    )
    // /v1/models is public: the catalog loads, and no bearer is sent when there's no key.
    expect(Object.keys(models)).toEqual(["gpt-4o-mini"])
    const recorded = yield* Ref.get(hits)
    expect(recorded.length).toBe(1)
    expect(recorded[0]?.auth).toBeUndefined()
  }),
)

it.live("enriches llmapi models from OpenRouter-shaped fields", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const body = {
      data: [
        {
          id: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4",
          context_length: 200000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          top_provider: { max_completion_tokens: 64000 },
          supported_parameters: ["tools", "temperature", "reasoning"],
        },
      ],
    }
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("llmapi", { apiKey: "sk-test", baseURL: "https://api.llmapi.test/v1" }),
    ).pipe(Effect.provide(layer(hits, body)))

    const m = models["anthropic/claude-sonnet-4"]
    expect(m?.name).toBe("Claude Sonnet 4")
    expect(m?.limit).toEqual({ context: 200000, output: 64000 })
    // $/token → $/M tokens.
    expect(m?.cost).toEqual({ input: 3, output: 15 })
    expect(m?.tool_call).toBe(true)
    expect(m?.reasoning).toBe(true)
    expect(m?.attachment).toBe(true)
    expect(m?.modalities).toEqual({ input: ["text", "image"], output: ["text"] })
  }),
)

it.live("falls back to defaults for a minimal {id, owned_by} endpoint", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("llmapi", { apiKey: "sk-test", baseURL: "https://api.llmapi.test/v1" }),
    ).pipe(Effect.provide(layer(hits, { data: [{ id: "gpt-4o-mini", owned_by: "openai" }] })))

    const m = models["gpt-4o-mini"]
    expect(m?.tool_call).toBe(true)
    expect(m?.attachment).toBe(true)
    expect(m?.limit).toEqual({ context: 128000, output: 4096 })
    expect(m?.cost).toEqual({ input: 0, output: 0 })
  }),
)

it.live("carries gateway-advertised reasoning_levels onto the model", () =>
  Effect.gen(function* () {
    const hits = yield* Ref.make<Hit[]>([])
    const body = {
      data: [
        // medium-only model: the gateway 400s low/high, so only "medium" is offered.
        { id: "gpt-5.2-pro", supported_parameters: ["reasoning"], reasoning_levels: ["medium"] },
        // reasoning supported via levels even though supported_parameters omits it.
        { id: "gpt-5-codex", supported_parameters: ["tools"], reasoning_levels: ["none", "low", "medium", "high"] },
        // thinking on/off, no discrete tiers -> empty list, still reasoning-capable.
        { id: "gpt-5.2-chat", supported_parameters: ["reasoning"], reasoning_levels: [] },
        // no reasoning info at all -> field absent, id heuristics apply downstream.
        { id: "plain-model", owned_by: "acme" },
      ],
    }
    const models = yield* ModelCache.Service.use((cache) =>
      cache.fetch("llmapi", { apiKey: "sk-test", baseURL: "https://api.llmapi.test/v1" }),
    ).pipe(Effect.provide(layer(hits, body)))

    expect(models["gpt-5.2-pro"]?.reasoningLevels).toEqual(["medium"])
    expect(models["gpt-5.2-pro"]?.reasoning).toBe(true)

    expect(models["gpt-5-codex"]?.reasoningLevels).toEqual(["none", "low", "medium", "high"])
    expect(models["gpt-5-codex"]?.reasoning).toBe(true)

    expect(models["gpt-5.2-chat"]?.reasoningLevels).toEqual([])
    expect(models["gpt-5.2-chat"]?.reasoning).toBe(true)

    expect(models["plain-model"]?.reasoningLevels).toBeUndefined()
    expect(models["plain-model"]?.reasoning).toBe(false)
  }),
)
