import type { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { isKiloError } from "@/kilocode/kilo-errors" // kilocode_change
import { SessionNetwork } from "./network" // kilocode_change
import { iife } from "@/util/iife"
import { isRecord } from "@/util/record"

export type Err = ReturnType<NamedError["toObject"]>

export type RetryReason = string & {} // kilocode_change - Kilo does not support OpenCode Go upsell reasons

export type Retryable = {
  message: string
  action?: {
    reason: RetryReason
    provider: string
    title: string
    message: string
    label: string
    link?: string
  }
}

export const RETRY_INITIAL_DELAY = 2000
export const RETRY_BACKOFF_FACTOR = 2
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000 // 30 seconds
export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          return cap(parsedMs)
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          // convert seconds to milliseconds
          return cap(Math.ceil(parsedSeconds * 1000))
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return cap(Math.ceil(parsed))
        }
      }

      return cap(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1))
    }
  }

  return cap(Math.min(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1), RETRY_MAX_DELAY_NO_HEADERS))
}

// kilocode_change - Kilo does not emit OpenCode Go actions
export function retryable(error: Err, _provider?: string): Retryable | undefined {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // kilocode_change start - Current Kilo errors require user action (login/signup), don't retry
    if (isKiloError(error)) return undefined
    // kilocode_change end

    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined

    // kilocode_change start - Kilo does not support OpenCode Go upsells. FreeUsageLimitError is not retryable: retrying
    // the same capped model is futile and the backoff loop cannot be broken by switching models in the chat selector
    // because the retry loop holds a stale model ref.
    if (error.data.responseBody?.includes("FreeUsageLimitError")) return undefined
    // kilocode_change end
    return { message: error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message }
  }

  // Check for rate limit patterns in plain text error messages
  const msg = isRecord(error.data) ? error.data.message : undefined
  if (typeof msg === "string") {
    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return { message: msg }
    }
  }

  const json = parseJSON(msg)
  if (!json || typeof json !== "object") return undefined
  const code = typeof json.code === "string" ? json.code : ""

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return { message: "Too Many Requests" }
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return { message: "Provider is overloaded" }
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return { message: "Rate Limited" }
  }
  return undefined
}

function parseJSON(value: unknown) {
  return iife(() => {
    try {
      if (typeof value !== "string") return undefined
      return JSON.parse(value)
    } catch {
      return undefined
    }
  })
}

export function policy(opts: {
  provider: string
  parse: (error: unknown) => Err
  set: (input: { attempt: number; message: string; action?: Retryable["action"]; next: number }) => Effect.Effect<void>
  // kilocode_change start
  limit?: number
  allow?: (error: unknown) => boolean | undefined
  offline?: (input: { error: unknown; message: string }) => Effect.Effect<"retry" | "blocked" | "aborted">
  // kilocode_change end
}) {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      // kilocode_change start — enforce retry limit
      const allowed = opts.allow?.(meta.input)
      if (allowed === false || (allowed !== true && opts.limit !== undefined && meta.attempt > opts.limit)) {
        return Cause.done(meta.attempt)
      }
      // kilocode_change end

      const error = opts.parse(meta.input)
      const retry = retryable(error, opts.provider)
      if (!retry) return Cause.done(meta.attempt)
      return Effect.gen(function* () {
        // kilocode_change start — handle network disconnect via offline handler
        if (opts.offline && SessionNetwork.disconnected(meta.input)) {
          const result = yield* opts.offline({
            error: meta.input,
            message: SessionNetwork.message(meta.input),
          })
          if (result !== "retry") {
            return yield* Cause.done(meta.attempt)
          }
          yield* opts.set({ attempt: 0, message: "Reconnected", next: Date.now() })
          return [0, Duration.zero] as [number, Duration.Duration]
        }
        // kilocode_change end

        const wait = delay(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
        const now = yield* Clock.currentTimeMillis
        yield* opts.set({
          attempt: meta.attempt,
          message: retry.message,
          action: retry.action,
          next: now + wait,
        })
        return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
      })
    }),
  )
}

export * as SessionRetry from "./retry"
