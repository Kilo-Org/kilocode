import type { SessionLifecycleStatus } from "./types"

const RESUMABLE: ReadonlySet<SessionLifecycleStatus> = new Set(["reachable", "paused", "stalled"])

const UNSAFE: ReadonlySet<SessionLifecycleStatus> = new Set(["starting", "running", "unknown"])

/**
 * Automatic safe resume: only resume when the session is not mid-generation
 * and the lifecycle status is a known safe boundary.
 */
export function canSafelyResume(status: SessionLifecycleStatus): boolean {
  return RESUMABLE.has(status)
}

export function resumeDecision(status: SessionLifecycleStatus): "resume" | "wait" | "fail" {
  if (canSafelyResume(status)) {
    return "resume"
  }
  if (status === "failed" || status === "stopped") {
    return "fail"
  }
  if (UNSAFE.has(status)) {
    return "wait"
  }
  return "wait"
}
