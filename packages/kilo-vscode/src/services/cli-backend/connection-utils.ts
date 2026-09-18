import type { SSEPayload } from "./sdk-sse-adapter"

export type { SSEPayload } from "./sdk-sse-adapter"
type SyncPayload = Extract<SSEPayload, { type: "sync" }>
type TransientPayload = Exclude<SSEPayload, SyncPayload>

const duplicateSyncEvents = new Set([
  "message.updated.1",
  "message.removed.1",
  "message.part.updated.1",
  "message.part.removed.1",
  "session.created.1",
  "session.deleted.1",
])

const duplicateLiveEvents = new Set([...duplicateSyncEvents].map((name) => name.slice(0, -2)))
const DUPLICATE_EVENT_LIMIT = 1024

export function createDuplicateEventFilter() {
  const seen = new Set<string>()
  return (event: SSEPayload): boolean => {
    if (event.type === "sync") {
      return duplicateSyncEvents.has(event.name) && seen.delete(event.id)
    }

    if (duplicateLiveEvents.has(event.type)) {
      if (seen.size >= DUPLICATE_EVENT_LIMIT) seen.delete(seen.values().next().value!)
      seen.add(event.id)
    }
    return false
  }
}

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

const sessionScopedTransientEvents = new Set<string>([
  "session.status",
  "session.turn.open",
  "session.turn.close",
  "session.idle",
  "session.error",
  "session.wakeup",
  "todo.updated",
  "message.part.delta",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "suggestion.shown",
  "suggestion.accepted",
  "suggestion.dismissed",
  "session.network.asked",
  "session.network.replied",
  "session.network.rejected",
  "session.network.restored",
])

function resolveTransientSessionId(event: TransientPayload): string | undefined {
  if (!sessionScopedTransientEvents.has(event.type)) return undefined
  const properties = (event as { properties?: { sessionID?: string } }).properties
  return properties?.sessionID
}
