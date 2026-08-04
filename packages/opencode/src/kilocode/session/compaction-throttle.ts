import { Clock, Duration, Effect, Ref, Semaphore } from "effect"
import type { KiloSessionProcessor } from "./processor"
import type { SessionRetry } from "@/session/retry"
import { isRecord } from "@/util/record"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "kilocode.compaction.throttle" })

type State = {
  slow: boolean
  next: number
}

export namespace KiloCompactionThrottle {
  export type Control = {
    gate: KiloSessionProcessor.Gate
    retry: KiloSessionProcessor.RetryHook
  }

  function text(error: SessionRetry.Err, key: string) {
    if (!isRecord(error.data)) return ""
    const value = error.data[key]
    return typeof value === "string" ? value : ""
  }

  export function pressure(input: Pick<KiloSessionProcessor.Retry, "error" | "message">) {
    const error = input.error
    if (!error) return false
    if (!isRecord(error.data)) return false
    if (error.data.statusCode === 429) return true

    const message = input.message.toLowerCase()
    if (
      message.includes("rate increased too quickly") ||
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message === "provider is overloaded"
    )
      return true

    const structured =
      /"(?:code|type)"\s*:\s*"[^"]*(?:too_many_requests|rate_limit|resource_exhausted|overloaded|unavailable)[^"]*"/i
    return structured.test(message) || structured.test(text(error, "responseBody"))
  }

  /**
   * Keep the normal three-request fan-out until the provider reports pressure.
   * Attempts admitted while pressure is false are considered in flight and may
   * finish; every later attempt and retry re-enters the shared serial gate for
   * the remainder of this compaction.
   */
  export const make = Effect.fn("KiloCompactionThrottle.make")(function* () {
    const state = yield* Ref.make<State>({ slow: false, next: 0 })
    const lock = Semaphore.makeUnsafe(1)

    const gate: KiloSessionProcessor.Gate = (effect) =>
      Ref.get(state).pipe(
        Effect.flatMap((current) => {
          if (!current.slow) return effect
          return lock.withPermits(1)(
            Effect.gen(function* () {
              while (true) {
                const latest = yield* Ref.get(state)
                const now = yield* Clock.currentTimeMillis
                const wait = latest.next - now
                if (wait <= 0) break
                yield* Effect.sleep(Duration.millis(wait))
              }
              return yield* effect
            }),
          )
        }),
      )

    const retry: KiloSessionProcessor.RetryHook = (input) => {
      if (!input.error || !pressure(input)) return Effect.void
      const error = input.error
      return Effect.gen(function* () {
        yield* Ref.update(state, (current) => ({
          slow: true,
          next: Math.max(current.next, input.next),
        }))
        log.warn("provider pressure detected; serializing remaining compaction requests", {
          next: input.next,
          message: text(error, "message"),
        })
      })
    }

    return { gate, retry }
  })
}
