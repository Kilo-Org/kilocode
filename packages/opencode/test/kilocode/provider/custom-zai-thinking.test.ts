import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProviderTransform } from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

function model(id: string, reasoning = true, npm = "@ai-sdk/openai-compatible"): Provider.Model {
  return {
    id: ModelV2.ID.make("glm-5.3-flash"),
    providerID: ProviderV2.ID.make(id),
    api: { id: "glm-5.3-flash", npm, url: "https://example.test/v1" },
    name: "GLM 5.3 Flash",
    capabilities: {
      temperature: true,
      reasoning,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 8192 },
    status: "active",
    release_date: "2026-01-01",
    options: {},
    headers: {},
  }
}

describe("Z.ai thinking defaults", () => {
  for (const id of ["zai-api", "my-zhipuai-proxy", "bonsai-zai"]) {
    for (const reasoning of [true, false]) {
      test(`${id} does not inherit built-in thinking defaults with reasoning=${reasoning}`, () => {
        const result = ProviderTransform.options({ model: model(id, reasoning), sessionID: "test-session" })
        expect(result).not.toHaveProperty("thinking")
      })
    }
  }

  for (const id of ["zai", "zai-coding-plan", "zhipuai", "zhipuai-coding-plan"]) {
    test(`${id} preserves built-in thinking defaults`, () => {
      const result = ProviderTransform.options({ model: model(id), sessionID: "test-session" })
      expect(result.thinking).toEqual({ type: "enabled", clear_thinking: false })
    })
  }

  test("does not apply the defaults to another SDK", () => {
    const result = ProviderTransform.options({
      model: model("zai", true, "@ai-sdk/openai"),
      sessionID: "test-session",
    })
    expect(result).not.toHaveProperty("thinking")
  })
})
