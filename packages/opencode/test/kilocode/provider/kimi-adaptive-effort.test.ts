import { describe, expect, test } from "bun:test"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

const model = {
  reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }],
} as unknown as ModelsDev.Model

function target(input: { providerID?: string; id: string; url?: string }) {
  return {
    id: input.id,
    providerID: input.providerID,
    api: { id: input.id, npm: "@ai-sdk/anthropic", url: input.url },
    capabilities: { reasoning: true },
    limit: { output: 64_000 },
  } as unknown as Provider.Model
}

describe("Kimi adaptive effort", () => {
  test("uses adaptive summarized thinking for Kimi model IDs", () => {
    const variants = ProviderTransform.reasoningVariants(
      model,
      target({ providerID: "moonshotai", id: "kimi-k3", url: "https://example.test/v1" }),
    )
    expect(variants).toEqual({
      low: { thinking: { type: "adaptive", display: "summarized" }, effort: "low" },
      high: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" },
      max: { thinking: { type: "adaptive", display: "summarized" }, effort: "max" },
    })
  })

  test("recognizes custom Kimi providers by Moonshot API host", () => {
    const variants = ProviderTransform.reasoningVariants(
      model,
      target({ providerID: "custom", id: "custom-model", url: "https://api.moonshot.ai/anthropic" }),
    )
    expect(variants?.high).toEqual({ thinking: { type: "adaptive", display: "summarized" }, effort: "high" })
  })

  test("handles partial metadata from generic Anthropic providers", () => {
    const variants = ProviderTransform.reasoningVariants(model, target({ id: "claude-sonnet-4-6" }))
    expect(variants?.high).toEqual({ thinking: { type: "adaptive" }, effort: "high" })
  })
})
