import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"

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
  reconcile = true,
  accept?: (sessionID: string, status: SessionStatus) => boolean,
): Promise<void> {
  try {
    const result = await client.session.status({ directory: dir })
    if (!result.data) return
    const active = result.data

    // Seed/update entries the server knows about
    for (const [sid, info] of Object.entries(active) as [string, SessionStatus][]) {
      if (accept && !accept(sid, info)) continue
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
    if (reconcile) {
      for (const [sid, status] of map) {
        if (status !== "idle" && !active[sid]) {
          if (accept && !accept(sid, { type: "idle" })) continue
          map.set(sid, "idle")
          post({ type: "sessionStatus", sessionID: sid, status: "idle" })
        }
      }
    }
  } catch (error) {
    console.error("[Kilo New] KiloProvider: Failed to seed session statuses:", error)
  }
}
