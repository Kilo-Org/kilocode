import type { SessionStatus } from "../../types/messages"
import type { Timing } from "../../context/session-timing"

export function tracksElapsed(
  status: SessionStatus,
  submitting: boolean,
  timing: Timing | undefined,
  goal = false,
): timing is Timing {
  return timing !== undefined && (status !== "idle" || submitting || goal)
}

/**
 * Whether the session dock shows the working indicator instead of the idle
 * session actions. Retry and offline count as working: their countdown and
 * Cancel action belong in the dock, not beside "New Session".
 *
 * This is the dock's single decision point. The indicator itself renders
 * unconditionally, so the two states can never both claim the row (or both
 * stay empty) and change the dock's height.
 */
export function showsWorking(status: SessionStatus, submitting: boolean, blocked: boolean, goal = false): boolean {
  if (blocked) return false
  return submitting || status !== "idle" || goal
}

/**
 * Abort scope for the indicator's Cancel. A subagent's own view stops it as a cancel (`tree`):
 * an interrupt (`session`) would pause the parent's task, and this view has no prompt to resume it.
 */
export function cancelScope(parentID: string | null | undefined): "session" | "tree" {
  return parentID ? "tree" : "session"
}
