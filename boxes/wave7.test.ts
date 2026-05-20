/**
 * wave7.test.ts — Tests for atoms ported from gemini-cli, abtop, superset
 */
import { describe, test, expect } from "bun:test"

// ── gemini-cli ─────────────────────────────────────

import { delay, createAbortError } from "./delay"
import { TTLCache, createCache } from "./ttl-cache"
import { safeJsonStringify, safeLiteralReplace } from "./safe-json"
import { estimateTokens, contextWindowForModel, contextPct } from "./token-est"
import { DeadlineTimer } from "./deadline"

// ── abtop ──────────────────────────────────────────

import { redact, sanitizeTerminal } from "./redactor"
import { atomicWrite } from "./atomic-write"
import { sparkline, brailleGraph } from "./sparkline"

// ── superset ───────────────────────────────────────

import { CircuitBreaker } from "./circuit-breaker"
import { encodeFrame, FrameDecoder, decodeFrame } from "./binary-frame"
import { TypedEventBus } from "./typed-event"

// ── delay ──────────────────────────────────────────

describe("delay", () => {
  test("resolves after timeout", async () => {
    const start = Date.now()
    await delay(50)
    expect(Date.now() - start).toBeGreaterThanOrEqual(40)
  })

  test("rejects on abort", async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(delay(1000, ac.signal)).rejects.toThrow("Aborted")
  })

  test("createAbortError has correct name", () => {
    const e = createAbortError()
    expect(e.name).toBe("AbortError")
  })
})

// ── ttl-cache ──────────────────────────────────────

describe("ttl-cache", () => {
  test("getOrCreate caches value", () => {
    const c = new TTLCache<string, number>({ storage: "map" })
    let calls = 0
    const v = c.getOrCreate("k", () => { calls++; return 42 })
    expect(v).toBe(42)
    c.getOrCreate("k", () => { calls++; return 99 })
    expect(calls).toBe(1)
  })

  test("entries expire after TTL", async () => {
    const c = new TTLCache<string, number>({ storage: "map", defaultTtl: 50 })
    c.set("k", 1)
    expect(c.get("k")).toBe(1)
    await delay(60)
    expect(c.get("k")).toBeUndefined()
  })

  test("clear empties map storage", () => {
    const c = new TTLCache<string, number>({ storage: "map" })
    c.set("a", 1); c.set("b", 2)
    c.clear()
    expect(c.get("a")).toBeUndefined()
  })

  test("createCache factory", () => {
    const c = createCache<string, number>({ storage: "map" })
    c.set("x", 10)
    expect(c.get("x")).toBe(10)
  })
})

// ── safe-json ──────────────────────────────────────

describe("safe-json", () => {
  test("handles circular references", () => {
    const obj: any = { a: 1 }
    obj.self = obj
    const s = safeJsonStringify(obj)
    expect(s).toContain("[Circular]")
  })

  test("safeLiteralReplace escapes $", () => {
    expect(safeLiteralReplace("hello world", "world", "$&")).toBe("hello $&")
    expect(safeLiteralReplace("foo bar", "bar", "baz")).toBe("foo baz")
  })
})

// ── token-est ──────────────────────────────────────

describe("token-est", () => {
  test("ASCII text estimation", () => {
    const t = estimateTokens("hello world")
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThan(10)
  })

  test("CJK text gets higher token count", () => {
    const ascii = estimateTokens("aaaaa")
    const cjk = estimateTokens("가나다라마")
    expect(cjk).toBeGreaterThan(ascii)
  })

  test("contextWindowForModel returns known values", () => {
    expect(contextWindowForModel("claude-sonnet-4")).toBe(200_000)
    expect(contextWindowForModel("gpt-4o-mini")).toBe(128_000)
    expect(contextWindowForModel("gemini-2.5-pro")).toBe(1_000_000)
  })

  test("contextPct calculates percentage", () => {
    expect(contextPct(100_000, "claude-sonnet-4")).toBe(50)
    expect(contextPct(200_000, "claude-sonnet-4")).toBe(100)
  })
})

// ── deadline ───────────────────────────────────────

describe("deadline", () => {
  test("fires after timeout", async () => {
    const d = new DeadlineTimer(50)
    d.start()
    await delay(60)
    expect(d.isExpired).toBe(true)
  })

  test("pause and resume", async () => {
    const d = new DeadlineTimer(100)
    d.start()
    await delay(30)
    d.pause()
    expect(d.isExpired).toBe(false)
    d.resume()
    await delay(80)
    expect(d.isExpired).toBe(true)
  })

  test("extend adds time", async () => {
    const d = new DeadlineTimer(50)
    d.start()
    await delay(30)
    d.extend(50)
    await delay(30)
    expect(d.isExpired).toBe(false)
  })

  test("cancel prevents firing", async () => {
    const d = new DeadlineTimer(50)
    d.start()
    d.cancel()
    await delay(60)
    expect(d.isExpired).toBe(true)
  })
})

// ── redactor ───────────────────────────────────────

