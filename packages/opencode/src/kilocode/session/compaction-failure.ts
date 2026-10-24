import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "@/session/message-v2"

/**
 * Classifies compaction summaries that must not replace the conversation and
 * builds actionable error messages for them.
 *
 * A summary that the provider blocked (finish reason "content-filter", which
 * providers also use for model refusals) may still carry partial text such as
 * a refusal sentence. Accepting it would cut the history at a summary that does
 * not describe the conversation, so it fails like an empty summary instead.
 */
export namespace KiloCompactionFailure {
  const ADVICE =
    'choose a different compaction model in Settings > Models > Compaction model (or set "agent.compaction.model" in kilo.json)'

  export const EMPTY_SUMMARY = `Compaction did not run: the model returned an empty summary. Your conversation history was kept. Retry with /compact. If it keeps failing, ${ADVICE}, or start a new session to continue.`

  export function filtered(model: Pick<Provider.Model, "providerID" | "id">) {
    return new SessionV1.ContentFilterError({
      message: `Compaction was blocked by the provider's content filter (${model.providerID}/${model.id}). Your conversation history was kept. To continue, ${ADVICE} and retry with /compact, or start a new session.`,
    }).toObject()
  }

  export function empty() {
    return new SessionV1.APIError({ message: EMPTY_SUMMARY, isRetryable: true }).toObject()
  }

  /** Returns the error for a summary that finished without a usable result. */
  export function inspect(input: {
    message: MessageV2.Assistant
    parts: MessageV2.Part[]
    model: Pick<Provider.Model, "providerID" | "id">
  }) {
    if (input.message.finish === "content-filter") return filtered(input.model)
    if (input.parts.some((part) => part.type === "text" && part.text.trim().length > 0)) return
    return empty()
  }

  /** Errors raised by compaction itself; the processor never publishes these. */
  export function owned(error: NonNullable<MessageV2.Assistant["error"]>) {
    if (error.name === "ContentFilterError") return true
    return error.name === "APIError" && error.data.message === EMPTY_SUMMARY
  }

  /**
   * Marks a failed summary as finished so the failed compaction request is not
   * picked up again as a pending task before the user's next prompt. The error
   * keeps it from becoming a compaction boundary.
   */
  export function settle(msg: MessageV2.Assistant, error: NonNullable<MessageV2.Assistant["error"]>) {
    msg.error = error
    msg.finish = msg.finish === "content-filter" ? msg.finish : "error"
    msg.time.completed ??= Date.now()
    return msg
  }
}
