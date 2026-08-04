import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"
import { Provider } from "../../src/provider/provider"
import type * as ModelsDev from "@opencode-ai/core/models-dev"

function mockModel(overrides: Partial<any> = {}): any {
  return {
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/openai",
    },
    name: "Test Model",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 200_000, output: 64_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  }
}

function raw(options: ModelsDev.Model["reasoning_options"]): ModelsDev.Model {
  return { reasoning_options: options } as ModelsDev.Model
}

describe("ProviderTransform.reasoningVariants - models.dev reasoning_options", () => {
  test("effort tiers including 'max' and null 'none' on @ai-sdk/openai", () => {
    const target = mockModel({
      api: { id: "gpt-5.6", url: "https://api.openai.com", npm: "@ai-sdk/openai" },
    })
    const result = ProviderTransform.reasoningVariants(
      raw([{ type: "effort", values: ["none", null, "low", "medium", "high", "xhigh", "max"] }]),
      target,
    )
    expect(Object.keys(result ?? {})).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(result?.none).toEqual({
      reasoningEffort: "none",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"],
    })
    expect(result?.max).toEqual({
      reasoningEffort: "max",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"],
    })
  })

  test("effort tiers on @openrouter/ai-sdk-provider use reasoning object shape", () => {
    const target = mockModel({
      providerID: "openrouter",
      api: { id: "openai/gpt-5.6", url: "https://openrouter.ai", npm: "@openrouter/ai-sdk-provider" },
    })
    const result = ProviderTransform.reasoningVariants(
      raw([{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }]),
      target,
    )
    expect(Object.keys(result ?? {})).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(result?.max).toEqual({ reasoning: { effort: "max" } })
  })

  test("budget_tokens produces high/max budget variants on bedrock", () => {
    const target = mockModel({
      api: { id: "anthropic.claude-sonnet-4-5", url: "https://bedrock.amazonaws.com", npm: "@ai-sdk/amazon-bedrock" },
    })
    const result = ProviderTransform.reasoningVariants(raw([{ type: "budget_tokens", min: 1024 }]), target)
    expect(Object.keys(result ?? {})).toEqual(["high", "max"])
    expect(result?.max).toEqual({ reasoningConfig: { type: "enabled", budgetTokens: 31_999 } })
  })

  test("explicitly empty reasoning_options means no variants", () => {
    const target = mockModel()
    expect(ProviderTransform.reasoningVariants(raw([]), target)).toEqual({})
  })

  test("missing reasoning_options falls back to heuristics (undefined)", () => {
    const target = mockModel()
    expect(ProviderTransform.reasoningVariants(raw(undefined), target)).toBeUndefined()
  })

  test("models.dev reasoning_options take precedence over heuristic variants in the provider pipeline", () => {
    const provider = {
      id: "openai",
      name: "OpenAI",
      env: [],
      npm: "@ai-sdk/openai",
      models: {
        "gpt-5.6": {
          id: "gpt-5.6",
          name: "GPT-5.6",
          family: "gpt",
          release_date: "2025-12-11",
          attachment: true,
          reasoning: true,
          temperature: false,
          tool_call: true,
          cost: { input: 1, output: 4, cache_read: 0.5, cache_write: 0 },
          limit: { context: 400_000, output: 128_000 },
          reasoning_options: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
        },
        "gpt-5": {
          id: "gpt-5",
          name: "GPT-5",
          family: "gpt",
          release_date: "2024-06-01",
          attachment: true,
          reasoning: true,
          temperature: false,
          tool_call: true,
          cost: { input: 1, output: 4, cache_read: 0.5, cache_write: 0 },
          limit: { context: 400_000, output: 128_000 },
        },
      },
    } as unknown as ModelsDev.Provider

    const info = Provider.fromModelsDevProvider(provider)
    const gpt56 = info.models["gpt-5.6"]
    expect(Object.keys(gpt56.variants ?? {})).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
    expect(gpt56.variants?.["max"]).toEqual({
      reasoningEffort: "max",
      reasoningSummary: "detailed",
      include: ["reasoning.encrypted_content"],
    })

    const gpt5 = info.models["gpt-5"]
    expect(Object.keys(gpt5.variants ?? {})).toEqual(["minimal", "low", "medium", "high"])
  })
})
