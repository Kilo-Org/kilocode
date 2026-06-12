import { describe, expect, test } from "bun:test"
import { sanitizeChatCompletionsBody } from "../src/chat-completions"

describe("Chat completions request sanitization", () => {
  test("rewrites nested oneOf schemas when Friendli is ordered", () => {
    const body = JSON.stringify({
      provider: { order: ["Anthropic", "Friendli"] },
      tools: [
        {
          type: "function",
          function: {
            name: "weather",
            parameters: {
              type: "object",
              properties: {
                location: {
                  oneOf: [
                    { type: "string" },
                    {
                      type: "object",
                      properties: { coordinates: { oneOf: [{ type: "string" }, { type: "array" }] } },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { schema: { oneOf: [{ type: "string" }, { type: "number" }] } },
      },
    })

    const result = sanitizeChatCompletionsBody("https://api.kilo.ai/api/openrouter/chat/completions", body)
    const data = JSON.parse(result as string)

    expect(JSON.stringify(data)).not.toContain('"oneOf"')
    expect(data.tools[0].function.parameters.properties.location.anyOf).toHaveLength(2)
    expect(data.tools[0].function.parameters.properties.location.anyOf[1].properties.coordinates.anyOf).toHaveLength(2)
    expect(data.response_format.json_schema.schema.anyOf).toHaveLength(2)
  })

  test("matches Friendli case-insensitively", () => {
    const body = JSON.stringify({
      provider: { order: ["friendli"] },
      tools: [{ function: { parameters: { oneOf: [{ type: "string" }] } } }],
    })
    const result = sanitizeChatCompletionsBody("/api/openrouter/chat/completions?stream=true", body)
    const data = JSON.parse(result as string)

    expect(data.tools[0].function.parameters.oneOf).toBeUndefined()
    expect(data.tools[0].function.parameters.anyOf).toHaveLength(1)
  })

  test("leaves schemas unchanged when Friendli is not ordered", () => {
    const body = JSON.stringify({
      provider: { order: ["Anthropic"] },
      tools: [{ function: { parameters: { oneOf: [{ type: "string" }] } } }],
    })

    expect(sanitizeChatCompletionsBody("https://api.kilo.ai/api/openrouter/chat/completions", body)).toBe(body)
  })

  test("leaves non-chat requests unchanged", () => {
    const body = JSON.stringify({ provider: { order: ["Friendli"] }, schema: { oneOf: [] } })

    expect(sanitizeChatCompletionsBody("https://api.kilo.ai/api/openrouter/responses", body)).toBe(body)
  })

  test("leaves invalid JSON unchanged", () => {
    const body = "not json"

    expect(sanitizeChatCompletionsBody("https://api.kilo.ai/api/openrouter/chat/completions", body)).toBe(body)
  })
})
