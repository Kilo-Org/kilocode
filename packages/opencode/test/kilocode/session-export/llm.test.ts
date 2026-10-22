import { describe, expect, test } from "bun:test"
import { normalizeUsageForExport, observeFullStreamForExport } from "@/session/llm"

describe("session export llm usage", () => {
  test("handles providers that omit token detail fields", () => {
    expect(normalizeUsageForExport({ inputTokens: 3, outputTokens: 5 })).toEqual({
      inputTokens: 3,
      outputTokens: 5,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    })
  })

  test("finalizes export when stream is closed early", async () => {
    const calls: unknown[] = []
    async function* stream() {
      yield { type: "text-delta", id: "1", text: "hello" } as const
      yield { type: "text-delta", id: "1", text: "later" } as const
    }
    const observed = observeFullStreamForExport(
      stream(),
      { sessionId: "s1", rootSessionId: "s1", requestId: "r1", started: Date.now(), retries: 0 },
      (event) => calls.push(event),
    )[Symbol.asyncIterator]()

    await observed.next()
    await observed.return?.()

    expect(calls.length).toBe(1)
    expect(JSON.stringify(calls[0])).toContain("stream_cancelled")
  })
})
