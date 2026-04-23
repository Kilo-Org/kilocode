import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider"

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

describe("ProviderTransform.variants - Claude Opus 4.7", () => {
  test("opus-4-7 returns adaptive thinking variants including xhigh (native anthropic)", () => {
    const model = mockModel({
      api: {
        id: "claude-opus-4-7",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(result.xhigh).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      effort: "xhigh",
    })
  })

  test("opus-4.7 dot-form returns adaptive thinking variants via @ai-sdk/gateway", () => {
    const model = mockModel({
      id: "anthropic/claude-opus-4-7",
      api: {
        id: "anthropic/claude-opus-4.7",
        url: "https://gateway.ai",
        npm: "@ai-sdk/gateway",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
  })

  test("opus-4-7 on bedrock returns adaptive reasoningConfig with xhigh", () => {
    const model = mockModel({
      api: {
        id: "anthropic.claude-opus-4-7",
        url: "https://bedrock.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(result.xhigh).toEqual({
      reasoningConfig: { type: "adaptive", maxReasoningEffort: "xhigh" },
    })
  })

  test("opus-4-6 keeps original adaptive efforts without xhigh", () => {
    const model = mockModel({
      api: {
        id: "claude-opus-4-6",
        url: "https://api.anthropic.com",
        npm: "@ai-sdk/anthropic",
      },
    })
    const result = ProviderTransform.variants(model)
    expect(Object.keys(result)).toEqual(["low", "medium", "high", "max"])
  })
})
