// Initialize the provider registry before importing a provider from its cycle.
import "@opencode-ai/core/plugin/provider"
import { AISDK } from "@opencode-ai/core/aisdk"
import { describe, expect } from "bun:test"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Effect } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { PluginHost } from "@opencode-ai/core/plugin/host"
import { TogetherAIPlugin } from "@opencode-ai/core/plugin/provider/togetherai"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = Effect.fn(function* () {
  const plugin = yield* PluginV2.Service
  const aisdk = yield* AISDK.Service
  const host = yield* PluginHost.make(plugin)
  yield* TogetherAIPlugin.effect(host)
})

function fakeSelectorSdk(calls: string[]) {
  const make = (method: string) => (id: string) => {
    calls.push(`${method}:${id}`)
    return { modelId: id, provider: method, specificationVersion: "v3" } as unknown as LanguageModelV3
  }
  return {
    responses: make("responses"),
    messages: make("messages"),
    chat: make("chat"),
    languageModel: make("languageModel"),
  }
}

describe("TogetherAIPlugin", () => {
  for (const id of ["togetherai", "custom-togetherai"]) {
    it.live(`preserves streaming usage through the plugin for ${id}`, () =>
      Effect.gen(function* () {
        const aisdk = yield* AISDK.Service
        const requests: Record<string, unknown>[] = []
        yield* addPlugin()
        const result = yield* aisdk.runSDK({
          model: ModelV2.Info.make({
            ...ModelV2.Info.empty(ProviderV2.ID.make(id), ModelV2.ID.make("model")),
            api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "@ai-sdk/togetherai" },
          }),
          package: "@ai-sdk/togetherai",
          options: {
            apiKey: "test-key",
            fetch: Object.assign(
              async (_url: RequestInfo | URL, init?: RequestInit) => {
                if (typeof init?.body !== "string") throw new Error("Expected a JSON request body")
                const body = JSON.parse(init.body)
                requests.push(body)
                const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
                return new Response(
                  chunk({
                    id: "test",
                    model: "model",
                    choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
                  }) +
                    chunk({ id: "test", model: "model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
                    (body.stream_options?.include_usage
                      ? chunk({
                          id: "test",
                          model: "model",
                          choices: [],
                          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
                        })
                      : "") +
                    "data: [DONE]\n\n",
                  { headers: { "content-type": "text/event-stream" } },
                )
              },
              { preconnect: () => {} },
            ),
          },
        })
        const parts = yield* Effect.promise(async () => {
          const model: LanguageModelV3 = result.sdk.languageModel("model")
          const stream = await model.doStream({
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
          })
          return Array.fromAsync(stream.stream)
        })
        expect(requests.at(0)?.stream_options).toEqual({ include_usage: true })
        expect(parts.find((part) => part.type === "finish")).toMatchObject({
          usage: { inputTokens: { total: 42 }, outputTokens: { total: 7 } },
        })
      }),
    )
  }

  it.effect("creates a TogetherAI SDK for @ai-sdk/togetherai", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()
      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/togetherai",
        options: { name: "togetherai" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("matches the old bundled provider package exactly", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const ignored = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "file:///tmp/@ai-sdk/togetherai-provider.js",
        options: { name: "togetherai" },
      })
      expect(ignored.sdk).toBeUndefined()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/togetherai",
        options: { name: "togetherai" },
      })
      expect(result.sdk).toBeDefined()
    }),
  )

  it.effect("creates bundled TogetherAI SDKs for custom provider IDs", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      yield* addPlugin()

      const result = yield* aisdk.runSDK({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(ProviderV2.ID.make("custom-togetherai"), ModelV2.ID.make("model")),
          api: { id: ModelV2.ID.make("model"), type: "aisdk", package: "test-provider" },
        }),
        package: "@ai-sdk/togetherai",
        options: { name: "custom-togetherai" },
      })

      expect(result.sdk.languageModel("model").provider).toBe("togetherai.chat")
    }),
  )

  it.effect("defaults language selection to sdk.languageModel with the model API ID", () =>
    Effect.gen(function* () {
      const plugin = yield* PluginV2.Service
      const aisdk = yield* AISDK.Service
      const calls: string[] = []
      yield* addPlugin()

      const result = yield* aisdk.runLanguage({
        model: ModelV2.Info.make({
          ...ModelV2.Info.empty(
            ProviderV2.ID.make("togetherai"),
            ModelV2.ID.make("meta-llama/Llama-3.3-70B-Instruct-Turbo"),
          ),
          api: {
            id: ModelV2.ID.make("meta-llama/Llama-3.3-70B-Instruct-Turbo"),
            type: "aisdk",
            package: "test-provider",
          },
        }),
        sdk: { languageModel: fakeSelectorSdk(calls).languageModel },
        options: {},
      })

      expect(result.language).toBeUndefined()
      expect(calls).toEqual([])
      expect(result.language ?? fakeSelectorSdk(calls).languageModel(result.model.api.id)).toBeDefined()
      expect(calls).toEqual(["languageModel:meta-llama/Llama-3.3-70B-Instruct-Turbo"])
    }),
  )
})
