import { createMistral } from "@ai-sdk/mistral"
import { streamText, tool } from "ai"
import { describe, expect, test } from "bun:test"
import { z } from "zod"

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return {
    id: "cmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "zai-glm-5-2",
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
}

function call(input: { id?: string; name: string; args: string; index?: number }) {
  return {
    ...(input.id ? { id: input.id } : {}),
    type: "function",
    function: { name: input.name, arguments: input.args },
    index: input.index ?? 0,
  }
}

const readCall = { id: "call-1", name: "read", input: { path: "/user/directory" } }
const grepCall = { id: "call-2", name: "grep", input: { pattern: "todo" } }

// Chunk shapes emitted by GLM models served through Mistral (issue #14653).
const streams = {
  "continuation chunk without id and with empty name": {
    expected: [readCall],
    chunks: [
      chunk({ role: "assistant", tool_calls: [call({ id: "call-1", name: "read", args: '{"path":"' })] }),
      chunk({ tool_calls: [call({ name: "", args: "/user/directory" })] }),
      chunk({ tool_calls: [call({ name: "", args: '"}' })] }, "tool_calls"),
    ],
  },
  "single complete tool call": {
    expected: [readCall],
    chunks: [
      chunk({
        role: "assistant",
        tool_calls: [call({ id: "call-1", name: "read", args: '{"path":"/user/directory"}' })],
      }),
      chunk({}, "tool_calls"),
    ],
  },
  "interleaved continuation chunks for two tool calls": {
    expected: [readCall, grepCall],
    chunks: [
      chunk({
        role: "assistant",
        tool_calls: [
          call({ id: "call-1", name: "read", args: '{"path":"', index: 0 }),
          call({ id: "call-2", name: "grep", args: '{"pattern":"', index: 1 }),
        ],
      }),
      chunk({ tool_calls: [call({ name: "", args: "/user/directory", index: 0 })] }),
      chunk({ tool_calls: [call({ name: "", args: "todo", index: 1 })] }),
      chunk({ tool_calls: [call({ name: "", args: '"}', index: 1 })] }),
      chunk({ tool_calls: [call({ name: "", args: '"}', index: 0 })] }, "tool_calls"),
    ],
  },
}

async function run(chunks: unknown[]) {
  const body = chunks.map((item) => `data: ${JSON.stringify(item)}\n\n`).join("") + "data: [DONE]\n\n"
  const mistral = createMistral({
    apiKey: "test",
    baseURL: "https://mistral.test/v1",
    fetch: Object.assign(async () => new Response(body, { headers: { "content-type": "text/event-stream" } }), {
      preconnect: () => {},
    }),
  })
  const result = streamText({
    model: mistral("zai-glm-5-2"),
    prompt: "read it",
    tools: {
      read: tool({ inputSchema: z.object({ path: z.string() }) }),
      grep: tool({ inputSchema: z.object({ pattern: z.string() }) }),
    },
  })
  const calls: { id: string; name: string; input: unknown }[] = []
  const errors: unknown[] = []
  for await (const part of result.fullStream) {
    if (part.type === "tool-call") calls.push({ id: part.toolCallId, name: part.toolName, input: part.input })
    if (part.type === "error") errors.push(part.error)
  }
  return { calls, errors }
}

describe("mistral provider tool-call streaming", () => {
  test.each(Object.entries(streams))("parses %s", async (_name, { chunks, expected }) => {
    const { calls, errors } = await run(chunks)
    expect(errors).toEqual([])
    expect(calls).toEqual(expected)
  })
})
