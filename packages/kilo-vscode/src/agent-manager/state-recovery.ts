import type { WorktreeInfo } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"

export interface RecoveryResult {
  worktrees: number
  sessions: number
}

/**
 * Recover worktrees and their first sessions from disk.
 *
 * The worktree's recorded metadata names the session the worktree was created with, not where that session runs now:
 * it stays in the git metadata after the session moves to Local or to another worktree. An existing filing is
 * therefore authoritative here and is never overridden. The catalog repair in `collectProjectSessions` follows the
 * server directory for a known filing, and the restore reads that state, so a stale metadata id cannot pull a moved
 * session back into a worktree on every start.
 */
export function restoreWorktrees(state: WorktreeStateManager, infos: WorktreeInfo[]): RecoveryResult {
  const result: RecoveryResult = { worktrees: 0, sessions: 0 }

  for (const info of infos) {
    const existing = state.findWorktreeByPath(info.path)
    const wt =
      existing ??
      state.restoreWorktree({
        branch: info.branch,
        path: info.path,
        parentBranch: info.parentBranch,
        remote: info.remote,
        createdAt: new Date(info.createdAt).toISOString(),
      })

    if (!existing) result.worktrees++
    if (!info.sessionId || state.isSessionClosed(info.sessionId)) continue
    if (state.getSession(info.sessionId)) continue
    state.addSession(info.sessionId, wt.id)
    result.sessions++
  }

  return result
}
