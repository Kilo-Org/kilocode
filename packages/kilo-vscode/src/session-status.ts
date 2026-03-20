import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"

/**
 * Returns the number of sessions currently in "busy" state.
 * Used to warn users before operations that will interrupt running sessions.
 */
export function getBusySessionCount(map: Map<string, SessionStatus["type"]>): number {
  let count = 0
  for (const status of map.values()) {
    if (status === "busy") count++
  }
  return count
}

/**
 * Fetch all current session statuses and seed the provided map + webview.
 * Called on connect so the Settings panel knows about already-running sessions
 * without waiting for the next session.status SSE event.
 */
export async function seedSessionStatuses(
  client: KiloClient,
  dir: string,
  map: Map<string, SessionStatus["type"]>,
  post: (msg: unknown) => void,
): Promise<void> {
  try {
    const result = await client.session.status({ directory: dir })
    if (!result.data) return
    for (const [sid, info] of Object.entries(result.data) as [string, SessionStatus][]) {
      map.set(sid, info.type)
      post({
        type: "sessionStatus",
        sessionID: sid,
        status: info.type,
        ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
      })
    }
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to seed session statuses:", error)
  }
}
