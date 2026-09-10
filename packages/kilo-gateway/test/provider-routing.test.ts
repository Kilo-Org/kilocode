// Captured-request tests: the routing preferences a request carries in the
// routing header must reach the request body's top-level `provider` object on
// every Kilo Gateway transport, not only through the OpenRouter SDK — and the
// header itself must never leave the wrapper.

import { describe, expect, test } from "bun:test"
import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider"
import { createKilo } from "../src/provider"
import { providerRoutingHeaders, takeProviderRouting } from "../src/provider-routing"
import { HEADER_PROVIDER_ROUTING } from "../src/api/constants"

type Captured = { url: string; body: Record<string, unknown>; headers: Headers }

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
      headers: new Headers(init?.headers),
    })
    return new Response(JSON.stringify({ error: { message: "captured", type: "test" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })
  }
  return { calls, fetch: fetch as typeof fetch }
}

async function generate(
  model: LanguageModelV3,
  headers?: Record<string, string>,
  providerOptions?: Record<string, Record<string, unknown>>,
) {
  await model.doGenerate({ prompt, headers, providerOptions }).catch(() => undefined)
}

function asModel(model: unknown): LanguageModelV3 {
  return model as LanguageModelV3
}

describe("provider routing header", () => {
  test("round-trips preferences and strips the header", () => {
    const headers = new Headers(providerRoutingHeaders(routing))

    expect(takeProviderRouting(headers)).toEqual(routing)
    expect(headers.has(HEADER_PROVIDER_ROUTING)).toBe(false)
  })

  test("survives non-ASCII values", () => {
    const preferences = { order: ["провайдер/fp8"] }

    expect(takeProviderRouting(new Headers(providerRoutingHeaders(preferences)))).toEqual(preferences)
  })

  test("emits nothing for empty or non-object routing", () => {
    expect(providerRoutingHeaders(undefined)).toEqual({})
    expect(providerRoutingHeaders({})).toEqual({})
    expect(providerRoutingHeaders("gmicloud/fp8")).toEqual({})
    expect(providerRoutingHeaders(["gmicloud/fp8"])).toEqual({})
  })

  test("ignores a malformed header but still removes it", () => {
    const headers = new Headers({ [HEADER_PROVIDER_ROUTING]: "%7Bnot-json" })

    expect(takeProviderRouting(headers)).toBeUndefined()
    expect(headers.has(HEADER_PROVIDER_ROUTING)).toBe(false)
  })
})

describe("Kilo provider routing across transports", () => {
  const cases: Array<[string, (kilo: ReturnType<typeof createKilo>) => unknown, string, string]> = [
    ["OpenRouter", (kilo) => kilo.languageModel("z-ai/glm-4.6"), "/chat/completions", "z-ai/glm-4.6"],
    ["OpenAI", (kilo) => kilo.openai("openai/gpt-5.4"), "/responses", "openai/gpt-5.4"],
    ["Anthropic", (kilo) => kilo.anthropic("anthropic/claude-sonnet-4.6"), "/messages", "anthropic/claude-sonnet-4.6"],
    ["OpenAI-compatible", (kilo) => kilo.openaiCompatible("some/model"), "/chat/completions", "some/model"],
  ]

  test.each(cases)("%s transport merges the request routing into the body", async (_, model, path, id) => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(model(kilo)), providerRoutingHeaders(routing))

    expect(calls).toHaveLength(1)
    expect(calls[0].url.endsWith(path)).toBe(true)
    expect(calls[0].body.model).toBe(id)
    expect(calls[0].body.provider).toEqual(routing)
    expect(calls[0].headers.has(HEADER_PROVIDER_ROUTING)).toBe(false)
  })

  test("the OpenRouter SDK's own provider object agrees with the header", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })
    const preferences = { ...routing, sort: "price" }

    await generate(asModel(kilo.languageModel("z-ai/glm-4.6")), providerRoutingHeaders(preferences), {
      openrouter: { provider: preferences },
    })

    expect(calls[0].body.provider).toEqual(preferences)
  })

  test("the data-collection setting wins over routing on every transport", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch, dataCollection: "deny" })
    const headers = providerRoutingHeaders({ ...routing, data_collection: "allow" })

    await generate(asModel(kilo.openai("openai/gpt-5.4")), headers)
    await generate(asModel(kilo.anthropic("anthropic/claude-sonnet-4.6")), headers)
    await generate(asModel(kilo.languageModel("z-ai/glm-4.6")), headers)

    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call.body.provider).toEqual({ ...routing, data_collection: "deny" })
  })

  test("requests without routing leave the body's provider object untouched", async () => {
    const { calls, fetch } = capture()
    const kilo = createKilo({ kilocodeToken: "token", fetch })

    await generate(asModel(kilo.openai("openai/gpt-5.4")))
    await generate(asModel(kilo.anthropic("anthropic/claude-sonnet-4.6")), providerRoutingHeaders({}))

    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.body.provider).toBeUndefined()
  })
})
