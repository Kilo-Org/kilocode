import type { SessionStatus } from "../../types/messages"

export function tracksElapsed(status: SessionStatus, submitting: boolean, since: number | undefined): since is number {
  return since !== undefined && (status !== "idle" || submitting)
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
export function showsWorking(status: SessionStatus, submitting: boolean, blocked: boolean): boolean {
  if (blocked) return false
  return submitting || status !== "idle"
}
