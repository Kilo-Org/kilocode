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
    /** Drops a request that no longer applies, such as a failed switch or an agent change that decides the model. */
    clear(sessionID: string) {
      requested.delete(sessionID)
    },
    read(sessionID: string, current: ModelRef | undefined): ModelRef | undefined {
      const next = requested.get(sessionID)
      if (!next) return current
      if (current?.id === next.id && current.providerID === next.providerID) {
        requested.delete(sessionID)
        return current
      }
      return next
    },
  }
}