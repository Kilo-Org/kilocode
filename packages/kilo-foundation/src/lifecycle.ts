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
export function assertSessionIsolation(input: {
  workspaceRoot: string
  sessionDirectory: string
  isolated: boolean
}): void {
  if (!input.isolated) {
    return
  }
  const root = input.workspaceRoot.replace(/[\\/]+$/, "")
  const session = input.sessionDirectory.replace(/[\\/]+$/, "")
  if (session === root) {
    throw new Error("Isolated session directory must not be the workspace root.")
  }
}
