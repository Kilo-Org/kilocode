import { describe, expect, test } from "bun:test"
import { sanitizeResponsesBody } from "../src/responses"

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

    const result = sanitizeResponsesBody("https://api.kilo.ai/api/openrouter/responses", body)
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

    expect(sanitizeResponsesBody("https://api.kilo.ai/api/openrouter/responses", body)).toBe(body)
  })

  test("leaves non-responses requests unchanged", () => {
    const body = "not json"

    expect(sanitizeResponsesBody("https://api.kilo.ai/api/openrouter/chat/completions", body)).toBe(body)
  })

  test("leaves invalid responses JSON unchanged", () => {
    const body = "not json"

    expect(sanitizeResponsesBody("https://api.kilo.ai/api/openrouter/responses", body)).toBe(body)
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
    const result = sanitizeResponsesBody("/api/openrouter/responses?stream=true", body)
    const data = JSON.parse(result as string)

    expect(data.input[0].id).toBeUndefined()
  })
})
