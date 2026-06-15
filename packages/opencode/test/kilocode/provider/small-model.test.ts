import { describe, expect, test } from "bun:test"
import type { Provider } from "@/provider/provider"
import { KiloSmallModel } from "@/kilocode/provider/small-model"
import { ModelID, ProviderID } from "@/provider/schema"

function model(): Provider.Model {
  return {
    id: ModelID.make("command-a-reasoning"),
    providerID: ProviderID.make("cohere"),
    name: "Command A Reasoning",
    family: "command",
    api: {
      id: "command-a-reasoning",
      url: "https://api.cohere.ai/compatibility/v1",
      npm: "@ai-sdk/openai-compatible",
    },
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
    limit: { context: 128_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
    variants: {
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
    },
  }
}

describe("kilocode.provider.small-model", () => {
  test("uses the configured model-specific reasoning variant", () => {
    expect(
      KiloSmallModel.options(model(), {
        small_model_variant_overrides: {
          "cohere/command-a-reasoning": "high",
        },
      }),
    ).toEqual({ reasoningEffort: "high" })
  })

  test("falls back to the existing small-model default for stale variants", () => {
    expect(
      KiloSmallModel.options(model(), {
        small_model_variant_overrides: {
          "cohere/command-a-reasoning": "unsupported",
        },
      }),
    ).toEqual({ reasoningEffort: "low" })
  })
})
