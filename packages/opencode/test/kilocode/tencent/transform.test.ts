import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"

function model(providerID: string, id: string) {
  return {
    id,
    providerID,
    api: { id, url: "https://tokenhub.tencentmaas.com/v1", npm: "@ai-sdk/openai-compatible" },
    name: id,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 256_000, output: 64_000 },
    status: "active",
    options: {},
    headers: {},
    variants: {},
  } as any
}

describe("ProviderTransform.variants - Tencent", () => {
  test("hy3 on TokenHub exposes none/high", () => {
    expect(ProviderTransform.variants(model("tencent-tokenhub", "hy3"))).toEqual({
      none: { reasoningEffort: "none" },
      high: { reasoningEffort: "high" },
    })
  })

  test("hy3 on TokenPlan exposes none/high", () => {
    expect(ProviderTransform.variants(model("tencent-tokenplan", "hy3"))).toEqual({
      none: { reasoningEffort: "none" },
      high: { reasoningEffort: "high" },
    })
  })

  test("hy3-preview exposes none/low/medium/high", () => {
    expect(ProviderTransform.variants(model("tencent-tokenhub", "hy3-preview"))).toEqual({
      none: { reasoningEffort: "none" },
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
    })
  })
})

describe("ProviderTransform.options - Tencent", () => {
  const sessionID = "test-session"

  test("defaults reasoningEffort to high for hy3 on both providers", () => {
    for (const providerID of ["tencent-tokenhub", "tencent-tokenplan"]) {
      const result = ProviderTransform.options({ model: model(providerID, "hy3"), sessionID, providerOptions: {} })
      expect(result.reasoningEffort).toBe("high")
    }
  })

  test("does not force a default for hy3-preview (keeps server-side default)", () => {
    const result = ProviderTransform.options({
      model: model("tencent-tokenhub", "hy3-preview"),
      sessionID,
      providerOptions: {},
    })
    expect(result.reasoningEffort).toBeUndefined()
  })

  test("does not set the Tencent default for non-reasoning models", () => {
    const m = model("tencent-tokenhub", "hy3")
    m.capabilities.reasoning = false
    const result = ProviderTransform.options({ model: m, sessionID, providerOptions: {} })
    expect(result.reasoningEffort).toBeUndefined()
  })
})
