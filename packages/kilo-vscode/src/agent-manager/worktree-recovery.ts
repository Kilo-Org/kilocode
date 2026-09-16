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
  /**
   * Drop the polling backoff a worktree earned while it was broken, and poll it now.
   *
   * A restore fixes the cause, but the failures are already on record: without this the worktree the
   * user just repaired can sit parked for the rest of a quarantine window — up to half an hour of
   * badges that do not move, which is the symptom the recovery action was clicked to end.
   */
  refresh: (worktreeId: string) => void
  /** Reveal a path in the OS file manager. A no-op on hosts where that is meaningless. */
  reveal: (path: string) => void
  /** Tear down backend PTYs/instance state rooted at a worktree before its directory is staged. */
  teardown: (root: string, path: string) => Promise<void>
  /** Remove a worktree's snapshot repository. */
  removeSnapshot: (root: string, path: string) => Promise<boolean>
  /** Run a cancellable background task behind a progress notification. */
  withProgress: (title: string, task: (cancelled: () => boolean) => Promise<void>) => Promise<void>
  /** Show the batch-delete completion notification. */
  notifyResult: (kind: "info" | "warning" | "error", message: string) => void
}

export type RecoveryMessage =
  | { type: "agentManager.restoreWorktree"; worktreeId: string }
  | { type: "agentManager.cleanOrphanDirectories"; paths: string[] }
  | { type: "agentManager.revealPath"; path: string }

/** Dispatch a recovery message for the active project. */
export async function handleRecovery(
  m: RecoveryMessage,
  ctx: ProjectContext | undefined,
  host: RecoveryHost,
): Promise<null> {
  if (m.type === "agentManager.revealPath") {
    host.reveal(m.path)
    return null
  }
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
  host.refresh(worktreeId)
  host.push()
  host.log(`Restored worktree ${worktreeId} (${worktree.branch})`)
}

/**
 * Delete orphaned directories under `.kilo/worktrees/`.
 *
 * Every path is re-validated against a *fresh* reconcile — not the possibly-stale `ctx.report` the
 * dialog was built from — before it is touched, so a directory the worktree pool just claimed in the
 * meantime can never be deleted through this path even if the webview sends a stale selection.
 *
 * Runs behind `host.withProgress` so the caller (a webview message handler) returns immediately: the
 * dialog closes instantly, and the actual teardown + delete + snapshot cleanup happens in the
 * background. Cancelling stops the loop from starting new paths; a path already handed to
 * `detachOrphanDirectory` keeps reaping regardless, since the rename already happened.
 */
export async function cleanOrphans(ctx: ProjectContext, host: RecoveryHost, paths: string[]): Promise<void> {
  const manager = ctx.worktreeManager()
  const sizeBefore = new Map((ctx.report?.orphans ?? []).map((orphan) => [orphan.path, orphan.bytes] as const))
  let removed = 0
  let failed = 0
  let removedBytes = 0
  let sizeKnown = true
  await host.withProgress("Removing leftover worktree folders", async (cancelled) => {
    const fresh = await host.reconcile(ctx)
    const known = new Set(fresh?.orphans.map((orphan) => orphan.path) ?? [])
    for (const target of paths) {
      if (cancelled()) break
      if (!known.has(target)) {
        host.log(`Ignored cleanup for a path that is not a known orphan: ${target}`)
        continue
      }
      // Teardown/snapshot failures log and continue: the directory is still gone either way, and a
      // backend that never had state for it (or already cleaned it up) is not a reason to refuse.
      await host.teardown(ctx.root, target).catch((error: unknown) => {
        host.log(`Failed to tear down backend state for ${target}: ${error}`)
      })
      const failure = await manager
        .detachOrphanDirectory(target)
        .then(() => undefined)
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
      if (failure) {
        host.log(`Failed to remove orphaned directory ${target}: ${failure}`)
        host.post({ type: "error", projectId: ctx.id, message: `Could not remove ${target}: ${failure}` })
        failed++
        continue
      }
      await host.removeSnapshot(ctx.root, target)
      removed++
      const bytes = sizeBefore.get(target)
      if (bytes === undefined) sizeKnown = false
      else removedBytes += bytes
    }
  })
  if (removed > 0) {
    await host.reconcile(ctx)
    host.push()
  }
  notifyCleanupResult(host, removed, failed, paths.length, sizeKnown ? removedBytes : undefined)
  host.log(`Removed ${removed} orphaned worktree director${removed === 1 ? "y" : "ies"}`)
}

function notifyCleanupResult(
  host: RecoveryHost,
  removed: number,
  failed: number,
  total: number,
  bytes: number | undefined,
): void {
  const size = bytes !== undefined ? ` (${formatBytes(bytes)})` : ""
  if (failed === 0 && removed === total) {
    host.notifyResult("info", `Removed ${removed} folder${removed === 1 ? "" : "s"}${size}`)
    return
  }
  if (removed > 0) {
    host.notifyResult("warning", `Removed ${removed} of ${total}, ${failed} failed`)
    return
  }
  host.notifyResult("error", `Failed to remove ${total} folder${total === 1 ? "" : "s"}`)
}

/** Apparent size formatted for a completion notification, e.g. `1.2 GB`. */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const precision = unit === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unit]}`
}
