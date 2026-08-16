import {
  DEFAULT_STALL_AFTER_MS,
  GENERIC_RETRY_POLICY,
  type Escalation,
  type RetryPolicy,
  type SessionActivityStatus,
  type SessionId,
} from "./types"

export { DEFAULT_STALL_AFTER_MS }

export interface SessionProgress {
  sessionId: SessionId
  activity: SessionActivityStatus
  lastProgressIso: string
  directory?: string
}

export function detectSessionStall(input: {
  status: SessionActivityStatus
  nowIso: string
  lastProgressIso: string
  stallAfterMs?: number
}): boolean {
  if (input.status === "idle" || input.status === "stopped") {
    return false
  }

  const now = Date.parse(input.nowIso)
  const lastProgress = Date.parse(input.lastProgressIso)
  if (Number.isNaN(now) || Number.isNaN(lastProgress)) {
    return false
  }

  const stallAfterMs = input.stallAfterMs ?? DEFAULT_STALL_AFTER_MS
  return now - lastProgress >= stallAfterMs
}

/**
 * Clock-based stall scan. Callers pass last-known activity from session.status
 * events; this function does not poll an LLM or the session HTTP API.
 */
export function scanSessionStalls(
  sessions: readonly SessionProgress[],
  nowIso: string,
  stallAfterMs?: number,
): SessionProgress[] {
  return sessions.filter((session) =>
    detectSessionStall({
      status: session.activity,
      nowIso,
      lastProgressIso: session.lastProgressIso,
      stallAfterMs,
    }),
  )
}

export function suggestEscalation(attemptCount: number, policy: RetryPolicy = GENERIC_RETRY_POLICY): Escalation {
  if (attemptCount < policy.workerAttempts) {
    return "retry"
  }

  const debugUntil = policy.workerAttempts + policy.debugEscalation
  if (attemptCount < debugUntil) {
    return "debug"
  }

  if (attemptCount < debugUntil + 1) {
    return "coordinator"
  }

  return "human"
}
