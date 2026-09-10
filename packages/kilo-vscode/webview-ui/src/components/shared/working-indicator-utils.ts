import type { SessionStatus } from "../../types/messages"

export function tracksElapsed(status: SessionStatus, submitting: boolean, since: number | undefined): since is number {
  return since !== undefined && (status !== "idle" || submitting)
}
