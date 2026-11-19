import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, streamText, type ModelMessage } from "ai"
import { describe, expect, test } from "bun:test"
import { vertexOptions } from "@/kilocode/provider/cloud-auth"

const messages: ModelMessage[] = [
  {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: { query: "weather" } }],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "lookup",
        output: { type: "text", value: "sunny" },
      },
    ],
  },
  { role: "user", content: "continue" },
]

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

async function request(input: { stream: boolean; opt: boolean; transform: boolean }) {
  const bodies: Record<string, unknown>[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body: unknown = await req.json()
      if (!record(body)) throw new Error("HTTP fixture received a non-object request")
      bodies.push(body)
      if (input.stream) {
        const data = [
          {
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { role: "assistant" } }],
          },
          { id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "ok" } }] },
          {
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          },
        ]
        return new Response(`${data.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("")}data: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        })
      }
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 0,
        model: "test-model",
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })
    },
  })

  try {
    if (server.port === undefined) throw new Error("HTTP fixture did not bind a port")
    const opts = {
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      apiKey: "test-key",
      ...(input.opt ? { kiloOpenAICompatibleToolCallContent: "empty-string" } : {}),
      ...(input.transform
        ? {
            transformRequestBody: (body: Record<string, unknown>) => ({ ...body, retainedByTransform: true }),
          }
        : {}),
    }
    vertexOptions("private-provider", "@ai-sdk/openai-compatible", opts)
    expect(opts).not.toHaveProperty("kiloOpenAICompatibleToolCallContent")
    const sdk = createOpenAICompatible({ name: "test", ...opts })
    if (input.stream) await streamText({ model: sdk.languageModel("test-model"), messages, maxOutputTokens: 8 }).text
    else await generateText({ model: sdk.languageModel("test-model"), messages, maxOutputTokens: 8 })
    const body = bodies[0]
    if (!body) throw new Error("HTTP fixture did not capture a request")
    return body
  } finally {
    await server.stop(true)
  }
}

function history(body: Record<string, unknown>) {
  const msgs = Array.isArray(body.messages) ? body.messages.filter(record) : []
  return {
    call: msgs.find((msg) => msg.role === "assistant" && Array.isArray(msg.tool_calls)),
    result: msgs.find((msg) => msg.role === "tool"),
  }
}

describe("OpenAI-compatible tool-call content policy", () => {
  for (const stream of [false, true]) {
    const mode = stream ? "streaming" : "generation"

    test(`preserves nullable content and tool history by default in ${mode}`, async () => {
      const body = await request({ stream, opt: false, transform: false })
      const msgs = history(body)

      expect(msgs.call).toMatchObject({
        content: null,
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "lookup", arguments: '{"query":"weather"}' } },
        ],
      })
      expect(msgs.result).toMatchObject({ role: "tool", content: "sunny", tool_call_id: "call-1" })
    })

    test(`uses empty content only when opted in and composes an existing transform in ${mode}`, async () => {
      const body = await request({ stream, opt: true, transform: true })
      const msgs = history(body)

      expect(body.retainedByTransform).toBe(true)
      expect(msgs.call).toMatchObject({
        content: "",
        tool_calls: [
          { id: "call-1", type: "function", function: { name: "lookup", arguments: '{"query":"weather"}' } },
        ],
      })
      expect(msgs.result).toMatchObject({ role: "tool", content: "sunny", tool_call_id: "call-1" })
    })
  }
})
