// kilocode_change - new file
import { Telemetry } from "@kilocode/kilo-telemetry"
import { SessionNetwork } from "@/session/network"
import type { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import { Log } from "@/util/log"
import { Effect } from "effect"

export namespace KiloSessionProcessor {
  const log = Log.create({ service: "session.processor.kilo" })

  /**
   * Track LLM completion telemetry for a finished step.
   * Only fires if at least one token bucket is non-zero.
   */
  export function trackStep(input: {
    sessionID: string
    model: { providerID: string; id: string }
    tokens: { input: number; output: number; cache: { read: number; write: number } }
    cost: number
    elapsed: number
  }) {
    const { tokens } = input
    if (tokens.input > 0 || tokens.output > 0 || tokens.cache.write > 0 || tokens.cache.read > 0) {
      Telemetry.trackLlmCompletion({
        taskId: input.sessionID,
        apiProvider: input.model.providerID,
        modelId: input.model.id,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        cacheReadTokens: tokens.cache.read,
        cacheWriteTokens: tokens.cache.write,
        cost: input.cost,
        completionTime: input.elapsed,
      })
    }
  }

  /**
   * Effect-based offline handler for the retry schedule.
   * Shows offline status, waits for network reconnection or user rejection.
   *
   * Returns:
   * - "retry"   → network restored, retry immediately
   * - "blocked" → user rejected reconnection
   * - "aborted" → abort signal fired
   */
  export function handleOffline(input: {
    error: unknown
    sessionID: SessionID
    abort: AbortSignal
    set: (sessionID: SessionID, status: SessionStatus.Info) => Effect.Effect<void>
  }): Effect.Effect<"retry" | "blocked" | "aborted"> {
    return Effect.gen(function* () {
      const msg = SessionNetwork.message(input.error)

      const { id, promise } = yield* Effect.promise(() =>
        SessionNetwork.ask({
          sessionID: input.sessionID,
          message: msg,
          abort: input.abort,
        }),
      )

      log.warn("session offline", {
        sessionID: input.sessionID,
        requestID: id,
        message: msg,
      })

      yield* input.set(input.sessionID, {
        type: "offline",
        requestID: id,
        message: msg,
      })

      return yield* Effect.promise(() =>
        promise
          .then(() => "retry" as const)
          .catch((err) => {
            if (err instanceof SessionNetwork.RejectedError) return "blocked" as const
            if (err instanceof DOMException && err.name === "AbortError") return "aborted" as const
            throw err
          }),
      )
    })
  }
}
