import { describe, expect, test } from "bun:test"
import { requestOllamaFim } from "../src/ollama-fim"

const encoder = new TextEncoder()

describe("Ollama FIM request", () => {
  test("sends native FIM input and converts streamed output to SSE", async () => {
    const calls: unknown[] = []
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        calls.push(await request.json())
        const body = new ReadableStream<Uint8Array>({
          start(ctl) {
            ctl.enqueue(encoder.encode('{"response":"return '))
            ctl.enqueue(encoder.encode('value\\n"}\n{"done":true,"prompt_eval_count":7,"eval_count":2}\n'))
            ctl.close()
          },
        })
        return new Response(body)
      },
    })
    const response = await requestOllamaFim(`http://127.0.0.1:${server.port}/api/generate`, {
      model: "codestral:latest",
      prefix: "function answer() {\n  ",
      suffix: "\n}",
      maxTokens: 256,
      temperature: 0,
    })
    const text = await response.text()
    server.stop(true)

    expect(calls).toEqual([
      {
        model: "codestral:latest",
        prompt: "function answer() {\n  ",
        suffix: "\n}",
        options: { num_predict: 16, temperature: 0 },
        stream: true,
      },
    ])
    expect(text).toBe(
      'data: {"choices":[{"delta":{"content":"return value\\n"}}]}\n\ndata: {"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
    )
  })
})
