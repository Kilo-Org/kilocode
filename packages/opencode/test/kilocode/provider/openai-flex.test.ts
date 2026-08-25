import { expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"
import { streamText } from "ai"
import { ProviderTransform } from "../../../src/provider/transform"

test("maps Flex service tier into the OpenAI provider namespace", () => {
  const model = {
    providerID: "openai",
    api: { npm: "@ai-sdk/openai" },
    capabilities: { reasoning: false },
  } as unknown as Parameters<typeof ProviderTransform.providerOptions>[0]

  expect(ProviderTransform.providerOptions(model, { serviceTier: "flex" })).toEqual({
    openai: { serviceTier: "flex" },
  })
})

const capture = async (serviceTier: "flex" | undefined) => {
  let body: Record<string, unknown> | undefined
  const fetch: typeof globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(
        `data: ${JSON.stringify({
          type: "response.completed",
          response: {
            id: "resp_test",
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const provider = createOpenAI({
    apiKey: "test-key",
    baseURL: "https://api.openai.test/v1",
    fetch,
  })

  const result = streamText({
    model: provider.responses("gpt-5.6-luna"),
    prompt: "hello",
    ...(serviceTier ? { providerOptions: { openai: { serviceTier } } } : {}),
    maxRetries: 0,
  })

  await result.text
  return body
}

test("forwards Flex service tier through the OpenAI Responses SDK", async () => {
  expect(await capture("flex")).toMatchObject({ service_tier: "flex" })
})

test("preserves the default OpenAI service tier behavior", async () => {
  expect(await capture(undefined)).not.toHaveProperty("service_tier")
})
