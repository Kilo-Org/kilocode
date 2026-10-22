import { normalizePath } from "./git-import"
import type { ManagedSession } from "./WorktreeStateManager"

/**
 * Determine whether diff polling should stop when a worktree is being removed.
 *
 * Returns true when the worktree being deleted is currently the diff target
 * (either by directory path or because the diff context is the worktree
 * itself or one of its orphaned sessions).
 */
export function shouldStopDiffPolling(
  worktreePath: string,
  orphaned: ManagedSession[],
  diffTarget: { directory: string } | undefined,
  diffCtx: string | undefined,
): boolean {
  if (diffTarget && normalizePath(diffTarget.directory) === normalizePath(worktreePath)) return true
  if (diffCtx && orphaned.some((s) => s.worktreeId === diffCtx || s.id === diffCtx)) return true
  return false
}
