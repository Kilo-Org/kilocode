import type { ModelRef } from "@opencode/client"

/**
 * The model a prompt of a session runs on. An explicit switch is not in the store yet when the prompt that waited
 * for it is admitted, so the requested value wins until the store reports it. Requests are keyed by session, so a
 * different session can never name a prompt.
 */
export function createModelAttribution() {
  const requested = new Map<string, ModelRef>()
  return {
    request(sessionID: string, model: ModelRef) {
      requested.set(sessionID, model)
    },
    /**
     * Drops a request that no longer applies, such as a failed switch or an agent change that decides the model.
     * Pass the failed model to keep a newer request that is still pending for the same session.
     */
    clear(sessionID: string, model?: ModelRef) {
      if (model && requested.get(sessionID) !== model) return
      requested.delete(sessionID)
    },
    read(sessionID: string, current: ModelRef | undefined): ModelRef | undefined {
      const next = requested.get(sessionID)
      if (!next) return current
      // A variant-only switch keeps the model, so the store reports it only when the variant matches too.
      if (
        current?.id === next.id &&
        current.providerID === next.providerID &&
        (current.variant ?? "default") === (next.variant ?? "default")
      ) {
        requested.delete(sessionID)
        return current
      }
      return next
    },
  }
}
