/**
 * Pure task-cleanup classification logic. No vscode imports so it stays unit
 * testable. A "session" here is the minimal shape the cleanup service needs
 * from the backend's global session list.
 */

export interface CleanupSession {
  id: string
  directory: string
  parentID?: string
  created: number
  updated: number
}

export interface Retention {
  defaultDays: number
  incompleteDays: number
}

export const DAY_MS = 86_400_000

// A session whose whole lifetime spans less than this never ran a real
// exchange — the closest available equivalent of the legacy "incomplete"
// classification (no attempt_completion), used to expire abandoned or
// experimental tasks on the shorter retention clock.
const STUB_MS = 60_000

export function clampDays(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

function stub(s: CleanupSession): boolean {
  return s.updated - s.created < STUB_MS
}

/**
 * Session ids that are old enough to delete under the given retention.
 *
 * A parent session is as fresh as its newest descendant: the backend cascades
 * child deletion with the parent, so an old parent with a recent fork must
 * survive until the fork ages out too.
 */
export function expiredSessions(sessions: CleanupSession[], retention: Retention, now = Date.now()): Set<string> {
  const kids = new Map<string, CleanupSession[]>()
  for (const s of sessions) {
    if (!s.parentID) continue
    const list = kids.get(s.parentID) ?? []
    list.push(s)
    kids.set(s.parentID, list)
  }

  const effective = new Map<string, number>()
  const touch = (s: CleanupSession): number => {
    const seen = effective.get(s.id)
    if (seen !== undefined) return seen
    effective.set(s.id, NaN) // cycle guard, overwritten below
    let latest = s.updated
    for (const kid of kids.get(s.id) ?? []) {
      const at = touch(kid)
      if (Number.isFinite(at) && at > latest) latest = at
    }
    effective.set(s.id, latest)
    return latest
  }

  const expired = new Set<string>()
  for (const s of sessions) {
    const days = stub(s) ? retention.incompleteDays : retention.defaultDays
    const age = now - touch(s)
    if (age >= days * DAY_MS) expired.add(s.id)
  }
  return expired
}

/**
 * Expired sessions whose ancestors are not also expired. The backend cascades
 * child deletion with the parent, so only roots need a delete call — issuing
 * deletes for cascaded children just produces 404s that pollute the result
 * stats. A cascaded child whose expired parent is later skipped as active
 * simply waits for the next pass (self-healing).
 */
export function deletionRoots(sessions: CleanupSession[], expired: Set<string>): CleanupSession[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const roots: CleanupSession[] = []
  for (const s of sessions) {
    if (!expired.has(s.id)) continue
    const seen = new Set<string>()
    let cur: CleanupSession | undefined = s
    let cascaded = false
    while (cur?.parentID && !seen.has(cur.id)) {
      seen.add(cur.id)
      if (expired.has(cur.parentID)) {
        cascaded = true
        break
      }
      cur = byId.get(cur.parentID)
    }
    if (!cascaded) roots.push(s)
  }
  return roots
}
