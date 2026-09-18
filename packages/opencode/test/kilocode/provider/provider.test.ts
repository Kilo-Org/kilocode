import { afterEach, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect } from "effect"
import { Env } from "@/env"
import { Plugin } from "@/plugin/index"
import { Provider } from "@/provider/provider"
import { disposeAllInstances } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const originalEnv = new Map<string, string | undefined>()

const rememberEnv = (key: string) => {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key])
}

const clearEnv = (key: string) =>
  Effect.gen(function* () {
    rememberEnv(key)
    delete process.env[key]
    yield* Env.use.remove(key)
  })

afterEach(async () => {
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  originalEnv.clear()
  await disposeAllInstances()
})

const it = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))

it.instance(
  "getSmallModel picks the provider's own model when model IDs lack family metadata",
  Effect.gen(function* () {
    for (const key of ["KILO_API_KEY", "KILO_AUTH_CONTENT", "KILO_CONFIG_CONTENT"]) {
      yield* clearEnv(key)
    }
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "gpt-5-nano" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "gpt-5-nano": { release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
        kilo: null,
      },
    },
  },
)

it.instance(
  "getSmallModel stays on the configured provider even with kilo credentials",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "gpt-5-nano" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "gpt-5-nano": { release_date: "2026-01-01" },
          },
          options: { apiKey: "test-key" },
        },
        kilo: {
          options: { apiKey: "kilo-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel picks the cheapest model by price when no family matches",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model?.id).toBe(ModelV2.ID.make("cheap-model"))
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "cheap-model": { release_date: "2025-01-01", cost: { input: 0.3, output: 1.2 } },
            "expensive-model": { release_date: "2026-01-01", cost: { input: 5, output: 15 } },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel falls back to Kilo auto when the provider has no text-output model",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "kilo", id: "kilo-auto/small" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "image-only": {
              release_date: "2026-01-01",
              modalities: { input: ["text"], output: ["image"] },
            },
          },
          options: { apiKey: "test-key" },
        },
        kilo: {
          options: { apiKey: "kilo-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel uses a chat model without tool calling over the Kilo fallback",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "sonar-like" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "sonar-like": {
              release_date: "2026-01-01",
              tool_call: false,
              cost: { input: 1, output: 1 },
            },
          },
          options: { apiKey: "test-key" },
        },
        kilo: {
          options: { apiKey: "kilo-key" },
        },
      },
    },
  },
)

it.instance(
  "getSmallModel skips non-text models when a chat model is present",
  Effect.gen(function* () {
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toMatchObject({ providerID: "test-provider", id: "chat-model" })
  }),
  {
    config: {
      provider: {
        "test-provider": {
          name: "Test Provider",
          npm: "@ai-sdk/openai-compatible",
          models: {
            "image-only": {
              release_date: "2026-01-01",
              modalities: { input: ["text"], output: ["image"] },
              cost: { input: 0, output: 0 },
            },
            "chat-model": {
              release_date: "2025-01-01",
              cost: { input: 1, output: 1 },
            },
          },
          options: { apiKey: "test-key" },
        },
      },
    },
  },
)
