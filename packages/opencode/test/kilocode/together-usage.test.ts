import { describe, expect, test } from "bun:test"
import { createTogetherAI } from "@ai-sdk/togetherai"

const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "Hello" }] }]

const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

describe("Together AI streaming usage", () => {
  for (const route of ["provider", "chatModel", "languageModel"] as const) {
    test(`${route} requests and reads the final usage chunk`, async () => {
      const requests: Record<string, unknown>[] = []
      const provider = createTogetherAI({
        apiKey: "test-key",
        fetch: async (_url, init) => {
          if (typeof init?.body !== "string") throw new Error("Expected a JSON request body")
          const body = JSON.parse(init.body)
          requests.push(body)
          const stream =
            chunk({
              id: "test",
              model: "test",
              choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
            }) +
            chunk({ id: "test", model: "test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
            (body.stream_options?.include_usage
              ? chunk({
                  id: "test",
                  model: "test",
                  choices: [],
                  usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
                })
              : "") +
            "data: [DONE]\n\n"
          return new Response(stream, { headers: { "content-type": "text/event-stream" } })
        },
      })
      const model = route === "provider" ? provider("test") : provider[route]("test")
      const result = await model.doStream({ prompt })
      const parts = await Array.fromAsync(result.stream)
      expect(requests).toHaveLength(1)
      expect(requests[0]?.stream_options).toEqual({ include_usage: true })
      expect(parts.find((part) => part.type === "text-delta")).toMatchObject({ delta: "Hello" })
      expect(parts.find((part) => part.type === "finish")).toMatchObject({
        usage: { inputTokens: { total: 42 }, outputTokens: { total: 7 } },
      })
    })
  }

  test("non-streaming requests keep their existing usage handling", async () => {
    const requests: Record<string, unknown>[] = []
    const provider = createTogetherAI({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected a JSON request body")
        requests.push(JSON.parse(init.body))
        return Response.json({
          id: "test",
          model: "test",
          choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 },
        })
      },
    })
    const result = await provider("test").doGenerate({ prompt })
    expect(requests[0]?.stream_options).toBeUndefined()
    expect(result.usage.inputTokens.total).toBe(42)
    expect(result.usage.outputTokens.total).toBe(7)
  })
})
