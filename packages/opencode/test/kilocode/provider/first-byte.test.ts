import { describe, expect, test } from "bun:test"
import { requestTimeout, wrapFirstByte, REQUEST_TIMEOUT_MS } from "../../../src/kilocode/provider/provider"
import { ProviderError } from "../../../src/provider/error"

const sse = (body: BodyInit | null) =>
  new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 })

// A body that delivers `head` immediately, then stays silent forever.
const stalling = (head?: string) =>
  new ReadableStream<Uint8Array>({
    start(ctrl) {
      if (head) ctrl.enqueue(new TextEncoder().encode(head))
    },
  })

const drain = async (res: Response) => {
  const reader = res.body!.getReader()
  const out: string[] = []
  while (true) {
    const part = await reader.read()
    if (part.done) return out.join("")
    out.push(new TextDecoder().decode(part.value))
  }
}

describe("requestTimeout", () => {
  test("defaults to the shared request timeout", () => {
    expect(requestTimeout({})).toBe(REQUEST_TIMEOUT_MS)
  })

  test("honours an explicit value, disables only on false, and bounds invalid input", () => {
    expect(requestTimeout({ timeout: 1234 })).toBe(1234)
    expect(requestTimeout({ timeout: false })).toBeUndefined()
    // invalid/unset values fall back to the default so the wait is always bounded
    expect(requestTimeout({ timeout: 0 })).toBe(REQUEST_TIMEOUT_MS)
    expect(requestTimeout({ timeout: -1 })).toBe(REQUEST_TIMEOUT_MS)
    expect(requestTimeout({ timeout: "nope" })).toBe(REQUEST_TIMEOUT_MS)
    expect(requestTimeout({ timeout: null })).toBe(REQUEST_TIMEOUT_MS)
  })
})

describe("wrapFirstByte", () => {
  test("fails when the body never produces a byte", async () => {
    const ctl = new AbortController()
    const res = wrapFirstByte(sse(stalling()), 100, ctl)

    await expect(drain(res)).rejects.toBeInstanceOf(ProviderError.ResponseStreamError)
    expect(ctl.signal.aborted).toBe(true)
    expect((ctl.signal.reason as Error).message).toContain("no response data within 100ms")
  })

  test("stays a passthrough once the first byte arrived, even if the stream then stalls", async () => {
    const ctl = new AbortController()
    const res = wrapFirstByte(sse(stalling("data: hello\n\n")), 100, ctl)
    const reader = res.body!.getReader()

    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe("data: hello\n\n")

    // the guard must not arm again: idle gaps mid-stream stay opt-in (chunkTimeout)
    const next = await Promise.race([
      reader.read().then(() => "chunk"),
      new Promise((resolve) => setTimeout(() => resolve("still-waiting"), 300)),
    ])
    expect(next).toBe("still-waiting")
    expect(ctl.signal.aborted).toBe(false)
    await reader.cancel("done")
  })

  test("passes a complete body through untouched", async () => {
    const ctl = new AbortController()
    const res = wrapFirstByte(sse("data: one\n\ndata: two\n\n"), 1_000, ctl)
    expect(await drain(res)).toBe("data: one\n\ndata: two\n\n")
    expect(ctl.signal.aborted).toBe(false)
  })

  test("is a no-op without a body or when disabled", () => {
    const ctl = new AbortController()
    const empty = new Response(null, { status: 204 })
    expect(wrapFirstByte(empty, 100, ctl)).toBe(empty)
    const res = sse("data: x\n\n")
    expect(wrapFirstByte(res, 0, ctl)).toBe(res)
  })
})
