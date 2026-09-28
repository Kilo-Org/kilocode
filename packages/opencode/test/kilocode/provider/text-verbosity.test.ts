import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

function model(input: { providerID: string; api: string; npm: string }) {
  return {
    id: `${input.providerID}/${input.api}`,
    providerID: input.providerID,
    api: { id: input.api, npm: input.npm, url: "https://example.test/v1" },
    name: input.api,
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
    limit: { context: 400_000, output: 128_000 },
    status: "active",
    options: {},
    headers: {},
  } as Provider.Model
}

describe("gpt-5 textVerbosity gate", () => {
  test("sets low verbosity for Responses-API providers", () => {
    const result = ProviderTransform.options({
      model: model({ providerID: "openai", api: "gpt-5.2", npm: "@ai-sdk/openai" }),
      sessionID: "test-session",
    })
    expect(result.textVerbosity).toBe("low")
  })

  test("leaves the azure provider unset", () => {
    const result = ProviderTransform.options({
      model: model({ providerID: "azure", api: "gpt-5.2", npm: "@ai-sdk/azure" }),
      sessionID: "test-session",
    })
    expect(result.textVerbosity).toBeUndefined()
  })

  test("leaves providers outside the Responses allowlist unset", () => {
    const result = ProviderTransform.options({
      model: model({ providerID: "anthropic", api: "gpt-5.2", npm: "@ai-sdk/anthropic" }),
      sessionID: "test-session",
    })
    expect(result.textVerbosity).toBeUndefined()
  })
})
