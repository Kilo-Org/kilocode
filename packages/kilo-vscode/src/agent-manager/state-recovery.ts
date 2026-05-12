import type { WorktreeInfo } from "./WorktreeManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"

export interface RecoveryResult {
  worktrees: number
  sessions: number
}

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
    if (!info.sessionId) continue

    const session = state.getSession(info.sessionId)
    if (!session) {
      state.addSession(info.sessionId, wt.id)
      result.sessions++
      continue
    }
    if (session.worktreeId === wt.id) continue
    state.moveSession(info.sessionId, wt.id)
    result.sessions++
  }

  return result
}
