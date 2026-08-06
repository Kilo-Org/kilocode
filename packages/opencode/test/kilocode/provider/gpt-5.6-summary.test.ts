import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

function model(api = "gpt-5.6-sol-fast", npm = "@ai-sdk/openai") {
  return {
    id: api,
    providerID: "openai",
    api: { id: api, npm, url: "https://api.openai.com/v1" },
    name: api,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 5, output: 30, cache: { read: 0.5, write: 6.25 } },
    limit: { context: 1_050_000, output: 128_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-07-09",
  } as Provider.Model
}

describe("GPT-5.6 reasoning summaries", () => {
  test("requests detailed summaries by default from direct OpenAI", () => {
    const result = ProviderTransform.options({ model: model(), sessionID: "test-session" })
    expect(result.reasoningSummary).toBe("detailed")
  })

  test("requests detailed summaries for every direct OpenAI reasoning variant", () => {
    const result = ProviderTransform.variants(model())
    expect(Object.values(result).every((variant) => variant.reasoningSummary === "detailed")).toBe(true)
  })

  test("keeps auto summaries for older and non-OpenAI GPT models", () => {
    expect(ProviderTransform.options({ model: model("gpt-5.5"), sessionID: "test-session" }).reasoningSummary).toBe(
      "auto",
    )
    expect(
      ProviderTransform.options({
        model: model("openai/gpt-5.6-sol", "@kilocode/kilo-gateway"),
        sessionID: "test-session",
      }).reasoningSummary,
    ).toBe("auto")
  })
})
