import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

// Kilo-specific reasoning-effort gate regression coverage (issue #13342).
//
// OpenAI's `none`/`xhigh` reasoning_effort tiers are rollout-gated and only
// gpt-5-family models accept them. Non-OpenAI models routed through the OpenAI
// npm on a compatible base URL (e.g. Grok via api.x.ai) reject them, so Kilo
// must not offer those tiers to non-gpt-5 models. See
// src/kilocode/provider/transform.ts.

function model(overrides: Record<string, any> = {}): any {
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
    cost: {
      input: 0.001,
      output: 0.002,
      cache: { read: 0.0001, write: 0.0002 },
    },
    limit: {
      context: 200_000,
      output: 64_000,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
    ...overrides,
  }
}

describe("ProviderTransform.variants - gpt-5 rollout-tier gate", () => {
  test("grok-4.6 on the OpenAI npm does not get OpenAI rollout-gated none/xhigh tiers", () => {
    const result = ProviderTransform.variants(
      model({
        id: "grok-4.6",
        providerID: "xai",
        api: { id: "grok-4.6", url: "https://api.x.ai", npm: "@ai-sdk/openai" },
        release_date: "2026-08-12",
      }),
    )
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    expect(result.medium).toEqual({
      reasoningEffort: "medium",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })
  })

  test("unknown reasoning models on the OpenAI npm keep only widely supported efforts", () => {
    const result = ProviderTransform.variants(
      model({
        id: "my-compatible-model",
        providerID: "custom",
        api: { id: "my-compatible-model", url: "https://api.custom.com", npm: "@ai-sdk/openai" },
        release_date: "2026-08-12",
      }),
    )
    expect(Object.keys(result)).toEqual(["low", "medium", "high"])
  })

  test("gpt-5 lookalikes stay out of the gpt-5 family", () => {
    for (const id of ["gpt-50", "gpt-5o"]) {
      const result = ProviderTransform.variants(
        model({
          id,
          api: { id, url: "https://api.openai.com", npm: "@ai-sdk/openai" },
          release_date: "2026-08-12",
        }),
      )
      expect(Object.keys(result)).toEqual(["low", "medium", "high"])
    }
  })

  test("dot-prefixed gpt-5 id (Bedrock Mantle) keeps rollout-gated tiers", () => {
    const result = ProviderTransform.variants(
      model({
        id: "openai.gpt-5.5",
        providerID: "amazon-bedrock",
        api: {
          id: "openai.gpt-5.5",
          url: "https://bedrock-mantle.us-east-2.api.aws/openai/v1",
          npm: "@ai-sdk/amazon-bedrock/mantle",
        },
        release_date: "2026-04-23",
      }),
    )
    expect(Object.keys(result)).toEqual(["none", "low", "medium", "high", "xhigh"])
  })

  test("hyphen-prefixed gpt-5 deployment id (SAP AI Core) keeps rollout-gated tiers", () => {
    const result = ProviderTransform.variants(
      model({
        id: "azure-openai--gpt-5.4",
        providerID: "sap-ai-core",
        api: { id: "azure-openai--gpt-5.4", url: "https://api.ai.sap", npm: "@jerome-benoit/sap-ai-provider-v2" },
        release_date: "2026-01-15",
      }),
    )
    expect(Object.keys(result)).toEqual(["none", "low", "medium", "high", "xhigh"])
  })
})
