import { describe, expect, test } from "bun:test"
import { transformRequestBody } from "../src/responses"

describe("Responses request sanitization", () => {
  test("strips item ids when storage is disabled", () => {
    const body = JSON.stringify({
      store: false,
      input: [
        {
          type: "reasoning",
          id: "rs_tmp_123",
          encrypted_content: "encrypted",
          summary: [{ type: "summary_text", text: "thinking" }],
        },
        {
          type: "message",
          role: "assistant",
          id: "msg_tmp_123",
          content: [{ type: "output_text", text: "Hello" }],
        },
        {
          type: "item_reference",
          id: "rs_tmp_456",
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Continue" }],
        },
      ],
    })

    const result = transformRequestBody("https://api.kilo.ai/api/openrouter/responses", body)
    const data = JSON.parse(result as string)

    expect(data.input).toHaveLength(3)
    expect(data.input[0].id).toBeUndefined()
    expect(data.input[0].encrypted_content).toBe("encrypted")
    expect(data.input[0].summary[0].text).toBe("thinking")
    expect(data.input[1].id).toBeUndefined()
    expect(data.input[1].content[0].text).toBe("Hello")
    expect(data.input.some((item: { type?: string }) => item.type === "item_reference")).toBe(false)
    expect(data.input[2].content[0].text).toBe("Continue")
  })

  test("keeps item ids when storage is enabled", () => {
    const body = JSON.stringify({
      store: true,
      input: [
        {
          type: "reasoning",
          id: "rs_123",
          encrypted_content: "encrypted",
          summary: [],
        },
        {
          type: "item_reference",
          id: "rs_456",
        },
      ],
    })

    expect(transformRequestBody("https://api.kilo.ai/api/openrouter/responses", body)).toBe(body)
  })

  test("leaves non-responses requests unchanged", () => {
    const body = "not json"

    expect(transformRequestBody("https://api.kilo.ai/api/openrouter/chat/completions", body)).toBe(body)
  })

  test("leaves invalid responses JSON unchanged", () => {
    const body = "not json"

    expect(transformRequestBody("https://api.kilo.ai/api/openrouter/responses", body)).toBe(body)
  })

  test("matches relative responses paths without a placeholder host", () => {
    const body = JSON.stringify({
      input: [
        {
          type: "message",
          role: "assistant",
          id: "msg_tmp_123",
          content: [{ type: "output_text", text: "Hello" }],
        },
      ],
    })
    const result = transformRequestBody("/api/openrouter/responses?stream=true", body)
    const data = JSON.parse(result as string)

    expect(data.input[0].id).toBeUndefined()
  })

  test("removes regex lookarounds from function tool schemas", () => {
    const body = JSON.stringify({
      tools: [
        {
          type: "function",
          name: "invite",
          parameters: {
            type: "object",
            examples: [{ pattern: "(?=annotation)" }],
            patternProperties: {
              "(?=private-)": { type: "string" },
              "^public-": { type: "string" },
            },
            properties: {
              email: {
                type: "string",
                format: "email",
                pattern:
                  "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
              },
              slug: { type: "string", pattern: "^[a-z0-9-]+$" },
              nested: {
                oneOf: [
                  { type: "string", pattern: "value(?=suffix)" },
                  { type: "string", pattern: "(?<=prefix)value" },
                  { type: "string", pattern: "(?<!prefix)value" },
                ],
              },
            },
          },
        },
      ],
    })
    const result = transformRequestBody("https://api.kilo.ai/api/openrouter/responses", body)
    const data = JSON.parse(result as string)
    const properties = data.tools[0].parameters.properties

    expect(properties.email).toEqual({ type: "string", format: "email" })
    expect(properties.slug.pattern).toBe("^[a-z0-9-]+$")
    expect(properties.nested.oneOf.every((item: { pattern?: string }) => item.pattern === undefined)).toBe(true)
    expect(data.tools[0].parameters.examples).toEqual([{ pattern: "(?=annotation)" }])
    expect(data.tools[0].parameters.patternProperties).toEqual({ "^public-": { type: "string" } })
  })

  test("sanitizes responses and denies data collection in one transform", () => {
    const body = JSON.stringify({
      input: [{ type: "message", role: "assistant", id: "msg_tmp_123" }],
      provider: { order: ["anthropic"] },
    })
    const result = transformRequestBody("https://api.kilo.ai/api/openrouter/responses", body, "deny")

    expect(JSON.parse(result as string)).toEqual({
      input: [{ type: "message", role: "assistant" }],
      provider: { order: ["anthropic"], data_collection: "deny" },
    })
  })

  test("denies data collection for non-responses requests", () => {
    const body = JSON.stringify({ model: "anthropic/claude-sonnet-4" })
    const result = transformRequestBody("https://api.kilo.ai/api/openrouter/chat/completions", body, "deny")

    expect(JSON.parse(result as string)).toEqual({
      model: "anthropic/claude-sonnet-4",
      provider: { data_collection: "deny" },
    })
  })
})
