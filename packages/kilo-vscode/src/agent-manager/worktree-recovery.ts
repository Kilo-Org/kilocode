/**
 * User-initiated recovery for unhealthy worktrees.
 *
 * Automatic recovery only ever touches metadata (see worktree-reconcile.ts). Everything here is
 * behind an explicit click because it either writes a checkout or deletes files:
 *
 * - restore: re-create a deleted worktree directory from its surviving branch
 * - forget: drop the state row but keep the conversations, moving them to Local
 * - clean: delete directories under `.kilo/worktrees/` that no worktree claims
 */

import type { ProjectContext } from "./project/context"
import type { WorktreeHealthReport } from "./worktree-reconcile"

export interface RecoveryHost {
  post: (message: { type: "error"; message: string; projectId?: string; worktreeId?: string }) => void
  push: () => void
  log: (...args: unknown[]) => void
  /** Re-run the health reconcile after a successful recovery. */
  reconcile: (ctx: ProjectContext) => Promise<WorktreeHealthReport | undefined>
}

export type RecoveryMessage =
  | { type: "agentManager.restoreWorktree"; worktreeId: string }
  | { type: "agentManager.cleanOrphanDirectories"; paths: string[] }

/** Dispatch a recovery message for the active project. */
export async function handleRecovery(
  m: RecoveryMessage,
  ctx: ProjectContext | undefined,
  host: RecoveryHost,
): Promise<null> {
  if (!ctx) return null
  if (m.type === "agentManager.restoreWorktree") await restoreWorktree(ctx, host, m.worktreeId)
  if (m.type === "agentManager.cleanOrphanDirectories") await cleanOrphans(ctx, host, m.paths)
  return null
}

/** Re-create the directory for a worktree whose branch still exists. */
export async function restoreWorktree(ctx: ProjectContext, host: RecoveryHost, worktreeId: string): Promise<void> {
  const state = ctx.peekState()
  const worktree = state?.getWorktree(worktreeId)
  if (!state || !worktree) return
  try {
    await ctx.worktreeManager().restoreWorktree(worktree.path, worktree.branch)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    host.log(`Failed to restore worktree ${worktreeId}: ${message}`)
    host.post({ type: "error", projectId: ctx.id, worktreeId, message: `Could not restore the worktree: ${message}` })
    return
  }
  ctx.stale.delete(worktreeId)
  await host.reconcile(ctx)
  host.push()
  host.log(`Restored worktree ${worktreeId} (${worktree.branch})`)
}

/**
 * Delete orphaned directories under `.kilo/worktrees/`.
 *
 * Only paths the last reconcile classified as orphans are accepted, and the manager re-checks that
 * git does not track them, so a live worktree cannot be deleted through this path even if the
 * webview sends a stale list.
 */
export async function cleanOrphans(ctx: ProjectContext, host: RecoveryHost, paths: string[]): Promise<void> {
  const known = new Set(ctx.report?.orphans.map((orphan) => orphan.path) ?? [])
  const manager = ctx.worktreeManager()
  let removed = 0
  for (const target of paths) {
    if (!known.has(target)) {
      host.log(`Ignored cleanup for a path that is not a known orphan: ${target}`)
      continue
    }
    const failure = await manager
      .removeOrphanDirectory(target)
      .then(() => undefined)
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
    if (failure) {
      host.log(`Failed to remove orphaned directory ${target}: ${failure}`)
      host.post({ type: "error", projectId: ctx.id, message: `Could not remove ${target}: ${failure}` })
      continue
    }
    removed++
  }
  if (removed === 0) return
  await host.reconcile(ctx)
  host.push()
  host.log(`Removed ${removed} orphaned worktree director${removed === 1 ? "y" : "ies"}`)
}
