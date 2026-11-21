import { describe, expect, it } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { Env } from "@/env"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { REASONING_FIELD, effortVariants, isK2 } from "@/kilocode/provider/ifm-k2"
import { testEffect } from "../lib/effect"

const effectIt = testEffect(LayerNode.compile(LayerNode.group([Provider.node, Env.node, Plugin.node])))

describe("ifm-k2", () => {
  it("matches the MBZUAI-IFM K2 reasoning family", () => {
    expect(isK2("MBZUAI-IFM/K2-Think-v2")).toBe(true)
    expect(isK2("IFM/K2-Horizon-375B-A23B")).toBe(true)
    expect(isK2("k2-think-v2")).toBe(true)
  })

  it("skips Moonshot Kimi K2 and non-reasoning K2 models", () => {
    expect(isK2("kimi-k2-thinking")).toBe(false)
    expect(isK2("moonshotai/kimi-k2-thinking")).toBe(false)
    expect(isK2("MBZUAI-IFM/K2-V2-Instruct")).toBe(false)
    expect(isK2("gpt-4o")).toBe(false)
  })

  it("builds chat_template_kwargs effort variants", () => {
    expect(effortVariants()).toEqual({
      low: { chat_template_kwargs: { reasoning_effort: "low" } },
      medium: { chat_template_kwargs: { reasoning_effort: "medium" } },
      high: { chat_template_kwargs: { reasoning_effort: "high" } },
    })
  })
})

effectIt.instance(
  "applies IFM K2 defaults to an OpenAI-compatible K2 model",
  () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const model = providers[ProviderV2.ID.make("k2")]?.models["MBZUAI-IFM/K2-Think-v2"]

      expect(model?.capabilities.reasoning).toBe(true)
      expect(model?.capabilities.interleaved).toEqual({ field: REASONING_FIELD })
      expect(model?.capabilities.toolcall).toBe(true)
      expect(Object.keys(model?.variants ?? {})).toEqual(["low", "medium", "high"])
      expect(model?.variants?.high).toEqual({ chat_template_kwargs: { reasoning_effort: "high" } })
    }),
  {
    config: {
      provider: {
        k2: {
          name: "K2 Think",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://api.ifm.ai/v1", apiKey: "test" },
          models: {
            "MBZUAI-IFM/K2-Think-v2": {
              name: "MBZUAI-IFM/K2-Think-v2",
            },
          },
        },
      },
    },
  },
  { timeout: 30_000 },
)

effectIt.instance(
  "keeps explicit K2 config values and user variants",
  () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const model = providers[ProviderV2.ID.make("k2")]?.models["MBZUAI-IFM/K2-Think-v2"]

      expect(model?.capabilities.reasoning).toBe(false)
      expect(model?.capabilities.interleaved).toEqual({ field: "custom_field" })
      expect(Object.keys(model?.variants ?? {})).toEqual(["turbo"])
      expect(model?.variants?.turbo).toEqual({ chat_template_kwargs: { reasoning_effort: "high" } })
    }),
  {
    config: {
      provider: {
        k2: {
          name: "K2 Think",
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "https://api.ifm.ai/v1", apiKey: "test" },
          models: {
            "MBZUAI-IFM/K2-Think-v2": {
              name: "MBZUAI-IFM/K2-Think-v2",
              reasoning: false,
              interleaved: "custom_field",
              variants: {
                turbo: { chat_template_kwargs: { reasoning_effort: "high" } },
              },
            },
          },
        },
      },
    },
  },
  { timeout: 30_000 },
)

effectIt.instance(
  "leaves non-K2 OpenAI-compatible models untouched",
  () =>
    Effect.gen(function* () {
      const providers = yield* Provider.use.list()
      const model = providers[ProviderV2.ID.make("other")]?.models["qwen-custom"]

      expect(model?.capabilities.reasoning).toBe(true)
      expect(model?.capabilities.interleaved).toBe(false)
      expect(model?.variants?.high).toBeUndefined()
      expect(model?.variants?.custom).toEqual({ reasoningEffort: "custom" })
    }),
  {
    config: {
      provider: {
        other: {
          name: "Other",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "test" },
          models: {
            "qwen-custom": {
              name: "Qwen Custom",
              reasoning: true,
              limit: { context: 128_000, output: 16_000 },
              variants: {
                high: { disabled: true },
                custom: { reasoningEffort: "custom" },
              },
            },
          },
        },
      },
    },
  },
  { timeout: 30_000 },
)
