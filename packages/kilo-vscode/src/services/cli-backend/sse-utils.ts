import type { SSEEvent } from "./types"

/**
 * Unwrap an SSE message payload.
 * The global /global/event endpoint wraps events as { directory, payload: SSEEvent }.
 * Direct event endpoints return the SSEEvent directly.
 * Returns null if the parsed data has no `type` field (malformed or unknown event).
 */
export function unwrapSSEPayload(raw: unknown): SSEEvent | null {
  if (!raw || typeof raw !== "object") return null
  const event = ((raw as { payload?: SSEEvent }).payload ?? raw) as SSEEvent
  if (!event || typeof event !== "object" || !("type" in event)) {
    return null
  }
  return event
}

/**
 * Check whether an SSE event belongs to a different project and should be dropped.
 * Returns true when the event carries a projectID that does not match the expected one.
 * When expectedProjectID is undefined (not yet resolved), nothing is filtered.
 */
export function isEventFromForeignProject(event: SSEEvent, expectedProjectID: string | undefined): boolean {
  if (!expectedProjectID) return false
  if (event.type === "session.created" || event.type === "session.updated") {
    return event.properties.info.projectID !== expectedProjectID
  }
  return false
}
