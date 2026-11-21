import { afterEach, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
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

const list = Provider.use.list()

it.instance(
  "getSmallModel returns undefined without kilo credentials when model IDs lack family metadata",
  Effect.gen(function* () {
    for (const key of ["KILO_API_KEY", "KILO_AUTH_CONTENT", "KILO_CONFIG_CONTENT"]) {
      yield* clearEnv(key)
    }
    const model = yield* Provider.use.getSmallModel(ProviderV2.ID.make("test-provider"))
    expect(model).toBeUndefined()
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
  "getSmallModel falls back to Kilo auto when the kilo provider is configured",
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
  "issue #15790: attachment:true alone derives image input capability",
  Effect.gen(function* () {
    const providers = yield* list
    const provider = providers[ProviderV2.ID.make("issue-15790-attachment-only")]
    expect(provider).toBeDefined()
    const model = provider.models["vision-model"]
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
  }),
  {
    config: {
      provider: {
        "issue-15790-attachment-only": {
          npm: "@ai-sdk/openai-compatible",
          models: {
            "vision-model": { name: "vision-model", attachment: true },
          },
        },
      },
    },
  },
)

it.instance(
  "issue #15790: modalities alone derive the attachment capability",
  Effect.gen(function* () {
    const providers = yield* list
    const provider = providers[ProviderV2.ID.make("issue-15790-modalities-only")]
    expect(provider).toBeDefined()
    const model = provider.models["vision-model"]
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(true)
  }),
  {
    config: {
      provider: {
        "issue-15790-modalities-only": {
          npm: "@ai-sdk/openai-compatible",
          models: {
            "vision-model": {
              name: "vision-model",
              modalities: { input: ["text", "image"], output: ["text"] },
            },
          },
        },
      },
    },
  },
)

it.instance(
  "issue #15790: explicit modalities.input overrides attachment image derivation",
  Effect.gen(function* () {
    const providers = yield* list
    const provider = providers[ProviderV2.ID.make("issue-15790-explicit-modalities")]
    expect(provider).toBeDefined()
    const model = provider.models["vision-model"]
    expect(model.capabilities.attachment).toBe(true)
    expect(model.capabilities.input.image).toBe(false)
  }),
  {
    config: {
      provider: {
        "issue-15790-explicit-modalities": {
          npm: "@ai-sdk/openai-compatible",
          models: {
            "vision-model": {
              name: "vision-model",
              attachment: true,
              modalities: { input: ["text"], output: ["text"] },
            },
          },
        },
      },
    },
  },
)
