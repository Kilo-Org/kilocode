import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider"

describe("ProviderTransform.message - bedrock claude empty content filtering", () => {
  const model = {
    id: "amazon-bedrock/anthropic.claude-sonnet-4-5",
    providerID: "amazon-bedrock",
    api: {
      id: "anthropic.claude-sonnet-4-5-20250514-v1:0",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com",
      npm: "@ai-sdk/amazon-bedrock",
    },
    name: "Claude Sonnet 4.5 (Bedrock)",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015 },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("filters out messages with empty string content", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters out empty text parts from array content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Hello" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result).toHaveLength(1)
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
  })

  test("removes entire message when all parts are empty", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "reasoning", text: "" },
        ],
      },
      { role: "user", content: "World" },
    ] as any[]

    const result = ProviderTransform.message(msgs, model, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toBe("World")
  })

  test("filters empty text for bedrock claude custom inference profiles", () => {
    const profile = {
      ...model,
      id: "amazon-bedrock/custom-claude-sonnet-4.5",
      api: {
        id: "arn:aws:bedrock:xxx:yyy:application-inference-profile/zzz",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    }

    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, profile, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("Hello")
    expect(result[1].content).toHaveLength(1)
    expect(result[1].content[0]).toEqual({ type: "text", text: "Answer" })
  })

  test("does not filter for non-claude bedrock models", () => {
    const titan = {
      ...model,
      id: "amazon-bedrock/amazon.titan-text-express-v1",
      api: {
        id: "amazon.titan-text-express-v1",
        url: "https://bedrock-runtime.us-east-1.amazonaws.com",
        npm: "@ai-sdk/amazon-bedrock",
      },
    }

    const msgs = [
      { role: "assistant", content: "" },
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, titan, {})

    expect(result).toHaveLength(2)
    expect(result[0].content).toBe("")
    expect(result[1].content).toHaveLength(1)
  })
})
