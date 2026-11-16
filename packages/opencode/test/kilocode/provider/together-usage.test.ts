import { describe, expect, test } from "bun:test"
import { loadTogetherAI, withStreamUsage } from "@/kilocode/provider/together-usage"

type Captured = { url: string; body: Record<string, unknown> }

const sse = (usage: boolean) =>
  [
    `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}`,
    `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]${usage ? `,"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}` : ""}}`,
    "data: [DONE]",
    "",
  ].join("\n\n")

function capture() {
  const calls: Captured[] = []
  const fetchFn = async (input: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    // Mimic Together: usage only arrives when stream_options.include_usage is requested.
    const opts = calls.at(-1)!.body["stream_options"] as { include_usage?: boolean } | undefined
    return new Response(sse(opts?.include_usage === true), { headers: { "content-type": "text/event-stream" } })
  }
  return { calls, fetchFn }
}

describe("together streaming usage", () => {
  test("provider requests include_usage and surfaces token usage", async () => {
    const { calls, fetchFn } = capture()
    const create = await loadTogetherAI()
    const model = create({ apiKey: "k", fetch: fetchFn }).languageModel("zai-org/GLM-5.2")
    const result = await model.doStream({ prompt: [{ role: "user", content: [{ type: "text", text: "x" }] }] })
    const parts: Array<{
      type: string
      usage?: { inputTokens: { total?: number }; outputTokens: { total?: number } }
    }> = []
    for await (const part of result.stream as unknown as AsyncIterable<(typeof parts)[number]>) parts.push(part)
    expect(calls).toHaveLength(1)
    expect(calls[0].body["stream_options"]).toEqual({ include_usage: true })
    const finish = parts.find((p) => p.type === "finish")
    expect(finish?.usage?.inputTokens.total).toBe(11)
    expect(finish?.usage?.outputTokens.total).toBe(7)
  })

  test.each([
    ["non-streaming", { stream: false }, undefined],
    ["streaming", { stream: true }, { include_usage: true }],
    [
      "streaming with explicit opt-out",
      { stream: true, stream_options: { include_usage: false } },
      { include_usage: false },
    ],
    ["streaming with extra options", { stream: true, stream_options: { x: 1 } }, { x: 1, include_usage: true }],
  ])("withStreamUsage %s", async (_name, body, expected) => {
    const { calls, fetchFn } = capture()
    await withStreamUsage(fetchFn)("https://x/chat/completions", { body: JSON.stringify(body) })
    expect(calls[0].body["stream_options"]).toEqual(expected)
  })
})
