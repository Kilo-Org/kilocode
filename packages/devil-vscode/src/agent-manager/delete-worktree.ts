import { normalizePath } from "./git-import"
import type { ManagedSession } from "./WorktreeStateManager"

/**
 * Determine whether diff polling should stop when a worktree is being removed.
 *
 * Returns true when the worktree being deleted is currently the diff target
 * (either by directory path or because one of its orphaned sessions is the
 * active diff session).
 */
export function shouldStopDiffPolling(
  worktreePath: string,
  orphaned: ManagedSession[],
  diffTarget: { directory: string } | undefined,
  diffSessionId: string | undefined,
): boolean {
  if (diffTarget && normalizePath(diffTarget.directory) === normalizePath(worktreePath)) return true
  if (diffSessionId && orphaned.some((s) => s.id === diffSessionId)) return true
  return false
}
