import { describe, expect, test } from "bun:test"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText } from "ai"
import { filterSSE } from "@/kilocode/provider/provider"

const encoder = new TextEncoder()

function response(records: string[], type = "text/event-stream") {
  const bytes = encoder.encode(records.join("\n\n") + "\n\n")
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (let offset = 0; offset < bytes.length; offset += 7) {
        ctrl.enqueue(bytes.slice(offset, offset + 7))
      }
      ctrl.close()
    },
  })
  return new Response(body, { headers: { "content-type": type } })
}

function record(data: unknown, event?: string) {
  const name = event ? `event: ${event}\n` : ""
  return `${name}data: ${JSON.stringify(data)}`
}

describe("provider SSE filtering", () => {
  test("ignores named metadata in OpenAI-compatible streams", async () => {
    const records = [
      record({
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
      }),
      record({ object: "billing.summary", billing: { cost: "0.01" } }, "billing_summary"),
      record(
        {
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
        },
        "message",
      ),
      record({
        id: "chatcmpl-test",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      "data: [DONE]",
    ]
    const provider = createOpenAICompatible({
      name: "test",
      baseURL: "https://example.com/v1",
      apiKey: "test",
      fetch: async () => filterSSE(response(records, "Text/Event-Stream; Charset=UTF-8"), "@ai-sdk/openai-compatible"),
    })

    const result = streamText({ model: provider("test-model"), prompt: "Hi" })
    expect(await result.text).toBe("Hello")
    expect(await result.finishReason).toBe("stop")
  })

  test("ignores named metadata while preserving Anthropic events", async () => {
    const records = [
      record(
        {
          type: "message_start",
          message: {
            id: "msg_test",
            type: "message",
            role: "assistant",
            content: [],
            model: "test-model",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        "message_start",
      ),
      record({ type: "billing_summary", object: "billing.summary", billing: { cost: "0.01" } }, "billing_summary"),
      record(
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        "content_block_start",
      ),
      record(
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        "content_block_delta",
      ),
      record({ type: "content_block_stop", index: 0 }, "content_block_stop"),
      record(
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 1 },
        },
        "message_delta",
      ),
      record({ type: "message_stop" }, "message_stop"),
    ]
    const provider = createAnthropic({
      baseURL: "https://example.com/v1",
      apiKey: "test",
      fetch: async () => filterSSE(response(records), "@ai-sdk/anthropic"),
    })

    const result = streamText({ model: provider("test-model"), prompt: "Hi" })
    expect(await result.text).toBe("Hello")
    expect(await result.finishReason).toBe("stop")
  })

  test("leaves unrelated responses unchanged", () => {
    const res = Response.json({ ok: true })
    const stream = response([record({ ok: true }, "metadata")])
    expect(filterSSE(res, "@ai-sdk/openai-compatible")).toBe(res)
    expect(filterSSE(res, "@ai-sdk/anthropic")).toBe(res)
    expect(filterSSE(stream, "@ai-sdk/openai")).toBe(stream)
  })
})
