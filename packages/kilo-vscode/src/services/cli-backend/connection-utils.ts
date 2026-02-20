import type { SSEEvent } from "./types"

/**
 * Pure session ID resolution for SSE events.
 * The lookupMessageSessionId callback is used for message.part.updated fallback lookup,
 * and onMessageUpdated is called when message.updated is encountered so the caller can
 * record the messageID -> sessionID mapping.
 */
export function resolveEventSessionId(
  event: SSEEvent,
  lookupMessageSessionId: (messageId: string) => string | undefined,
  onMessageUpdated?: (messageId: string, sessionId: string) => void,
): string | undefined {
  switch (event.type) {
    case "session.created":
    case "session.updated":
      return event.properties.info.id
    case "session.status":
    case "session.idle":
    case "todo.updated":
      return event.properties.sessionID
    case "message.updated":
      onMessageUpdated?.(event.properties.info.id, event.properties.info.sessionID)
      return event.properties.info.sessionID
    case "message.part.updated": {
      const part = event.properties.part as { messageID?: string; sessionID?: string }
      if (part.sessionID) {
        return part.sessionID
      }
      if (!part.messageID) {
        return undefined
      }
      return lookupMessageSessionId(part.messageID)
    }
    case "permission.asked":
    case "permission.replied":
    case "question.asked":
    case "question.replied":
    case "question.rejected":
      return event.properties.sessionID
    default:
      return undefined
  }
}
