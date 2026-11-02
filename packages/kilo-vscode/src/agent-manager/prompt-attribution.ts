/** Session metadata key that names the session whose `agent_manager` call started this one. */
export const SOURCE = "kilo.agentManager.source"

/**
 * Session metadata key that holds the request ID of that `agent_manager` call.
 * The call's tool part records the same ID, so the agent map can tell when a
 * revert removed the call.
 */
export const REQUEST = "kilo.agentManager.request"

export function attribute(text: string, source: string | undefined): string {
  if (!source) return text
  return `${text}\n\n<!-- kilo-agent-manager source=${source} -->`
}

/**
 * Name the calling session and its call in a new session's metadata. The
 * prompt marker is text for the model; the agent map reads these keys to draw
 * the edge.
 */
export function stamp(
  metadata: Record<string, unknown>,
  source: { sessionID?: string; requestID?: string } | undefined,
): Record<string, unknown> {
  if (!source?.sessionID) return metadata
  return {
    ...metadata,
    [SOURCE]: source.sessionID,
    ...(source.requestID ? { [REQUEST]: source.requestID } : {}),
  }
}
