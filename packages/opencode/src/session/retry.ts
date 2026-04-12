import type { NamedError } from "@opencode-ai/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { isKiloError } from "@/kilocode/kilo-errors" // kilocode_change
import { SessionNetwork } from "./network" // kilocode_change
import { iife } from "@/util/iife"

export namespace SessionRetry {
  export type Err = ReturnType<NamedError["toObject"]>

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

  export function retryable(error: Err) {
    // context overflow errors should not be retried
    if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
    if (MessageV2.APIError.isInstance(error)) {
      // kilocode_change start - Current Kilo errors require user action (login/signup), don't retry
      if (isKiloError(error)) return undefined
      // kilocode_change end
      if (!error.data.isRetryable) return undefined
      // kilocode_change start - FreeUsageLimitError is not retryable: retrying the same
      // capped model is futile and the backoff loop cannot be broken by switching
      // models in the chat selector (the retry loop holds a stale model ref).
      if (error.data.responseBody?.includes("FreeUsageLimitError")) return undefined
      // kilocode_change end
      return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
    }

    const json = iife(() => {
      try {
        if (typeof error.data?.message === "string") {
          const parsed = JSON.parse(error.data.message)
          return parsed
        }

        return JSON.parse(error.data.message)
      } catch {
        return undefined
      }
    })
    if (!json || typeof json !== "object") return undefined
    const code = typeof json.code === "string" ? json.code : ""

    if (json.type === "error" && json.error?.type === "too_many_requests") {
      return "Too Many Requests"
    }
    if (code.includes("exhausted") || code.includes("unavailable")) {
      return "Provider is overloaded"
    }
    if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
      return "Rate Limited"
    }
    return undefined
  }

  export function policy(opts: {
    parse: (error: unknown) => Err
    set: (input: { attempt: number; message: string; next: number }) => Effect.Effect<void>
    // kilocode_change start
    limit?: number
    offline?: (input: { error: unknown; message: string }) => Effect.Effect<"retry" | "blocked" | "aborted">
    // kilocode_change end
  }) {
    return Schedule.fromStepWithMetadata(
      Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
        // kilocode_change start — enforce retry limit
        if (opts.limit !== undefined && meta.attempt > opts.limit) {
          return Cause.done(meta.attempt)
        }
        // kilocode_change end

        const error = opts.parse(meta.input)
        const message = retryable(error)
        if (!message) return Cause.done(meta.attempt)
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
          yield* opts.set({ attempt: meta.attempt, message, next: now + wait })
          return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
        })
      }),
    )
  }
}
