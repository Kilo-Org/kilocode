import { describe, expect, test } from "bun:test"
import { generateText } from "ai"
import { buildRequestHeaders, createKilo, denyOpenRouterDataCollection } from "../src/provider"

function parse(body: BodyInit | null | undefined) {
  if (typeof body !== "string") throw new Error("Expected a JSON request body")
  const value: unknown = JSON.parse(body)
  return value
}

describe("Kilo provider request headers", () => {
  test("request headers override provider defaults", () => {
    const headers = buildRequestHeaders(
      {
        "content-type": "application/json",
        "x-kilocode-feature": "vscode-extension",
        "x-default-only": "kept",
      },
      {
        "x-kilocode-feature": "agent-manager",
        "x-request-only": "kept-too",
      },
    )

    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("x-kilocode-feature")).toBe("agent-manager")
    expect(headers.get("x-default-only")).toBe("kept")
    expect(headers.get("x-request-only")).toBe("kept-too")
  })
})

describe("Kilo provider data collection policy", () => {
  test("forces deny while preserving OpenRouter routing preferences", () => {
    const body = denyOpenRouterDataCollection(
      JSON.stringify({
        model: "test/model",
        provider: {
          order: ["Anthropic"],
          zdr: true,
          data_collection: "allow",
        },
      }),
    )

    expect(parse(body)).toEqual({
      model: "test/model",
      provider: {
        order: ["Anthropic"],
        zdr: true,
        data_collection: "deny",
      },
    })
  })

  test("adds deny to OpenRouter language model requests", async () => {
    const requests: unknown[] = []
    const provider = createKilo({
      apiKey: "test-key",
      baseURL: "https://example.com/api/openrouter",
      denyDataCollection: true,
      async fetch(_input, init) {
        requests.push(parse(init?.body))
        return Response.json({
          id: "response-1",
          created: 0,
          model: "test/model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      },
    })

    await generateText({
      model: provider.languageModel("test/model"),
      prompt: "hello",
      providerOptions: {
        openrouter: {
          provider: {
            order: ["Anthropic"],
            data_collection: "allow",
          },
        },
      },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      provider: {
        order: ["Anthropic"],
        data_collection: "deny",
      },
    })
  })
})
