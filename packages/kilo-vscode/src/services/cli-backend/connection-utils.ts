import type { GlobalEvent } from "@kilocode/sdk/v2/client"

export type SSEPayload = GlobalEvent["payload"]
type SyncPayload = Extract<SSEPayload, { type: "sync" }>
type TransientPayload = Exclude<SSEPayload, SyncPayload>

/**
 * Pure session ID resolution for SSE events.
 * The lookupMessageSessionId callback remains part of the public resolver contract for
 * transient events that may only carry a message ID, and onMessageUpdated records the
 * messageID -> sessionID mapping from versioned message updates.
 */
export function resolveEventSessionId(
  event: SSEPayload,
  lookupMessageSessionId: (messageId: string) => string | undefined,
  onMessageUpdated?: (messageId: string, sessionId: string) => void,
): string | undefined {
  if (event.type === "sync") {
    return resolveSyncSessionId(event, onMessageUpdated)
  }

  void lookupMessageSessionId
  if (event.type === "sandbox.status.changed") return event.properties.sessionID
  return resolveTransientSessionId(event)
}

function resolveSyncSessionId(
  event: SyncPayload,
  onMessageUpdated?: (messageId: string, sessionId: string) => void,
): string | undefined {
  if (event.name === "message.updated.1") {
    onMessageUpdated?.(event.data.info.id, event.data.sessionID)
  }
  return event.data.sessionID
}

function resolveTransientSessionId(event: TransientPayload): string | undefined {
  switch (event.type) {
    case "session.status":
    case "session.turn.open":
    case "session.turn.close":
    case "session.idle":
    case "session.error":
    case "todo.updated":
    case "message.part.delta":
    case "permission.asked":
    case "permission.replied":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
    case "suggestion.shown":
    case "suggestion.accepted":
    case "suggestion.dismissed":
    case "session.network.asked":
    case "session.network.replied":
    case "session.network.rejected":
    case "session.network.restored":
      return event.properties.sessionID
    default:
      return undefined
  }
}
