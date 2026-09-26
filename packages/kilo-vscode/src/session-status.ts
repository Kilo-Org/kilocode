import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"

/**
 * The CLI derives `scheduled` for a session asleep on a pending wakeup. It is
 * not a running turn, but this client renders every non-idle status as working,
 * so the derived value is folded back to `idle` at the boundary until the
 * webview grows a `scheduled` rendering. The SDK type is regenerated from the
 * server schema, so the extra variant is widened locally.
 */
export type ClientSessionStatus = SessionStatus | { type: "scheduled"; scheduledAt: string }

export function clientSessionStatus(status: ClientSessionStatus): SessionStatus {
  return status.type === "scheduled" ? { type: "idle" } : status
}

/** A session asleep on a pending wakeup is not a running turn. */
export function isRunningStatus(
  status: SessionStatus["type"] | "scheduled" | undefined,
): status is "busy" | "retry" | "offline" {
  return status !== undefined && status !== "idle" && status !== "scheduled"
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
  reconcile = true,
  accept?: (sessionID: string, status: SessionStatus) => boolean,
): Promise<void> {
  try {
    const result = await client.session.status({ directory: dir })
    if (!result.data) return
    const active = result.data

    // Seed/update entries the server knows about
    for (const [sid, raw] of Object.entries(active) as [string, ClientSessionStatus][]) {
      const info = clientSessionStatus(raw)
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

/**
 * Fetch pending wakeup counts for every known directory and seed the webview.
 * Wakeups are directory scoped, like session status, so each directory needs
 * its own request. A failed directory is logged and skipped: one missing
 * directory must not blank the others. Returns the session IDs that still hold
 * a wakeup and whether every directory answered, so the caller can reconcile a
 * previous seed to zero only when the result is complete.
 */
export async function seedSessionWakeups(
  client: KiloClient,
  dirs: string[],
  post: (msg: unknown) => void,
  accept?: (sessionID: string) => boolean,
): Promise<{ seen: Set<string>; complete: boolean }> {
  const seen = new Set<string>()
  let complete = true
  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const result = await client.kilocode.wakeups({ directory: dir }, { throwOnError: true })
        for (const item of result.data ?? []) {
          if (accept && !accept(item.sessionID)) continue
          seen.add(item.sessionID)
          post({ type: "sessionWakeup", sessionID: item.sessionID, pending: item.pending })
        }
      } catch (error) {
        complete = false
        console.error(`[Kilo New] KiloProvider: Failed to seed session wakeups for ${dir}:`, error)
      }
    }),
  )
  return { seen, complete }
}
