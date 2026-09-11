/**
 * Pure helpers for tracking active (working) time across a turn, excluding any
 * time spent parked on a permission or blocking question prompt.
 *
 * A `Timing` pairs banked time from previous running stretches (`active`) with
 * the start of the current running stretch (`since`, absent while parked).
 * The displayed elapsed value is always `active + (since ? now - since : 0)`.
 */
export type Timing = { active: number; since?: number }

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
