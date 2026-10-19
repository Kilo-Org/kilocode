import { Effect } from "effect"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { GoalPolicy } from "@/kilocode/session/goal/policy"
import type { Wakeup } from "@/kilocode/wakeup"

// Kilo-only unattended events: GoalReport (before a /goal settles on the model's report) and
// WakeupFire (before a scheduled wakeup or cron occurrence runs).

/**
 * GoalReport before a goal settles on the working model's report. `retry` runs another goal turn
 * with that note, `pause` settles the goal as paused, `context` is appended to the settled reason.
 */
export function goal(_input: {
  sessionID: SessionID
  text: string
  report: GoalPolicy.Report
  /** Consecutive rejections so far in this goal run. */
  attempt: number
}): Effect.Effect<{ retry?: string; pause?: string; context: string }> {
  return Effect.succeed({ context: "" })
}

/**
 * WakeupFire before a wakeup or cron occurrence prompts its session. `skip` drops this occurrence;
 * `context` is appended to the wake text.
 */
export function wake(_input: {
  info: Wakeup.Info
  kind?: "wakeup" | "cron"
  session?: Session.Info
}): Effect.Effect<{ skip?: string; context: string }> {
  return Effect.succeed({ context: "" })
}

export * as KiloHookUnattended from "./unattended"
