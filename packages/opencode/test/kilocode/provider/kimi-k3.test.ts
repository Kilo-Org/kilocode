import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

function model(api = "moonshotai/kimi-k3", npm = "@ai-sdk/openai-compatible", id = api) {
  return {
    id,
    providerID: "moonshotai",
    api: { id: api, npm, url: "https://api.moonshot.ai/v1" },
    name: "Kimi K3",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: { field: "reasoning_content" },
    },
    cost: { input: 3, output: 15, cache: { read: 0.3, write: 0 } },
    limit: { context: 1_048_576, output: 128_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-07-16",
  } as Provider.Model
}

describe("Kimi K3 reasoning efforts", () => {
  test("uses low, high, and max for OpenAI-compatible providers", () => {
    const item = model()
    const result = ProviderTransform.variants(item)

    expect(result).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    })
    expect(ProviderTransform.providerOptions(item, result.max)).toEqual({
      moonshotai: { reasoningEffort: "max" },
    })
  })

  test("preserves the existing router thinking toggles", () => {
    for (const npm of ["@kilocode/kilo-gateway", "@openrouter/ai-sdk-provider"]) {
      expect(ProviderTransform.variants(model("moonshotai/kimi-k3", npm))).toEqual({
        instant: { reasoning: { enabled: false } },
        thinking: { reasoning: { enabled: true } },
      })
    }
  })

  test("rewrites Groq's reasoning-effort variants without a provider allowlist", () => {
    expect(ProviderTransform.variants(model("moonshotai/kimi-k3", "@ai-sdk/groq"))).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
    })
  })

  test("preserves explicit catalog variants", () => {
    const item = model("moonshotai/kimi-k3", "@kilocode/kilo-gateway")
    item.variants = {
      instant: { reasoning: { enabled: false } },
      thinking: { reasoning: { enabled: true } },
    }

    expect(ProviderTransform.variants(item)).toEqual(item.variants)
  })

  test("matches a Kimi K3 API id behind a custom model alias", () => {
    const item = model("custom/kimi-k3-preview", "@ai-sdk/openai-compatible", "custom/primary")

    expect(Object.keys(ProviderTransform.variants(item))).toEqual(["low", "high", "max"])
  })

  test("leaves earlier Kimi models on the existing provider defaults", () => {
    expect(Object.keys(ProviderTransform.variants(model("moonshotai/kimi-k2.5")))).toEqual(["low", "medium", "high"])
  })
})
