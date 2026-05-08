// kilocode_change - new file
import { Telemetry } from "@kilocode/kilo-telemetry"
import { SessionNetwork } from "@/session/network"
import type { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"

export type ReviewTelemetry = {
  mode: "review"
  feature: "code_reviews"
  command: "local-review" | "local-review-uncommitted"
}

export namespace KiloSessionProcessor {
  const log = Log.create({ service: "session.processor.kilo" })
  export const OUTPUT_LENGTH_WARNING = "The model hit its output limit, so this response may be incomplete."
  export const REASONING_LENGTH_WARNING =
    "The model hit its output limit while reasoning and produced no actionable output. Try disabling reasoning or increasing the output limit."
  export const PROVIDER_FINISH_ERROR_MESSAGE =
    "The provider ended the response with an error before returning details. Start a new message to retry; Kilo will compact the oversized conversation first if needed."

  export function reviewTelemetry(command: string): ReviewTelemetry | undefined {
    if (command === "local-review" || command === "local-review-uncommitted") {
      return { mode: "review", feature: "code_reviews", command }
    }
  }

  export function extractReviewTelemetry(parts: MessageV2.Part[]): ReviewTelemetry | undefined {
    for (const part of parts) {
      if (part.type !== "text") continue
      const meta: Record<string, unknown> | undefined = part.metadata
      if (!meta) continue
      if (meta.mode !== "review") continue
      if (meta.feature !== "code_reviews") continue
      const command = meta.command
      if (command !== "local-review" && command !== "local-review-uncommitted") continue
      return { mode: "review", feature: "code_reviews", command }
    }
  }

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
    telemetry?: ReviewTelemetry
  }) {
    const { tokens } = input
    if (tokens.input > 0 || tokens.output > 0 || tokens.cache.write > 0 || tokens.cache.read > 0) {
      Telemetry.trackLlmCompletion({
        taskId: input.sessionID,
        ...(input.telemetry ?? {}),
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

  /**
   * Returns the Kilo-specific retry policy options (limit + offline handler).
   * Designed to be spread into SessionRetry.policy() opts.
   *
   * The `abort` signal is used by the offline handler to cancel the network
   * reconnection wait when the session is interrupted.
   */
  export function retryOpts(input: {
    sessionID: SessionID
    abort: AbortSignal
    set: (sessionID: SessionID, status: SessionStatus.Info) => Effect.Effect<void>
  }) {
    return {
      limit: Flag.KILO_SESSION_RETRY_LIMIT,
      offline: (info: { error: unknown; message: string }) =>
        handleOffline({
          error: info.error,
          sessionID: input.sessionID,
          abort: input.abort,
          set: input.set,
        }),
    }
  }

  /**
   * Guard: if finish reason is "tool-calls" but no tool parts exist,
   * downgrade to "stop" to prevent an infinite loop (#7756).
   */
  export function guardEmptyToolCalls(msg: MessageV2.Assistant, parts: MessageV2.Part[]) {
    if (msg.finish === "tool-calls" && !parts.some((p) => p.type === "tool")) {
      log.warn("empty tool-calls", { messageID: msg.id })
      msg.finish = "stop"
    }
  }

  export function lengthWarning(input: {
    msg: MessageV2.Assistant
    step: { reasoning: boolean; text: boolean; tool: boolean }
  }) {
    if (input.msg.summary) return
    if (input.msg.finish !== "length") return
    if (input.step.reasoning && !input.step.text && !input.step.tool) {
      log.warn("reasoning-only length stop", { messageID: input.msg.id })
      return REASONING_LENGTH_WARNING
    }
    log.warn("length stop", { messageID: input.msg.id })
    return OUTPUT_LENGTH_WARNING
  }

  export function providerFinishError(msg: MessageV2.Assistant) {
    if (msg.finish !== "error") return false
    if (msg.error) return false
    const err = new MessageV2.APIError({
      message: PROVIDER_FINISH_ERROR_MESSAGE,
      isRetryable: true,
    }).toObject()
    msg.error = err
    log.warn("provider finish error", { messageID: msg.id })
    return err
  }
}
