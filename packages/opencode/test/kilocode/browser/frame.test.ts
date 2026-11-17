import { describe, expect, test } from "bun:test"
import { FrameError, HostLimit, PeerLimit, decoder, encode, write } from "../../../src/kilocode/browser/frame"

function collect(limit = PeerLimit) {
  const frames: unknown[] = []
  const errors: FrameError[] = []
  const frames$ = decoder({
    limit,
    onFrame: (value) => frames.push(value),
    onError: (error) => errors.push(error),
  })
  return { frames, errors, feed: (chunk: Uint8Array) => frames$.push(chunk), dead: () => frames$.dead }
}

describe("native messaging framing", () => {
  test("encodes a little-endian length followed by UTF-8 JSON", () => {
    const frame = encode({ hello: "world" })
    const body = JSON.stringify({ hello: "world" })
    expect(frame.readUInt32LE(0)).toBe(Buffer.byteLength(body))
    expect(frame.subarray(4).toString("utf8")).toBe(body)
  })

  test("refuses to encode a frame over the limit", () => {
    expect(() => encode({ text: "x".repeat(64) }, 16)).toThrow(FrameError)
  })

  test("decodes one frame split across many chunks", () => {
    const view = collect()
    const frame = encode({ type: "ping", value: 1 })
    for (const byte of frame) view.feed(Buffer.from([byte]))
    expect(view.frames).toStrictEqual([{ type: "ping", value: 1 }])
    expect(view.errors).toHaveLength(0)
  })

  test("decodes a header split after three bytes", () => {
    const view = collect()
    const frame = encode({ a: true })
    view.feed(frame.subarray(0, 3))
    expect(view.frames).toHaveLength(0)
    view.feed(frame.subarray(3))
    expect(view.frames).toStrictEqual([{ a: true }])
  })

  test("decodes coalesced frames from one chunk", () => {
    const view = collect()
    view.feed(Buffer.concat([encode({ n: 1 }), encode({ n: 2 }), encode({ n: 3 })]))
    expect(view.frames).toStrictEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
  })

  test("decodes a payload that arrives in small pieces", () => {
    const view = collect()
    const frame = encode({ text: "y".repeat(300_000) })
    for (let offset = 0; offset < frame.length; offset += 4_096) view.feed(frame.subarray(offset, offset + 4_096))
    expect(view.frames).toHaveLength(1)
    expect(view.frames[0]).toStrictEqual({ text: "y".repeat(300_000) })
  })

  test("reports a declared length over the limit and stops", () => {
    const view = collect(1_024)
    const header = Buffer.alloc(4)
    header.writeUInt32LE(2_000, 0)
    view.feed(header)
    expect(view.errors).toHaveLength(1)
    expect(view.errors[0]?.kind).toBe("too_large")
    expect(view.dead()).toBe(true)
    view.feed(encode({ ignored: true }))
    expect(view.frames).toHaveLength(0)
  })

  test("reports invalid JSON", () => {
    const view = collect()
    const body = Buffer.from("{", "utf8")
    const frame = Buffer.alloc(4 + body.length)
    frame.writeUInt32LE(body.length, 0)
    body.copy(frame, 4)
    view.feed(frame)
    expect(view.errors).toHaveLength(1)
    expect(view.errors[0]?.kind).toBe("bad_json")
  })

  test("keeps host frames under one megabyte", () => {
    expect(HostLimit).toBeLessThan(1024 * 1024)
    expect(PeerLimit).toBeGreaterThan(HostLimit)
  })

  test("decodes a frame that arrives one byte at a time without unbounded parts", () => {
    const view = collect()
    const frame = encode({ text: "z".repeat(5_000) })
    for (const byte of frame) view.feed(Buffer.from([byte]))
    expect(view.errors).toHaveLength(0)
    expect(view.frames).toStrictEqual([{ text: "z".repeat(5_000) }])
  })

  test("reports a frame it cannot serialize instead of throwing", () => {
    const written: Buffer[] = []
    const stream = {
      write(chunk: Buffer) {
        written.push(chunk)
        return true
      },
    } as unknown as NodeJS.WritableStream
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(write(stream, circular)).toBe(false)
    expect(write(stream, { text: "x".repeat(64) }, 16)).toBe(false)
    expect(written).toHaveLength(0)
  })

  test("treats a backpressured write as delivered", () => {
    const stream = {
      write() {
        return false
      },
    } as unknown as NodeJS.WritableStream
    expect(write(stream, { ok: true })).toBe(true)
  })

  test("reports a dead stream", () => {
    const stream = {
      write() {
        throw new Error("EPIPE")
      },
    } as unknown as NodeJS.WritableStream
    expect(write(stream, { ok: true })).toBe(false)
  })
})