describe("redactor", () => {
  test("redacts API keys", () => {
    expect(redact("key=sk-ant-api12345")).toContain("[REDACTED]")
    expect(redact("token=ghp_abcdef end")).toContain("[REDACTED]")
    expect(redact("auth: Bearer sk-or-v1-xyz")).toContain("[REDACTED]")
  })

  test("preserves non-secret text", () => {
    expect(redact("hello world")).toBe("hello world")
  })

  test("sanitizeTerminal strips control chars", () => {
    expect(sanitizeTerminal("hello\x00world")).toBe("helloworld")
    expect(sanitizeTerminal("\u202Atext\u202E")).toBe("text")
  })
})

// ── sparkline ──────────────────────────────────────

describe("sparkline", () => {
  test("renders braille characters", () => {
    const result = sparkline([0, 0.5, 1], 3)
    expect(result.length).toBe(3)
    expect(result[0]).toBe(" ")
    expect(result[2]).toBe("⣼")
  })

  test("brailleGraph returns height rows", () => {
    const rows = brailleGraph([0.5, 0.5, 0.5, 0.5], 2, 3)
    expect(rows.length).toBe(3)
    expect(rows[0].length).toBe(2)
  })
})

// ── circuit-breaker ────────────────────────────────

describe("circuit-breaker", () => {
  test("starts closed and allows execution", () => {
    const cb = new CircuitBreaker()
    expect(cb.canExecute).toBe(true)
    expect(cb.currentState).toBe("closed")
  })

  test("opens after max failures", () => {
    const cb = new CircuitBreaker({ maxFailures: 3 })
    cb.failure(); cb.failure(); cb.failure()
    expect(cb.currentState).toBe("open")
    expect(cb.canExecute).toBe(false)
  })

  test("recovers after reset timeout", async () => {
    const cb = new CircuitBreaker({ maxFailures: 2, resetTimeout: 50 })
    cb.failure(); cb.failure()
    expect(cb.currentState).toBe("open")
    await delay(60)
    expect(cb.canExecute).toBe(true)
    expect(cb.currentState).toBe("half-open")
  })

  test("exec wraps with protection", async () => {
    const cb = new CircuitBreaker({ maxFailures: 2 })
    const result = await cb.exec(async () => 42)
    expect(result).toBe(42)
    expect(cb.failureCount).toBe(0)
  })

  test("exec records failure on throw", async () => {
    const cb = new CircuitBreaker({ maxFailures: 2 })
    await expect(cb.exec(async () => { throw new Error("boom") })).rejects.toThrow()
    expect(cb.failureCount).toBe(1)
  })
})

// ── binary-frame ───────────────────────────────────

describe("binary-frame", () => {
  test("encode + decode roundtrip", () => {
    const buf = encodeFrame({ type: "hello", num: 42 })
    const frame = decodeFrame(buf)
    expect(frame.message).toEqual({ type: "hello", num: 42 })
    expect(frame.payload).toBeNull()
  })

  test("frame with binary payload", () => {
    const payload = new Uint8Array([1, 2, 3])
    const buf = encodeFrame({ cmd: "write" }, payload)
    const frame = decodeFrame(buf)
    expect(frame.message).toEqual({ cmd: "write" })
    expect(frame.payload).toEqual(new Uint8Array([1, 2, 3]))
  })

  test("FrameDecoder streaming", () => {
    const dec = new FrameDecoder()
    const buf = encodeFrame({ a: 1 })
    dec.push(buf)
    const frames = dec.drain()
    expect(frames.length).toBe(1)
    expect(frames[0].message).toEqual({ a: 1 })
  })

  test("FrameDecoder partial accumulation", () => {
    const dec = new FrameDecoder()
    const buf = encodeFrame({ b: 2 })
    dec.push(buf.subarray(0, 4))
    expect(dec.drain().length).toBe(0)
    dec.push(buf.subarray(4))
    const frames = dec.drain()
    expect(frames.length).toBe(1)
    expect(frames[0].message).toEqual({ b: 2 })
  })
})

// ── typed-event ────────────────────────────────────

describe("typed-event", () => {
  test("on + emit", () => {
    const bus = new TypedEventBus<{ ping: number }>()
    let received = 0
    bus.on("ping", (n) => { received = n })
    bus.emit("ping", 42)
    expect(received).toBe(42)
  })

  test("on returns unsubscribe", () => {
    const bus = new TypedEventBus<{ click: void }>()
    let count = 0
    const unsub = bus.on("click", () => { count++ })
    bus.emit("click", undefined)
    unsub()
    bus.emit("click", undefined)
    expect(count).toBe(1)
  })

  test("once fires only once", () => {
    const bus = new TypedEventBus<{ data: string }>()
    let result = ""
    bus.once("data", (s) => { result = s })
    bus.emit("data", "first")
    bus.emit("data", "second")
    expect(result).toBe("first")
    expect(bus.listenerCount("data")).toBe(0)
  })

  test("listenerCount", () => {
    const bus = new TypedEventBus<{ x: void }>()
    expect(bus.listenerCount("x")).toBe(0)
    const u1 = bus.on("x", () => {})
    const u2 = bus.on("x", () => {})
    expect(bus.listenerCount("x")).toBe(2)
    u1()
    expect(bus.listenerCount("x")).toBe(1)
    bus.removeAll("x")
    expect(bus.listenerCount("x")).toBe(0)
  })
})
