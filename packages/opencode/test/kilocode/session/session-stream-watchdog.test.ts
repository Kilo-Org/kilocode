import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import type { LanguageModelV2CallWarning, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { KiloLLM } from "@/kilocode/session/llm"
import { ProviderError } from "@/provider/error"

type FullStreamPart = LanguageModelV2StreamPart

function part(type: string, extra: Record<string, unknown> = {}): FullStreamPart {
  return { type, ...extra } as unknown as FullStreamPart
}

async function run<T>(eff: Effect.Effect<T, unknown>) {
  return await Effect.runPromise(eff)
}

function fromSchedule(events: Array<[number, FullStreamPart]>, end: number): Stream.Stream<FullStreamPart, never> {
  // Each `[at, value]` is an ABSOLUTE time in milliseconds from stream start.
  // This matches how the tests are written: post-tool events (finish-step,
  // finish) are scheduled within a short idle window of the tool-result so
  // the watchdog, after the local active set drains, still receives the next
  // event in time.
  return Stream.fromAsyncIterable(
    (async function* () {
      const start = Date.now()
      for (const [at, value] of events) {
        const wait = at - (Date.now() - start)
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        yield value
      }
      await new Promise((r) => setTimeout(r, end))
    })(),
    (e) => e as never,
  )
}

// kilocode_change: raw AsyncIterable version of `fromSchedule` for tests that
// exercise `watchdogAsyncIterable` directly. The production consumer in
// `src/session/llm.ts` wraps the AI SDK's native `fullStream` AsyncIterable
// and uses `watchdogAsyncIterable`, not `watchdogStream`, so the direct-unit
// AC1/AC3 tests target that same entry point. A hand-rolled AsyncIterable is
// also used because its `return()` settles promptly on cleanup (the
// async-generator `return()`-mid-await semantics are described in the AC3
// test comment).
function iterableFromSchedule(
  events: Array<[number, FullStreamPart]>,
  end: number,
): AsyncIterable<FullStreamPart> {
  return (async function* () {
    const start = Date.now()
    for (const [at, value] of events) {
      const wait = at - (Date.now() - start)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      yield value
    }
    await new Promise((r) => setTimeout(r, end))
  })()
}

describe("kilocode.session.llm.resolveIdleMs", () => {
  test("returns prepared positive finite value as-is", () => {
    const out = KiloLLM.resolveIdleMs({ options: { chunkTimeout: 15_000 }, fallback: { chunkTimeout: 30_000 } })
    expect(out).toBe(15_000)
  })

  test("falls back to provider value when prepared is missing", () => {
    const out = KiloLLM.resolveIdleMs({ options: {}, fallback: { chunkTimeout: 30_000 } })
    expect(out).toBe(30_000)
  })

  test("falls back to provider value when prepared is a non-number string", () => {
    const out = KiloLLM.resolveIdleMs({
      options: { chunkTimeout: "15_000" },
      fallback: { chunkTimeout: 30_000 },
    })
    expect(out).toBe(30_000)
  })

  test("falls back to provider value when prepared is negative", () => {
    const out = KiloLLM.resolveIdleMs({
      options: { chunkTimeout: -1 },
      fallback: { chunkTimeout: 30_000 },
    })
    expect(out).toBe(30_000)
  })

  test("falls back to provider value when prepared is non-finite (Infinity, NaN)", () => {
    expect(
      KiloLLM.resolveIdleMs({ options: { chunkTimeout: Number.POSITIVE_INFINITY }, fallback: { chunkTimeout: 5_000 } }),
    ).toBe(5_000)
    expect(KiloLLM.resolveIdleMs({ options: { chunkTimeout: Number.NaN }, fallback: { chunkTimeout: 5_000 } })).toBe(
      5_000,
    )
  })

  test("treats boolean false as a request to disable the watchdog", () => {
    expect(
      KiloLLM.resolveIdleMs({ options: { chunkTimeout: false }, fallback: { chunkTimeout: 30_000 } }),
    ).toBeUndefined()
  })

  test("treats internal 0 as a request to disable the watchdog", () => {
    expect(KiloLLM.resolveIdleMs({ options: { chunkTimeout: 0 }, fallback: { chunkTimeout: 30_000 } })).toBeUndefined()
  })

  test("provider fallback false also disables", () => {
    expect(KiloLLM.resolveIdleMs({ options: {}, fallback: { chunkTimeout: false } })).toBeUndefined()
  })

  test("uses 60_000 default when nothing valid is configured", () => {
    expect(KiloLLM.resolveIdleMs({ options: {} })).toBe(60_000)
  })

  test("uses 60_000 default when both prepared and fallback are invalid", () => {
    expect(
      KiloLLM.resolveIdleMs({
        options: { chunkTimeout: "x" },
        fallback: { chunkTimeout: -5 },
      }),
    ).toBe(60_000)
  })
})

// kilocode_change: resolveFirstTokenMs is the new S2 helper for the
// pre-content (time-to-first-content) budget. Unlike resolveIdleMs it
// NEVER returns undefined: the pre-content bound is disabled only when
// the whole watchdog is disabled (idleMs === undefined at the entry
// point). unset / false / 0 / invalid / non-finite / negative MUST map
// to DEFAULT_FIRST_TOKEN_MS — leaving a never-first-content hang
// unbounded when `timeout` is configured as "off" would re-introduce a
// worse version of #12467 (silent infinite hang instead of a 60s false
// positive).
describe("kilocode.session.llm.resolveFirstTokenMs", () => {
  test("returns prepared positive finite value as-is", () => {
    const out = KiloLLM.resolveFirstTokenMs({
      options: { timeout: 90_000 },
      fallback: { timeout: 30_000 },
    })
    expect(out).toBe(90_000)
  })

  test("falls back to provider value when prepared is missing", () => {
    const out = KiloLLM.resolveFirstTokenMs({ options: {}, fallback: { timeout: 30_000 } })
    expect(out).toBe(30_000)
  })

  test("falls back to provider value when prepared is a non-number string", () => {
    const out = KiloLLM.resolveFirstTokenMs({
      options: { timeout: "90_000" },
      fallback: { timeout: 30_000 },
    })
    expect(out).toBe(30_000)
  })

  test("falls back to provider value when prepared is negative", () => {
    const out = KiloLLM.resolveFirstTokenMs({
      options: { timeout: -1 },
      fallback: { timeout: 30_000 },
    })
    expect(out).toBe(30_000)
  })

  test("falls back to provider value when prepared is non-finite (Infinity, NaN)", () => {
    expect(
      KiloLLM.resolveFirstTokenMs({
        options: { timeout: Number.POSITIVE_INFINITY },
        fallback: { timeout: 5_000 },
      }),
    ).toBe(5_000)
    expect(
      KiloLLM.resolveFirstTokenMs({ options: { timeout: Number.NaN }, fallback: { timeout: 5_000 } }),
    ).toBe(5_000)
  })

  // Crucial divergence from resolveIdleMs: boolean false must NOT disable
  // the pre-content bound — it falls back / uses the Kilo default instead.
  test("treats boolean false as not-configured (falls back, does NOT disable)", () => {
    expect(
      KiloLLM.resolveFirstTokenMs({ options: { timeout: false }, fallback: { timeout: 30_000 } }),
    ).toBe(30_000)
    expect(KiloLLM.resolveFirstTokenMs({ options: { timeout: false } })).toBe(300_000)
  })

  test("treats internal 0 as not-configured (falls back, does NOT disable)", () => {
    expect(
      KiloLLM.resolveFirstTokenMs({ options: { timeout: 0 }, fallback: { timeout: 30_000 } }),
    ).toBe(30_000)
    expect(KiloLLM.resolveFirstTokenMs({ options: { timeout: 0 } })).toBe(300_000)
  })

  test("uses 300_000 default when nothing valid is configured", () => {
    expect(KiloLLM.resolveFirstTokenMs({ options: {} })).toBe(300_000)
  })

  test("uses 300_000 default when both prepared and fallback are invalid", () => {
    expect(
      KiloLLM.resolveFirstTokenMs({
        options: { timeout: "x" },
        fallback: { timeout: -5 },
      }),
    ).toBe(300_000)
  })
})

describe("kilocode.session.llm.watchdogStream", () => {
  test("returns the stream unchanged when idle is undefined (disabled)", async () => {
    const events: FullStreamPart[] = [
      part("stream-start", { warnings: [] as LanguageModelV2CallWarning[] }),
      part("text-delta", { id: "t1", delta: "ok" }),
    ]
    const out = await run(Stream.runCollect(KiloLLM.watchdogStream(Stream.fromIterable(events), undefined)))
    expect(out.length).toBe(2)
  })

  test("emits events and completes when the stream delivers them within the idle window", async () => {
    const events: FullStreamPart[] = [
      part("stream-start", { warnings: [] as LanguageModelV2CallWarning[] }),
      part("text-delta", { id: "t1", delta: "hi" }),
      part("text-delta", { id: "t1", delta: "!" }),
    ]
    const out = await run(Stream.runCollect(KiloLLM.watchdogStream(Stream.fromIterable(events), 1_000)))
    expect(out.length).toBe(3)
  })

  test("fails with ProviderError.ResponseStreamError when the stream stalls", async () => {
    const slow = Stream.fromEffect(
      Effect.flatMap(Effect.sleep("5 seconds"), () => Effect.succeed(part("text-delta", { id: "t1", delta: "x" }))),
    )
    const wrapped = KiloLLM.watchdogStream(slow, 100)
    const err = await run(Effect.flip(Stream.runCollect(wrapped)))
    expect(err).toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("every raw AI SDK event resets the idle timer", async () => {
    // idle 200ms; emit text-delta at 0 and 60ms (a single 260ms pull would time out without reset).
    const stream = fromSchedule(
      [
        [0, part("text-delta", { id: "t1", delta: "a" })],
        [60, part("text-delta", { id: "t1", delta: "b" })],
      ],
      10,
    )
    const out = await run(Stream.runCollect(KiloLLM.watchdogStream(stream, 200)))
    expect(out.length).toBe(2)
  })

  test("AC2: mid-response stall after first content is still aborted", async () => {
    // A content part at t=0, then a long quiet gap that exceeds the idle window.
    const stream = fromSchedule([[0, part("text-delta", { id: "t1", delta: "hi" })]], 400)
    const err = await run(Effect.flip(Stream.runCollect(KiloLLM.watchdogStream(stream, 200))))
    expect(err).toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("pending local tool calls suspend the idle timeout until they settle", async () => {
    // tool-call at t=0 (local). 250ms quiet gap then tool-result. A healthy AI
    // SDK run also emits finish-step + finish right after the tool-result, so
    // the watchdog sees another event within idleMs and resets.
    const stream = fromSchedule(
      [
        [0, part("tool-call", { toolCallId: "c1", toolName: "bash" })],
        [250, part("tool-result", { toolCallId: "c1", toolName: "bash", output: "ok" })],
        [260, part("finish-step", { finishReason: "tool-calls" })],
        [270, part("finish", { finishReason: "stop" })],
      ],
      10,
    )
    const out = await run(Stream.runCollect(KiloLLM.watchdogStream(stream, 200)))
    expect(out.length).toBe(4)
  })

  test("provider-executed tool calls do not suspend the watchdog", async () => {
    const stream = fromSchedule(
      [[0, part("tool-call", { toolCallId: "c1", toolName: "web", providerExecuted: true })]],
      400,
    )
    const err = await run(Effect.flip(Stream.runCollect(KiloLLM.watchdogStream(stream, 200))))
    expect(err).toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("parallel local tool calls remain suspended until the last settles", async () => {
    const stream = fromSchedule(
      [
        [0, part("tool-call", { toolCallId: "a", toolName: "bash" })],
        [10, part("tool-call", { toolCallId: "b", toolName: "bash" })],
        [200, part("tool-result", { toolCallId: "a", toolName: "bash", output: "x" })],
        [350, part("tool-result", { toolCallId: "b", toolName: "bash", output: "y" })],
        [360, part("finish-step", { finishReason: "tool-calls" })],
        [370, part("finish", { finishReason: "stop" })],
      ],
      10,
    )
    const out = await run(Stream.runCollect(KiloLLM.watchdogStream(stream, 200)))
    expect(out.length).toBe(6)
  })

  test("tool-error for a local tool id also releases the suspension", async () => {
    const stream = fromSchedule(
      [
        [0, part("tool-call", { toolCallId: "c1", toolName: "bash" })],
        [200, part("tool-error", { toolCallId: "c1", toolName: "bash", error: new Error("nope") })],
        [210, part("finish-step", { finishReason: "tool-calls" })],
        [220, part("finish", { finishReason: "stop" })],
      ],
      10,
    )
    const out = await run(Stream.runCollect(KiloLLM.watchdogStream(stream, 200)))
    expect(out.length).toBe(4)
  })

  test("aborts the underlying source on timeout so cleanup does not hang", async () => {
    const ctrl = new AbortController()
    let abortReason: unknown
    let nextResolved = false
    const source: AsyncIterable<FullStreamPart> = {
      [Symbol.asyncIterator]() {
        let nextPromise: Promise<IteratorResult<FullStreamPart>> | undefined
        let resolveNext: ((value: IteratorResult<FullStreamPart>) => void) | undefined
        ctrl.signal.addEventListener("abort", () => {
          abortReason = ctrl.signal.reason
          if (resolveNext) {
            resolveNext({ done: true, value: undefined })
            nextResolved = true
          }
        })
        return {
          next() {
            nextPromise = new Promise((resolve) => {
              resolveNext = resolve
            })
            return nextPromise
          },
          async return() {
            if (nextPromise) await nextPromise
            return { done: true, value: undefined }
          },
        }
      },
    }
    const wrapped = KiloLLM.watchdogAsyncIterable(source, 100, ctrl)
    const err = await run(Effect.flip(Stream.runCollect(Stream.fromAsyncIterable(wrapped, (e) => e as never))))
    expect(err).toBeInstanceOf(ProviderError.ResponseStreamError)
    expect(nextResolved).toBe(true)
    expect(abortReason).toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("propagates upstream stream errors without false timeout", async () => {
    const stream = Stream.fail(new Error("upstream broken"))
    const err = await run(Effect.flip(Stream.runCollect(KiloLLM.watchdogStream(stream, 1_000))))
    expect((err as Error).message).toBe("upstream broken")
  })

  test("return() closes the source immediately without waiting on a stalled pull", async () => {
    // Regression test: a hand-rolled async generator's `.return()` cannot
    // preempt an in-flight internal `await` — it only takes effect once that
    // await settles on its own, which never happens for a genuinely stalled
    // source. `watchdogAsyncIterable` must instead expose a `return()` that
    // runs immediately and forwards to the source's `return()` without
    // waiting for the outstanding `next()` to resolve.
    let sourceReturnCalled = false
    let neverResolvingNextCalled = false
    const source: AsyncIterable<FullStreamPart> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            neverResolvingNextCalled = true
            return new Promise<IteratorResult<FullStreamPart>>(() => {
              // Never resolves — simulates a fully stalled source (e.g. a
              // hung fetch response) whose pending pull is abandoned once
              // the consumer decides to stop.
            })
          },
          async return() {
            sourceReturnCalled = true
            return { done: true, value: undefined }
          },
        }
      },
    }
    const wrapped = KiloLLM.watchdogAsyncIterable(source, 60_000)
    const it = wrapped[Symbol.asyncIterator]()
    const pending = it.next()
    expect(neverResolvingNextCalled).toBe(true)

    const returned = await Promise.race([
      it.return!(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("return() hung")), 500)),
    ])
    expect(returned).toMatchObject({ done: true })
    expect(sourceReturnCalled).toBe(true)
    // The abandoned pull is left unresolved; only return() is asserted here.
    void pending
  })

  // kilocode_change: AC1 (parameterised) — slow time-to-first-content is
  // bounded by `firstTokenMs`, not `idleMs`. The first content part
  // (`text-delta`) is delayed 300ms, which is past the 100ms `idleMs` but
  // within the 1000ms `firstTokenMs` (the request-timeout budget). Without
  // the fix the per-event idle would fire at t≈100ms and abort a healthy
  // slow stream (issue #12467). With the fix the pre-content phase is
  // bounded by the larger `firstTokenMs` and the stream completes.
  //
  // Uses `watchdogAsyncIterable` directly (with a raw AsyncIterable) to match
  // the production call site (`session/llm.ts`), which wraps the AI SDK's
  // native `fullStream` AsyncIterable. `watchdogStream` would round-trip
  // through `Stream.toAsyncIterable`, which blocks the event loop on long
  // stalls and prevents the watchdog's setTimeout from firing.
  test("AC1 (parameterised): slow time-to-first-content completes when firstTokenMs > idleMs", async () => {
    // Synthetic structural parts arrive instantly (mirroring the AI SDK's
    // t+2ms synthetic `start`); the first content part is gated 300ms.
    const source = iterableFromSchedule(
      [
        [0, part("stream-start", { warnings: [] as LanguageModelV2CallWarning[] })],
        [0, part("start-step", { request: {}, warnings: [] as LanguageModelV2CallWarning[] })],
        [0, part("text-start", { id: "t1", providerMetadata: undefined })],
        [300, part("text-delta", { id: "t1", delta: "hi", providerMetadata: undefined })],
        [310, part("text-delta", { id: "t1", delta: "!", providerMetadata: undefined })],
        [320, part("finish-step", { finishReason: "stop", usage: undefined, providerMetadata: undefined })],
        [330, part("finish", { finishReason: "stop", usage: undefined, providerMetadata: undefined })],
      ],
      10,
    )
    const wrapped = KiloLLM.watchdogAsyncIterable(source, 100, undefined, 1_000)
    const out = await run(
      Stream.runCollect(Stream.fromAsyncIterable(wrapped, (e) => (e instanceof Error ? e : new Error(String(e))))),
    )
    // 7 raw events must be collected end-to-end — the 300ms wait for the
    // first content part exceeds idleMs=100 but is well under
    // firstTokenMs=1000, so the watchdog must NOT abort.
    expect(out.length).toBe(7)
  })

  // kilocode_change: AC3 — a never-first-content hang is bounded by
  // `firstTokenMs` (the request-timeout budget), not by the post-content
  // `idleMs`. The schedule emits ONLY structural parts and then hangs; the
  // watchdog must fire at ~firstTokenMs (500ms), not at the much-larger
  // `idleMs` (5000ms) and not at the Kilo default (300s). This is the
  // primary direct-unit guard that a `timeout: false` / unset config
  // still gets a finite bound on time-to-first-content, since the
  // provider's own request `timeout` signal is cleared once response
  // headers arrive.
  //
  // Uses a hand-rolled `AsyncIterable` rather than an async generator
  // because the watchdog's catch path calls `safeClose(source.return())`
  // to clean up the source. On a hand-rolled generator that's suspended
  // mid-`setTimeout`, `return()` blocks until the pending `next()`
  // settles (per the async-generator spec), so the timeout would not
  // appear to fire until the source's setTimeout elapsed. A custom
  // `AsyncIterable` whose `return()` resolves immediately matches the
  // behavior of the AI SDK's native `fullStream` consumer in production
  // and is the same pattern used in the existing "aborts the underlying
  // source" test in this file.
  test("AC3: never-first-content hang is bounded by firstTokenMs, not idleMs", async () => {
    // Yield 3 structural parts instantly, then hang.
    const parts: FullStreamPart[] = [
      part("stream-start", { warnings: [] as LanguageModelV2CallWarning[] }),
      part("start-step", { request: {}, warnings: [] as LanguageModelV2CallWarning[] }),
      part("text-start", { id: "t1", providerMetadata: undefined }),
    ]
    let index = 0
    let resolveHanging: ((v: IteratorResult<FullStreamPart>) => void) | undefined
    const source: AsyncIterable<FullStreamPart> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (index < parts.length) {
              return Promise.resolve({ done: false, value: parts[index++]! })
            }
            return new Promise<IteratorResult<FullStreamPart>>((resolve) => {
              resolveHanging = resolve
            })
          },
          return() {
            if (resolveHanging) resolveHanging({ done: true, value: undefined })
            return Promise.resolve({ done: true, value: undefined })
          },
        }
      },
    }

    const start = Date.now()
    const wrapped = KiloLLM.watchdogAsyncIterable(source, 5_000, undefined, 500)
    const err = await run(
      Effect.flip(
        Stream.runCollect(
          Stream.fromAsyncIterable(wrapped, (e) => (e instanceof Error ? e : new Error(String(e)))),
        ),
      ),
    )
    const elapsed = Date.now() - start
    expect(err).toBeInstanceOf(ProviderError.ResponseStreamError)
    // Must abort at ~firstTokenMs (500ms), not at ~idleMs (5000ms). The
    // lower bound allows for setTimeout drift; the upper bound is well
    // below any reasonable post-content idle window.
    expect(elapsed).toBeGreaterThanOrEqual(400)
    expect(elapsed).toBeLessThan(2_000)
  })
})
