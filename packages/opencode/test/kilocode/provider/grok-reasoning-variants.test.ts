import { describe, expect, test } from "bun:test"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

function model(id: string, npm: string) {
  return {
    id,
    providerID: "test",
    api: { id, npm, url: "https://example.test/v1" },
    capabilities: { reasoning: true },
    limit: { output: 64_000 },
  } as Provider.Model
}

describe("Grok reasoning variants", () => {
  test.each([
    ["grok-3", "@ai-sdk/xai"],
    ["grok-4", "@ai-sdk/xai"],
    ["x-ai/grok-code-fast", "@openrouter/ai-sdk-provider"],
  ])("suppresses generic variants for %s", (id, npm) => {
    expect(ProviderTransform.variants(model(id, npm))).toEqual({})
  })

  test("keeps direct grok-3-mini effort variants", () => {
    expect(ProviderTransform.variants(model("grok-3-mini", "@ai-sdk/xai"))).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    })
  })

  test("keeps generic grok-4.5 effort variants", () => {
    expect(ProviderTransform.variants(model("grok-4.5", "@ai-sdk/xai"))).not.toEqual({})
  })
})
