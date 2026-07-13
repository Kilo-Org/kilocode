// kilocode_change - new file
import { Telemetry, type ReviewCommand } from "@kilocode/kilo-telemetry"
import { SessionNetwork } from "@/session/network"
import type { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import { MessageV2 } from "@/session/message-v2"
import type { ProviderID } from "@/provider/schema"
import { isRecord } from "@/util/record"
import { parseReviewCommand, reviewCommandName } from "@/kilocode/review/command"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { EffectBridge } from "@/effect/bridge"

export type ReviewTelemetry = {
  mode: "review"
  feature: "code_reviews"
  command: ReviewCommand
  tool?: "suggest"
}

export namespace KiloSessionProcessor {
  const log = Log.create({ service: "session.processor.kilo" })
  export const MISSING_FINISH_RETRIES = 3
  export const MISSING_FINISH_MESSAGE = "Response ended without a finish reason and may be incomplete."
  export class MissingFinishError extends Error {
    constructor() {
      super(MISSING_FINISH_MESSAGE)
      this.name = "MissingFinishError"
    }
  }
  export const OUTPUT_LENGTH_WARNING = "The model hit its output limit, so this response may be incomplete."
  export const REASONING_LENGTH_WARNING =
    "The model hit its output limit while reasoning and produced no actionable output. Try disabling reasoning or increasing the output limit."
  export const PROVIDER_FINISH_ERROR_MESSAGE =
    "The provider ended the response with an error before returning details. Start a new message to retry; Kilo will compact the oversized conversation first if needed."

  export function reviewTelemetry(command: string | undefined): ReviewTelemetry | undefined {
    const cmd = reviewCommandName(command)
    if (!cmd) return
    return { mode: "review", feature: "code_reviews", command: cmd }
  }

  /**
   * Tag the text parts of a prompt with review telemetry metadata so that
   * downstream LLM completions in the same turn (including child sessions
   * spawned by subtask commands) are attributed to the originating review
   * command. No-op when the command is not a recognized review command.
   */
  export function markReviewTelemetry(
    parts: Array<{ type: string; metadata?: Record<string, unknown> }>,
    command: string | undefined,
  ): ReviewTelemetry | undefined {
    const tel = reviewTelemetry(command)
    if (!tel) return
    for (const part of parts) {
      if (part.type !== "text") continue
      part.metadata = { ...part.metadata, ...tel }
    }
    return tel
  }

  export function extractReviewTelemetry(parts: MessageV2.Part[]): ReviewTelemetry | undefined {
    for (const part of parts) {
      if (part.type !== "text") continue
      const meta: Record<string, unknown> | undefined = part.metadata
      if (!meta) continue
      if (meta.mode !== "review") continue
      if (meta.feature !== "code_reviews") continue
      const tel = reviewTelemetry(typeof meta.command === "string" ? meta.command : undefined)
      if (tel) return tel
    }
  }

  export function suggestionReviewTelemetry(metadata: unknown): ReviewTelemetry | undefined {
    if (!isRecord(metadata)) return
    if (!isRecord(metadata.accepted)) return
    const prompt = typeof metadata.accepted.prompt === "string" ? metadata.accepted.prompt : undefined
    const tel = reviewTelemetry(parseReviewCommand(prompt))
    if (!tel) return
    return { ...tel, tool: "suggest" }
  }

  export function extractSuggestionReviewTelemetry(parts: MessageV2.Part[]): ReviewTelemetry | undefined {
    for (const part of parts) {
      if (part.type !== "tool") continue
      if (part.tool !== "suggest") continue
      if (part.state.status !== "completed") continue
      const tel = suggestionReviewTelemetry(part.state.metadata)
      if (tel) return tel
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

      const { id, promise } = yield* EffectBridge.fromPromise(() =>
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
    let missing = 0
    return {
      limit: Flag.KILO_SESSION_RETRY_LIMIT,
      allow: (error: unknown) => {
        if (!(error instanceof MissingFinishError)) return
        missing++
        return missing <= MISSING_FINISH_RETRIES
      },
      offline: (info: { error: unknown; message: string }) =>
        handleOffline({
          error: info.error,
          sessionID: input.sessionID,
          abort: input.abort,
          set: input.set,
        }),
    }
  }

  export function ensureFinish(msg: MessageV2.Assistant) {
    if (msg.finish) return Effect.void
    msg.finish = "unknown"
    const visible = MessageV2.parts(msg.id).some(
      (part) => part.type === "text" || part.type === "reasoning" || part.type === "tool",
    )
    if (visible) return Effect.void
    return Effect.fail(new MissingFinishError())
  }

  export function parseError(error: unknown, input: { providerID: ProviderID; aborted: boolean }) {
    if (!(error instanceof MissingFinishError)) return MessageV2.fromError(error, input)
    return new MessageV2.APIError({
      message: error.message,
      isRetryable: true,
    }).toObject()
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
