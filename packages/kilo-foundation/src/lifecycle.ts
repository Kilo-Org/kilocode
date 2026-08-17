import type { SessionLifecycleStatus } from "./types"

export function toLifecycleStatus(status: SessionLifecycleStatus): SessionLifecycleStatus {
  return status
}

export function isSessionReachable(status: SessionLifecycleStatus): boolean {
  return status === "reachable" || status === "running" || status === "paused" || status === "stalled"
}

/**
 * Worktree/session isolation: a session directory must not be the parent
 * workspace root when isolation is required.
 */
function normalizeIsolationPath(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "").replace(/\\/g, "/")
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed
}

export function assertSessionIsolation(input: {
  workspaceRoot: string
  sessionDirectory: string
  isolated: boolean
}): void {
  if (!input.isolated) {
    return
  }
  const root = normalizeIsolationPath(input.workspaceRoot)
  const session = normalizeIsolationPath(input.sessionDirectory)
  if (session === root) {
    throw new Error("Isolated session directory must not be the workspace root.")
  }
}
