// kilocode_change - new file
import type { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"

/** The status a client sees once attention, the live turn and a wakeup are folded together. */
export type DerivedSessionStatus = "idle" | "busy" | "question" | "permission" | "retry" | "scheduled"

/**
 * The earliest future wakeup per session. A wakeup that is already due is left
 * out: that turn is starting now, so `scheduled` must not describe it.
 */
export function futureDue(
  infos: readonly { sessionID: SessionID; dueAt: number }[],
  now = Date.now(),
): Map<SessionID, number> {
  const due = new Map<SessionID, number>()
  for (const info of infos) {
    if (info.dueAt <= now) continue
    const held = due.get(info.sessionID)
    if (held === undefined || info.dueAt < held) due.set(info.sessionID, info.dueAt)
  }
  return due
}

/**
 * The earliest future wakeup per session, restricted to the sessions a caller is
 * about to display. The session list runs in its own process and may cover a
 * directory the current instance never adopted, so it must read the persisted
 * wakeups (`Wakeup.list`) and pick the listed sessions itself rather than trust
 * the in-memory, directory-scoped view.
 */
export function futureDueFor(
  infos: readonly { sessionID: SessionID; dueAt: number }[],
  sessionIDs: Iterable<string>,
  now = Date.now(),
): Map<SessionID, number> {
  const listed = new Set(sessionIDs)
  return futureDue(
    infos.filter((info) => listed.has(String(info.sessionID))),
    now,
  )
}

export function scheduledInfo(dueAt: number): SessionStatus.Info {
  return { type: "scheduled", scheduledAt: new Date(dueAt).toISOString() }
}

/**
 * Fold the derived `scheduled` state into the stored status map. A stored
 * busy/retry/offline wins, so `scheduled` only ever describes a session that is
 * doing nothing now; a past-due wakeup never reaches this map in the first place.
 */
export function mergeScheduled(
  base: Readonly<Record<string, SessionStatus.Info>>,
  due: ReadonlyMap<SessionID, number>,
): Record<string, SessionStatus.Info> {
  const merged: Record<string, SessionStatus.Info> = { ...base }
  for (const [sessionID, dueAt] of due) {
    const id = String(sessionID)
    if (merged[id] !== undefined) continue
    merged[id] = scheduledInfo(dueAt)
  }
  return merged
}

/** Precedence: permission > question > a live turn > a future wakeup > idle. */
export function resolveDerivedSessionStatus(input: {
  hasPermission: boolean
  hasQuestion: boolean
  statusType: SessionStatus.Info["type"] | undefined
  scheduledAt?: number
}): DerivedSessionStatus {
  if (input.hasPermission) return "permission"
  if (input.hasQuestion) return "question"
  if (input.statusType === "offline") return "retry"
  if (input.statusType === "busy" || input.statusType === "retry") return input.statusType
  if (input.scheduledAt !== undefined) return "scheduled"
  if (input.statusType === "idle") return input.statusType
  return "idle"
}
