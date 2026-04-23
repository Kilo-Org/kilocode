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
 *
 * When `reconcile` is true (default: first seed), locally-busy sessions absent
 * from the server response are reset to idle — covering server crash/restart.
 * On SSE reconnects set `reconcile: false` to avoid a race where the HTTP
 * fetch briefly returns stale data and the spinner disappears mid-stream.
 */
export async function seedSessionStatuses(
  client: KiloClient,
  dir: string,
  map: Map<string, SessionStatus["type"]>,
  post: (msg: unknown) => void,
  reconcile = true,
): Promise<void> {
  try {
    const result = await client.session.status({ directory: dir })
    if (!result.data) return
    const active = result.data

    // Seed/update entries the server knows about
    for (const [sid, info] of Object.entries(active) as [string, SessionStatus][]) {
      map.set(sid, info.type)
      post({
        type: "sessionStatus",
        sessionID: sid,
        status: info.type,
        ...(info.type === "retry" ? { attempt: info.attempt, message: info.message, next: info.next } : {}),
      })
    }

    // Reconcile: any locally non-idle session absent from the server response
    // means the server lost its in-memory state (crash/restart). Reset to idle.
    // Skipped on SSE reconnects — the real-time SSE events are authoritative
    // for status transitions and the brief HTTP fetch can race with them.
    if (reconcile) {
      for (const [sid, status] of map) {
        if (status !== "idle" && !active[sid]) {
          map.set(sid, "idle")
          post({ type: "sessionStatus", sessionID: sid, status: "idle" })
        }
      }
    }
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to seed session statuses:", error)
  }
}
