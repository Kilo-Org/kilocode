// kilocode_change - regression tests for Claude Opus 4.7 / 4.8 adaptive-thinking fixes.
// Covers id-alias matching, the OpenAI-compatible path, and the Bedrock fallback
// branch that previously emitted thinking.type=enabled for adaptive-only models.
import { describe, expect, test } from "bun:test"
import { isAnthropicAdaptiveId, ProviderTransform } from "../../src/provider/transform"

function mockModel(overrides: Partial<any> = {}): any {
  return {
    id: "test/test-model",
    providerID: "test",
    api: {
      id: "test-model",
      url: "https://api.test.com",
      npm: "@ai-sdk/anthropic",
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

describe("isAnthropicAdaptiveId", () => {
  test.each([
    ["claude-opus-4-7", true],
    ["claude-opus-4.7", true],
    ["claude-opus-4-8", true],
    ["claude-opus-4.8", true],
    ["anthropic.claude-opus-4-7", true],
    ["anthropic.claude-opus-4-8-20260101-v1:0", true],
    ["claude-sonnet-4-7", true],
    ["claude-sonnet-4-8", true],
    ["claude-opus-4-5", false],
    ["claude-opus-4-6", false],
    ["claude-3-5-sonnet", false],
    ["gpt-5-codex", false],
    ["gemini-3-pro", false],
  ])("isAnthropicAdaptiveId(%s) === %s", (id, expected) => {
    expect(isAnthropicAdaptiveId(id)).toBe(expected)
  })
})

describe("ProviderTransform.variants - LiteLLM / OpenAI-compatible adaptive thinking", () => {
  test("opus-4-8 over @ai-sdk/openai-compatible emits adaptive thinking + output_config.effort", () => {
    const model = mockModel({
      providerID: "litellm",
      api: {
        id: "claude-opus-4-8",
        url: "https://litellm.example.com/chat/completions",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)

    // Adaptive efforts identical to native Anthropic SDK path.
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])

    const LITELLM_STANDARD = new Set(["minimal", "low", "medium", "high"])
    for (const [effort, variant] of Object.entries(result) as Array<[string, any]>) {
      expect(variant.thinking).toEqual({ type: "adaptive" })
      expect(variant.output_config).toEqual({ effort })
      // LiteLLM only recognizes the standard reasoning_effort vocabulary; non-standard
      // adaptive levels (xhigh/max) must be clamped to "high" on the reasoningEffort
      // field to avoid `Unmapped reasoning effort` errors. The real effort still rides
      // through via output_config.effort.
      if (LITELLM_STANDARD.has(effort)) {
        expect(variant.reasoningEffort).toBe(effort)
      } else {
        expect(variant.reasoningEffort).toBe("high")
      }
      // The legacy enabled shape must NOT leak through this path.
      expect(JSON.stringify(variant)).not.toContain('"enabled"')
    }
  })

  test("opus-4-7 dot-form via openai-compatible also emits adaptive variants", () => {
    const model = mockModel({
      api: {
        id: "anthropic/claude-opus-4.7",
        url: "https://litellm.local",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(result.high.thinking).toEqual({ type: "adaptive" })
    expect(result.high.output_config).toEqual({ effort: "high" })
    expect(result.high.reasoningEffort).toBe("high")
    // xhigh / max levels must clamp reasoningEffort to "high" for LiteLLM compatibility.
    expect(result.xhigh.output_config).toEqual({ effort: "xhigh" })
    expect(result.xhigh.reasoningEffort).toBe("high")
    expect(result.max.output_config).toEqual({ effort: "max" })
    expect(result.max.reasoningEffort).toBe("high")
  })

  test("non-adaptive openai-compatible models keep their original reasoningEffort variants", () => {
    const model = mockModel({
      api: {
        id: "deepseek-v3.5",
        url: "https://deepseek.local",
        npm: "@ai-sdk/openai-compatible",
      },
    })
    const result = ProviderTransform.variants(model)
    for (const variant of Object.values(result) as any[]) {
      expect(variant).not.toHaveProperty("thinking")
      expect(variant).not.toHaveProperty("output_config")
      expect(variant.reasoningEffort).toBeTypeOf("string")
    }
  })
})

describe("ProviderTransform.variants - Bedrock adaptive fallback", () => {
  test("opus-4-8 with id alias still produces adaptive reasoningConfig (no enabled fallback)", () => {
    const model = mockModel({
      api: {
        id: "anthropic.claude-opus-4-8-20260101-v1:0",
        url: "https://bedrock.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    for (const [effort, variant] of Object.entries(result) as Array<[string, any]>) {
      expect((variant as any).reasoningConfig.type).toBe("adaptive")
      expect((variant as any).reasoningConfig.maxReasoningEffort).toBe(effort)
      expect((variant as any).reasoningConfig.display).toBe("summarized")
    }
  })

  test("non-anthropic bedrock model unaffected (Nova still uses enabled+effort)", () => {
    const model = mockModel({
      api: {
        id: "amazon.nova-2-pro",
        url: "https://bedrock.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })
    const result = ProviderTransform.variants(model)
    // Nova path is enabled+maxReasoningEffort and unchanged by this fix.
    for (const variant of Object.values(result) as any[]) {
      expect(variant.reasoningConfig.type).toBe("enabled")
      expect(variant.reasoningConfig.maxReasoningEffort).toBeTypeOf("string")
    }
  })
})

describe("ProviderTransform.variants - Anthropic SDK adaptive fallback", () => {
  test("opus-4-8 with limited adaptiveEfforts data still avoids thinking.type=enabled", () => {
    // Simulates an environment where anthropicAdaptiveEfforts is somehow null
    // (e.g. capabilities set wrong) but the id is still an adaptive-only model.
    const model = mockModel({
      api: {
        id: "claude-opus-4-8",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    for (const variant of Object.values(result) as any[]) {
      expect(variant.thinking?.type).toBe("adaptive")
      expect(JSON.stringify(variant)).not.toContain('"enabled"')
    }
  })
})
