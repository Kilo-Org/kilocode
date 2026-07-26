import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

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

describe("ProviderTransform.variants - Claude Opus 4.5 enabled-thinking payload", () => {
  test("anthropic opus-4-5 emits enabled thinking + effort across low/medium/high", () => {
    const model = mockModel({
      api: {
        id: "claude-opus-4-5-20251101",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.high).toEqual({
      thinking: { type: "enabled", budgetTokens: 16000 },
      effort: "high",
    })
  })

  test("anthropic opus-4.5 dotted form emits same enabled thinking shape", () => {
    const model = mockModel({
      api: {
        id: "claude-opus-4.5-20251101",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.high).toEqual({
      thinking: { type: "enabled", budgetTokens: 16000 },
      effort: "high",
    })
  })

  test("vertex opus-4-5 emits same shape via google-vertex/anthropic", () => {
    const model = mockModel({
      id: "google-vertex-anthropic/claude-opus-4-5",
      providerID: "google-vertex-anthropic",
      api: {
        id: "claude-opus-4-5@default",
        url: "https://us-central1-aiplatform.googleapis.com",
        npm: "@ai-sdk/google-vertex/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.high).toEqual({
      thinking: { type: "enabled", budgetTokens: 16000 },
      effort: "high",
    })
  })

  test("bedrock opus-4-5 emits enabled reasoningConfig + maxReasoningEffort", () => {
    const model = mockModel({
      id: "bedrock/anthropic-claude-opus-4-5",
      providerID: "bedrock",
      api: {
        id: "us.anthropic.claude-opus-4-5-20251101-v1:0",
        url: "https://bedrock.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.high).toEqual({
      reasoningConfig: {
        type: "enabled",
        budgetTokens: 16000,
        maxReasoningEffort: "high",
      },
    })
  })

  test("sap opus-4-5 emits enabled thinking (snake_case) wrapped in modelParams", () => {
    const model = mockModel({
      id: "sap/anthropic--claude-opus-4-5-20251101",
      providerID: "sap-ai-core",
      api: {
        id: "anthropic--claude-opus-4-5-20251101",
        url: "https://api.ai.core.cloud.sap",
        npm: "@jerome-benoit/sap-ai-provider-v2",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.high).toEqual({
      modelParams: {
        thinking: { type: "enabled", budget_tokens: 16000 },
        effort: "high",
      },
    })
  })
})
