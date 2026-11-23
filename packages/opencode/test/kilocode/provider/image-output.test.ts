import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../../src/provider/transform"
import type { Provider } from "../../../src/provider/provider"

function model(input: { providerID: string; api: string; npm: string; image: boolean }) {
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
      output: { text: true, audio: false, image: input.image, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 1, output: 1, cache: { read: 0, write: 0 } },
    limit: { context: 100_000, output: 10_000 },
    status: "active",
    options: {},
    headers: {},
  } as Provider.Model
}

const options = (input: Parameters<typeof model>[0]) =>
  ProviderTransform.options({ model: model(input), sessionID: "test-session" })

describe("image output modalities", () => {
  test("requests images from Kilo Gateway image models", () => {
    expect(
      options({
        providerID: "kilo",
        api: "google/gemini-nano-banana-2.1",
        npm: "@kilocode/kilo-gateway",
        image: true,
      }).modalities,
    ).toEqual(["image", "text"])
  })

  test("requests images from OpenRouter image models", () => {
    expect(
      options({
        providerID: "openrouter",
        api: "openai/gpt-5.4-image-2",
        npm: "@openrouter/ai-sdk-provider",
        image: true,
      }).modalities,
    ).toEqual(["image", "text"])
  })

  test("leaves text-only models unchanged", () => {
    expect(
      options({ providerID: "kilo", api: "anthropic/claude-sonnet-4.6", npm: "@kilocode/kilo-gateway", image: false })
        .modalities,
    ).toBeUndefined()
  })

  test("does not steer auto routers to image models", () => {
    expect(
      options({ providerID: "kilo", api: "openrouter/auto", npm: "@kilocode/kilo-gateway", image: true }).modalities,
    ).toBeUndefined()
  })

  test("leaves providers without the OpenRouter modalities parameter unchanged", () => {
    expect(
      options({ providerID: "google", api: "gemini-3-pro-image", npm: "@ai-sdk/google", image: true }).modalities,
    ).toBeUndefined()
  })
})
