import { describe, expect, test } from "bun:test"
import { looksLikeContentEvent, resolveSseFirstTokenMs, SSE_FIRST_TOKEN_MS, wrapSSEFirstContent } from "@/kilocode/provider/provider"
import { ProviderError } from "@/provider/error"

describe("kilocode.provider.resolveSseFirstTokenMs", () => {
  test("returns a positive finite timeout as-is", () => {
    expect(resolveSseFirstTokenMs({ timeout: 90_000 })).toBe(90_000)
  })

  test("falls back to a positive finite provider timeout", () => {
    expect(resolveSseFirstTokenMs({ timeout: "90_000" }, { timeout: 30_000 })).toBe(30_000)
  })

  test("maps false to the default", () => {
    expect(resolveSseFirstTokenMs({ timeout: false })).toBe(SSE_FIRST_TOKEN_MS)
  })

  test("maps 0 to the default", () => {
    expect(resolveSseFirstTokenMs({ timeout: 0 })).toBe(SSE_FIRST_TOKEN_MS)
  })

  test("maps negative / non-finite / invalid to the default", () => {
    expect(resolveSseFirstTokenMs({ timeout: -1 })).toBe(SSE_FIRST_TOKEN_MS)
    expect(resolveSseFirstTokenMs({ timeout: Number.POSITIVE_INFINITY })).toBe(SSE_FIRST_TOKEN_MS)
    expect(resolveSseFirstTokenMs({ timeout: Number.NaN })).toBe(SSE_FIRST_TOKEN_MS)
    expect(resolveSseFirstTokenMs({ timeout: "x" })).toBe(SSE_FIRST_TOKEN_MS)
    expect(resolveSseFirstTokenMs({})).toBe(SSE_FIRST_TOKEN_MS)
  })
})

describe("kilocode.provider.looksLikeContentEvent", () => {
  test("returns false + full carry when no event boundary is present", () => {
    const text = 'data: {"choices":[{"delta":{"content":"incomplete'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe(text)
  })

  test("role-only delta is not content", () => {
    const text = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe("")
  })

  test("empty delta is not content", () => {
    const text = 'data: {"choices":[{"delta":{}}]}\n\n'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe("")
  })

  test(":heartbeat comment is not content", () => {
    const text = ":heartbeat\n\n"
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe("")
  })

  test("data: [DONE] is not content", () => {
    const text = "data: [DONE]\n\n"
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe("")
  })

  test("content delta is content", () => {
    const text = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(true)
    expect(result.carry).toBe("")
  })

  test("reasoning_content delta is content", () => {
    const text = 'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(true)
    expect(result.carry).toBe("")
  })

  test("tool_calls delta is content", () => {
    const text = 'data: {"choices":[{"delta":{"tool_calls":[{"id":"1"}]}}]}\n\n'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(true)
    expect(result.carry).toBe("")
  })

  test("content event split across two reads is detected once the boundary arrives", () => {
    const head = 'data: {"choices":[{"delta":{"content":"h'
    const tail = 'i"}}]}\n\n'

    const r1 = looksLikeContentEvent(head)
    expect(r1.found).toBe(false)

    const r2 = looksLikeContentEvent(r1.carry + tail)
    expect(r2.found).toBe(true)
  })

  test("keeps only the trailing fragment after a complete non-content event (buffer trimming)", () => {
    const text =
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"con'
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe('data: {"choices":[{"delta":{"con')
  })

  test("drops many complete heartbeats and keeps only the trailing fragment (Repair B)", () => {
    const text = Array.from({ length: 20 }, (_, i) => `:heartbeat${i}`).join("\n\n") + "\n\n:incomplete"
    const result = looksLikeContentEvent(text)
    expect(result.found).toBe(false)
    expect(result.carry).toBe(":incomplete")
  })
})

describe("kilocode.provider.wrapSSEFirstContent", () => {
  test("returns the original response when chunkTimeout is not positive", () => {
    const res = new Response("body")
    expect(wrapSSEFirstContent(res, 0, new AbortController(), 60_000)).toBe(res)
  })

  test("returns the original response when there is no body", () => {
    const res = new Response(null, { headers: { "content-type": "text/event-stream" } })
    expect(wrapSSEFirstContent(res, 50, new AbortController(), 60_000)).toBe(res)
  })

  test("returns the original response when content-type is not SSE", () => {
    const res = new Response(new ReadableStream(), { headers: { "content-type": "application/json" } })
    expect(wrapSSEFirstContent(res, 50, new AbortController(), 60_000)).toBe(res)
  })

  test("enqueues original bytes untouched and uses pre-content budget until first content", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        // Feed a non-content event first, then a content event.
        ctrl.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'))
        ctrl.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'))
        ctrl.close()
      },
    })
    const res = new Response(stream, { headers: { "content-type": "text/event-stream" } })
    const ctl = new AbortController()
    const wrapped = wrapSSEFirstContent(res, 1_000, ctl, 1_000)
    const reader = wrapped.body!.getReader()
    const chunks: string[] = []
    let done = false
    while (!done) {
      const { value, done: d } = await reader.read()
      done = d
      if (value) chunks.push(new TextDecoder().decode(value))
    }
    expect(chunks.join("")).toContain('"role":"assistant"')
    expect(chunks.join("")).toContain('"content":"ok"')
    expect(ctl.signal.aborted).toBe(false)
  })

  test("aborts a stalled pre-content SSE stream within firstTokenMs", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start() {
        // Never enqueues — simulates a headers-only SSE connection.
      },
    })
    const res = new Response(stream, { headers: { "content-type": "text/event-stream" } })
    const ctl = new AbortController()
    const wrapped = wrapSSEFirstContent(res, 60_000, ctl, 50)
    const reader = wrapped.body!.getReader()
    await expect(reader.read()).rejects.toBeInstanceOf(ProviderError.ResponseStreamError)
  })
})
