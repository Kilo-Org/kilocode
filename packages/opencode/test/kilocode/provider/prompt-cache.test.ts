import { describe, expect, test } from "bun:test"
import { streamText } from "ai"
import { createKilo } from "@kilocode/kilo-gateway"
import { ProviderTransform } from "@/provider/transform"

const model = {
  id: "openai/gpt-5.6-sol",
  providerID: "kilo",
  api: {
    id: "openai/gpt-5.6-sol",
    url: "https://api.kilo.ai",
    npm: "@kilocode/kilo-gateway",
  },
  capabilities: { reasoning: true },
  limit: { output: 128_000 },
} as any

describe("Kilo GPT-5.6 prompt cache options", () => {
  test("preserves the session key through Kilo provider options", () => {
    const sessionID = "ses_cache_probe"
    const options = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    const providerOptions = ProviderTransform.providerOptions(model, options)

    expect(options.promptCacheKey).toBe(sessionID)
    expect(providerOptions.openai.promptCacheKey).toBe(sessionID)
  })

  test("allows Kilo provider configuration to disable the session key", () => {
    const options = ProviderTransform.options({
      model,
      sessionID: "ses_cache_probe",
      providerOptions: { setCacheKey: false },
    })

    expect(options.promptCacheKey).toBeUndefined()
  })

  test("sends the session key in the Kilo Responses body", async () => {
    let body: Record<string, unknown> | undefined
    const sdk = createKilo({
      kilocodeToken: "test",
      fetch: (async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
      }) as typeof fetch,
    })
    const sessionID = "ses_cache_probe"
    const options = ProviderTransform.options({ model, sessionID, providerOptions: {} })
    const providerOptions = ProviderTransform.providerOptions(model, options)

    for await (const _ of (
      await streamText({
        model: sdk.openai("openai/gpt-5.6-sol"),
        prompt: "Hi",
        providerOptions,
      })
    ).fullStream) {
      // Consume the stream so the lazy request executes.
    }

    expect(body?.prompt_cache_key).toBe(sessionID)
  })
})
