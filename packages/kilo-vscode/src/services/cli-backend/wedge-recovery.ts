/**
 * Decision logic for recovering from a wedged or unresponsive CLI (#16497).
 *
 * Two distinct failure modes are observed from the extension host, which is a
 * separate process and therefore keeps working even when the CLI event loop is
 * blocked:
 *
 * - Shallow probe (`/global/health`) fails: the CLI process is not answering
 *   HTTP at all. This covers a fully blocked event loop (e.g. a non-returning
 *   native SQLite call). An SSE reconnect cannot recover that, so after a
 *   streak of failures the process itself must be restarted.
 * - Shallow probe succeeds but the DB-backed deep probe
 *   (`/global/health/deep`) fails: the process is alive while its single-permit
 *   SQLite driver is wedged. Reconnecting cannot help, so a process restart is
 *   the only recovery.
 *
 * Kept vscode-free and pure so the restart policy is unit testable without
 * spawning processes.
 */

/** Require repeated deep failures to avoid restarting on one slow transaction. */
export const DEEP_HEALTH_FAILURE_THRESHOLD = 2

/** Require repeated shallow failures to avoid restarting on a transient network blip. */
export const SHALLOW_FAILURE_THRESHOLD = 3

/**
 * Advance the consecutive deep-health failure counter.
 *
 * A failed shallow probe means the whole process is unreachable (tracked
 * separately), and any successful deep probe clears the streak; only
 * "process alive + database not answering" samples accumulate.
 */
export function nextDeepHealthFailureCount(current: number, shallowHealthy: boolean, deepHealthy: boolean): number {
  if (!shallowHealthy || deepHealthy) return 0
  return current + 1
}

/**
 * Advance the consecutive shallow-health failure counter. A successful probe
 * clears the streak; failures accumulate toward a process-level restart.
 */
export function nextShallowFailureCount(current: number, shallowHealthy: boolean): number {
  return shallowHealthy ? 0 : current + 1
}

/** Whether the deep failure streak has reached the restart threshold. */
export function shouldRestartForWedge(failureCount: number): boolean {
  return failureCount >= DEEP_HEALTH_FAILURE_THRESHOLD
}

/** Whether the shallow failure streak has reached the process-restart threshold. */
export function shouldRestartForUnresponsiveness(failureCount: number): boolean {
  return failureCount >= SHALLOW_FAILURE_THRESHOLD
}
