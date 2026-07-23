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
})
