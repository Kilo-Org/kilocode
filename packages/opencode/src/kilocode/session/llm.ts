import type { LanguageModelV2StreamPart } from "@ai-sdk/provider"
import * as Stream from "effect/Stream"
import { ProviderError } from "@/provider/error"
import type { LLMEvent } from "@opencode-ai/llm"
import type { ModelMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { KiloSessionOverflow } from "./overflow"

const SAFETY = 2048
const MIN_OUTPUT = 1024
const DEFAULT_CHUNK_IDLE_MS = 60_000

type FullStreamPart = LanguageModelV2StreamPart

export namespace KiloLLM {
  // Stream failures and interruptions propagate while text deltas are collected.
  export function text(stream: Stream.Stream<LLMEvent, unknown>) {
    return stream.pipe(
      Stream.map((event) => (event.type === "text-delta" ? event.text : "")),
      Stream.mkString,
    )
  }

  /**
   * Resolves the configured chunk idle timeout in milliseconds, or `undefined`
   * when the watchdog should be disabled.
   *
   * Precedence:
   *  1. prepared `options.chunkTimeout`
   *  2. provider `fallback.chunkTimeout`
   *  3. DEFAULT_CHUNK_IDLE_MS
   *
   * Rules:
   *  - positive finite number wins.
   *  - public `false` or internal `0` disables (returns undefined).
   *  - invalid prepared values (non-number, negative, non-finite, strings, ...)
   *    fall through to the provider fallback. The same rules apply at every
   *    layer.
   */
  export function resolveIdleMs(input: {
    options: Record<string, unknown>
    fallback?: Record<string, unknown>
  }): number | undefined {
    const prepared = resolve(input.options["chunkTimeout"])
    if (prepared.disabled) return undefined
    if (prepared.value !== undefined) return prepared.value
    const fallback = resolve(input.fallback?.["chunkTimeout"])
    if (fallback.disabled) return undefined
    if (fallback.value !== undefined) return fallback.value
    return DEFAULT_CHUNK_IDLE_MS
  }

  // Tri-state: `disabled` means "explicitly off"; `value` is a usable ms count.
  // `null`/`undefined`/invalid numeric values are treated as not-configured.
  function resolve(value: unknown): { value: number | undefined; disabled: boolean } {
    if (value === false || value === 0) return { value: undefined, disabled: true }
    if (value == null) return { value: undefined, disabled: false }
    if (typeof value !== "number") return { value: undefined, disabled: false }
    if (!Number.isFinite(value)) return { value: undefined, disabled: false }
    if (value <= 0) return { value: undefined, disabled: false }
    return { value, disabled: false }
  }

  /**
   * Wraps an AI SDK `fullStream` with a Kilo-owned per-event idle watchdog.
   *
   * Behavior:
   *  - `idleMs === undefined` returns the stream unchanged (disabled).
   *  - every raw AI SDK event resets the idle timer.
   *  - non-provider-executed `tool-call` adds an active tool id; matching
   *    `tool-result` / `tool-error` removes it. While any local tool id is
   *    active, the watchdog is suspended (long-running tool work is not a
   *    stall).
   *  - provider-executed `tool-call` does not suspend the watchdog and no id
   *    is tracked — those are settled server-side and a missing result is a
   *    real stall.
   *  - parallel local tool calls remain suspended until the last one settles.
   *  - the wrapper fails the stream with `ProviderError.ResponseStreamError`
   *    on stall. Existing `MessageV2` retry mapping handles that error.
   *
   * The wrapper is implemented against `AsyncIterable` so it composes with
   * any stream the AI SDK exposes, including its native `fullStream`. The
   * outer `Stream` is rebuilt from the wrapped iterable, which keeps the
   * contract simple: one pull = one raw event.
   */
  export function watchdogStream(
    stream: Stream.Stream<FullStreamPart, unknown>,
    idleMs: number | undefined,
    abort?: AbortController,
  ): Stream.Stream<FullStreamPart, unknown> {
    if (idleMs === undefined) return stream
    const source = Stream.toAsyncIterable(stream)
    return Stream.fromAsyncIterable(watchdogAsyncIterable(source, idleMs, abort), (e) =>
      e instanceof Error ? e : new Error(String(e)),
    )
  }

  /**
   * Wraps an `AsyncIterable` of raw AI SDK `fullStream` parts with the same
   * Kilo-owned per-event idle watchdog. Use this when the upstream is already
   * an `AsyncIterable` (e.g. the AI SDK's `fullStream`) so we avoid a
   * Stream → AsyncIterable → Stream round-trip.
   */
  export function watchdogAsyncIterable(
    source: AsyncIterable<FullStreamPart>,
    idleMs: number | undefined,
    abort?: AbortController,
  ): AsyncIterable<FullStreamPart> {
    if (idleMs === undefined) return source
    return { [Symbol.asyncIterator]: () => watchIterator(source, idleMs, abort) }
  }

  /**
   * Implemented as a hand-rolled `AsyncIterator` rather than an `async
   * function*` generator. An async generator's `.return()` cannot preempt an
   * in-flight internal `await`: per spec, when the generator is suspended
   * mid-`await` (as opposed to suspended at a `yield`), a `.return()` call
   * only takes effect once that `await` settles on its own. When the source
   * is genuinely stalled — the exact case this watchdog exists to catch —
   * that `await` never settles, so a caller that wants to cancel promptly
   * (e.g. Effect interrupting the consuming Stream) would hang forever
   * waiting for cleanup instead. A plain iterator object's `return()` runs
   * immediately and forwards to the underlying source's `return()` without
   * waiting on any outstanding pull, matching how interruption already
   * behaves for the unwrapped upstream iterator.
   */
  function watchIterator(
    source: AsyncIterable<FullStreamPart>,
    idleMs: number,
    abort?: AbortController,
  ): AsyncIterator<FullStreamPart> {
    const local = new Set<string>()
    const iter = source[Symbol.asyncIterator]()
    let suspended = false
    let closed = false
    return {
      async next(): Promise<IteratorResult<FullStreamPart>> {
        if (closed) return { done: true, value: undefined }
        try {
          // Decide BEFORE pulling whether the next event is allowed to take as
          // long as upstream needs. Local tool work in flight must not be timed
          // out — the AI SDK only emits a tool-result / tool-error once the
          // client-side tool has actually finished.
          const pull = suspended ? iter.next() : raceWithTimeout(iter.next(), idleMs, abort)
          const value = await pull
          suspended = false
          if (value.done) {
            closed = true
            await safeClose(iter)
            return value
          }
          const part = value.value
          trackPart(local, part)
          suspended = local.size > 0
          return { done: false, value: part }
        } catch (e) {
          closed = true
          await safeClose(iter)
          throw e
        }
      },
      async return(value?: unknown): Promise<IteratorResult<FullStreamPart>> {
        if (!closed) {
          closed = true
          await safeClose(iter)
        }
        return { done: true, value: value as FullStreamPart }
      },
    }
  }

  function trackPart(local: Set<string>, part: FullStreamPart) {
    if (!part || typeof part !== "object") return
    const t = (part as { type?: unknown }).type
    if (t === "tool-call") {
      const call = part as unknown as {
        toolCallId?: unknown
        providerExecuted?: unknown
      }
      if (call.providerExecuted === true) return
      if (typeof call.toolCallId !== "string") return
      local.add(call.toolCallId)
      return
    }
    if (t === "tool-result" || t === "tool-error") {
      const call = part as unknown as { toolCallId?: unknown }
      if (typeof call.toolCallId !== "string") return
      local.delete(call.toolCallId)
    }
  }

  function raceWithTimeout<T>(promise: Promise<T>, ms: number, abort?: AbortController): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new ProviderError.ResponseStreamError(`AI SDK stream stalled: no event for ${ms}ms`)
        if (abort && !abort.signal.aborted) {
          abort.abort(err)
        }
        reject(err)
      }, ms)
      promise.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        },
      )
    })
  }

  async function safeClose<T>(iter: AsyncIterator<T>) {
    if (typeof iter.return === "function") await iter.return()
  }

  export function needsEstimate(input: { model: Provider.Model; configured: number | undefined }) {
    return input.configured !== undefined && input.configured > 0 && input.model.limit.context > 0
  }

  /**
   * Caps `maxOutputTokens` to fit within the model's context window after
   * accounting for the context the outgoing request will consume.
   *
   * Like opencode, the provider is the source of truth: when the last finished
   * turn reported usage, `reported` carries that provider-tokenized context size
   * (input + output + cache), which already accounts for image/vision input the
   * client cannot see. The client-side media-normalized estimate (encoded bytes
   * excluded) is used as a floor so newly added text or tool schemas still cap
   * output, and as the sole basis on the first turn before any usage is reported.
   * The larger of the two is used so the cap never under-counts.
   *
   * Many small models (e.g. qwen 7B, 32K context) ship with a default
   * max_output of 32K, leaving no room for input once tools are included.
   * This prevents the provider from rejecting the request with a context
   * overflow error.
   */
  export function capOutputTokens(input: {
    model: Provider.Model
    messages: ModelMessage[]
    tools: Record<string, { description?: string; inputSchema?: unknown }>
    configured: number | undefined
    usage?: ReturnType<typeof KiloSessionOverflow.measure>
    reported?: number
  }): number | undefined {
    if (input.configured == null) return input.configured
    if (input.configured <= 0) return undefined
    const { context } = input.model.limit
    if (!context) return input.configured

    const estimated =
      input.usage?.normalized ??
      KiloSessionOverflow.measure({ messages: input.messages, tools: input.tools }).normalized
    const tokens = Math.max(input.reported ?? 0, estimated)
    const available = context - tokens - SAFETY
    // If available is ≤0 the input alone exceeds context — return the original
    // value so the provider returns a natural overflow error which triggers
    // compaction (compactionAttempts guard stops the loop eventually).
    if (available <= 0) return input.configured
    if (available >= input.configured) return input.configured
    return Math.max(MIN_OUTPUT, available)
  }
}
