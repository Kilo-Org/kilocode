// Captured-request tests: the model's provider routing preferences must reach
// the request body's top-level `provider` object on every Kilo Gateway
// transport, not only through the OpenRouter SDK.

import { describe, expect, test } from "bun:test"
import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider"
import { createKilo } from "../src/provider"

type Captured = { url: string; body: Record<string, unknown> }

const routing = { order: ["gmicloud/fp8"], only: ["gmicloud/fp8"], allow_fallbacks: false }

const prompt: Parameters<LanguageModelV3["doGenerate"]>[0]["prompt"] = [
  { role: "user", content: [{ type: "text", text: "hi" }] },
]

// The body is captured before the SDK parses the reply, so an error reply is
// enough — no transport-specific success payloads to maintain.
function capture() {
  const calls: Captured[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    return new Response(JSON.stringify({ error: { message: "captured", type: "test" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }
  return { calls, fetch: fetch as typeof fetch }
}

async function generate(model: LanguageModelV3, providerOptions?: Record<string, Record<string, unknown>>) {
  await model.doGenerate({ prompt, providerOptions }).catch(() => undefined)
}

function asModel(model: unknown): LanguageModelV3 {
  return model as LanguageModelV3
}

describe("Kilo provider routing across transports", () => {
  test("OpenRouter transport merges the model routing into the body", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.languageModel("z-ai/glm-4.6", { provider: routing })))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.endsWith("/chat/completions")).toBe(true)
    expect(calls[0].body.model).toBe("z-ai/glm-4.6")
    expect(calls[0].body.provider).toEqual(routing)
  })

  test("OpenAI transport merges the model routing into the body", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.openai("openai/gpt-5.4", { provider: routing })))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.endsWith("/responses")).toBe(true)
    expect(calls[0].body.model).toBe("openai/gpt-5.4")
    expect(calls[0].body.provider).toEqual(routing)
  })

  test("Anthropic transport merges the model routing into the body", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.anthropic("anthropic/claude-sonnet-4.6", { provider: routing })))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.endsWith("/messages")).toBe(true)
    expect(calls[0].body.model).toBe("anthropic/claude-sonnet-4.6")
    expect(calls[0].body.provider).toEqual(routing)
  })

  test("OpenAI-compatible transport merges the model routing into the body", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.openaiCompatible("some/model", { provider: routing })))

    expect(calls).toHaveLength(1)
    expect(calls[0].body.provider).toEqual(routing)
  })

  test("request-level routing wins over the model routing on the OpenRouter transport", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.languageModel("z-ai/glm-4.6", { provider: routing })), {
      openrouter: { provider: { order: ["baseten/fp8"], sort: "price" } },
    })

    expect(calls[0].body.provider).toEqual({
      order: ["baseten/fp8"],
      sort: "price",
      only: ["gmicloud/fp8"],
      allow_fallbacks: false,
    })
  })

  test("the data-collection setting wins over routing on every transport", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch, dataCollection: "deny" })
    const preferences = { ...routing, data_collection: "allow" }

    await generate(asModel(kilo.openai("openai/gpt-5.4", { provider: preferences })))
    await generate(asModel(kilo.anthropic("anthropic/claude-sonnet-4.6", { provider: preferences })))
    await generate(asModel(kilo.languageModel("z-ai/glm-4.6", { provider: preferences })))

    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call.body.provider).toEqual({ ...routing, data_collection: "deny" })
  })

  test("models without routing leave the body's provider object untouched", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.openai("openai/gpt-5.4")))
    await generate(asModel(kilo.anthropic("anthropic/claude-sonnet-4.6", { provider: {} })))

    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.body.provider).toBeUndefined()
  })
})
