/**
 * Helpers for tracking active (working) time across a turn or goal, excluding any
 * time spent parked on a permission or blocking question prompt.
 *
 * A `Timing` pairs banked time from previous running stretches (`active`) with
 * the start of the current running stretch (`since`, absent while parked).
 * The displayed elapsed value is always `active + (since ? now - since : 0)`.
 */
import { createComputed, untrack } from "solid-js"
import { produce, type SetStoreFunction } from "solid-js/store"
import type { SessionCloseReason, SessionInfo, SessionStatus } from "../types/messages"

export type Timing = { active: number; since?: number }

/** A goal keeps working between turns, but not after a stop or terminal error. */
export function running(goal: SessionInfo["goal"], status?: SessionStatus, reason?: SessionCloseReason): boolean {
  return (
    goal?.active === true &&
    (goal.status == null || goal.status === "active") &&
    status !== "offline" &&
    reason !== "error" &&
    reason !== "interrupted"
  )
}

export function createTiming(opts: {
  sessions: () => string[]
  timing: Record<string, Timing>
  running: (id: string) => boolean
  parked: (id: string) => boolean
  start: (id: string) => void
  set: SetStoreFunction<Record<string, Timing>>
}) {
  const goals = new Set<string>()
  // Hydration and metadata updates can start or stop a goal without a status event.
  createComputed(() => {
    const now = Date.now()
    for (const sid of new Set([...opts.sessions(), ...goals])) {
      if (opts.running(sid)) {
        goals.add(sid)
        untrack(() => opts.start(sid))
        continue
      }
      if (!goals.delete(sid)) continue
      opts.set(produce((map) => delete map[sid]))
    }
    // Read keys untracked so clock writes do not trigger this computed again.
    for (const sid of untrack(() => Object.keys(opts.timing))) {
      // Solid merges clock objects, so clear the running stretch explicitly.
      if (opts.parked(sid)) opts.set(sid, (t) => ({ ...hold(t, now), since: undefined }))
      else opts.set(sid, "since", (v) => v ?? now)
    }
  })
}

/** Bank the current running stretch (if any) and stop the clock. */
export function hold(timing: Timing, now: number): Timing {
  if (timing.since === undefined) return timing
  return { active: timing.active + Math.max(0, now - timing.since) }
}

/** Total elapsed active milliseconds, including the current running stretch. */
export function active(timing: Timing, now: number): number {
  if (timing.since === undefined) return timing.active
  return timing.active + Math.max(0, now - timing.since)
}
