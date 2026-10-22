/**
 * Helpers for tracking active (working) time across a session, excluding
 * time spent parked on a permission or blocking question prompt.
 *
 * A `Timing` pairs banked time from previous running stretches (`active`) with
 * the start of the current running stretch (`since`, absent while parked).
 * The displayed elapsed value is always `active + (since ? now - since : 0)`.
 */
import { createComputed, untrack } from "solid-js"
import type { SetStoreFunction } from "solid-js/store"

export type Timing = { active: number; since?: number }

export function createTiming(opts: {
  timing: Record<string, Timing>
  parked: (id: string) => boolean
  set: SetStoreFunction<Record<string, Timing>>
}) {
  createComputed(() => {
    const now = Date.now()
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
