/**
 * Repository-local state initialization for one Agent Manager project context.
 *
 * Extracted from AgentManagerProvider so the same sequence runs for the
 * active project (full panel wiring follows) and for expanded background
 * projects (state push only). Ordering matters: the git exclude update must
 * land before the persisted state file is read.
 */

import * as fs from "fs"
import { restoreWorktrees } from "../state-recovery"
import { reconcileWorktrees, summarize, type WorktreeHealthReport } from "../worktree-reconcile"
import { trackOrphanSizes } from "../orphans/sizing"
import type { ProjectContext, ProjectInitResult } from "./context"

export async function initContextState(
  ctx: ProjectContext,
  log: (...args: unknown[]) => void,
  opts?: { warm?: boolean },
): Promise<ProjectInitResult> {
  // Cached hydration is read-only with respect to the pool. User activation can request warming explicitly.
  const warm = opts?.warm === true || (opts?.warm !== false && ctx.lifecycle === "cold")
  const generation = ctx.generation
  const result = await ctx.ensureReady(async (generation) => {
    const manager = ctx.worktreeManager()
    const state = ctx.stateManager()
    await manager.ensureGitExclude().catch((err) => log("Failed to update git exclude:", err))
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    const loaded = await state.load()
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    manager.cleanupOrphanedTempDirs()

    if (loaded.status === "failed" && !(await state.prepareRecovery())) {
      return { ok: false, refsFixed: 0 }
    }
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }

    const infos = await manager.discoverWorktrees().catch((err) => {
      log("Failed to discover worktrees during state recovery:", err)
      return []
    })
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    if (infos.length > 0) {
      const result = restoreWorktrees(state, infos)
      if (result.worktrees > 0 || result.sessions > 0) {
        log(`Recovered ${result.worktrees} worktree(s) and ${result.sessions} session(s) from disk`)
        await state.flush()
      }
    }

    // Disk to state recovery above only ever adds rows. This pass is the other direction: classify
    // what is already tracked, prune what git can drop, and clear rows that cannot lose anything.
    const health = await reconcileProject(ctx, log)
    if (!ctx.isCurrent(generation)) return { ok: false, refsFixed: 0 }
    if (health && health.dropped.length > 0) await state.flush()
    return { ok: true, refsFixed: loaded.refsFixed, health }
  })
  if (warm && result.ok && result.current && ctx.isCurrent(generation)) ctx.warmPool()
  return result
}

/**
 * Reconcile state rows, git registrations, and directories for one project, storing the verdict on
 * the context so pollers can skip worktrees that cannot answer.
 *
 * Failure here is never fatal: a project whose health is unknown keeps working, it just does not
 * get self-healing until the next pass.
 */
export async function reconcileProject(
  ctx: ProjectContext,
  log: (...args: unknown[]) => void,
): Promise<WorktreeHealthReport | undefined> {
  const manager = ctx.worktreeManager()
  const state = ctx.stateManager()
  const report = await reconcileWorktrees({
    root: ctx.root,
    dir: manager.worktreesDir,
    rows: () => state.getWorktrees().map((wt) => ({ id: wt.id, path: wt.path, branch: wt.branch })),
    sessions: (id) => state.getSessions(id).length,
    registered: () => manager.registeredPaths(),
    dirs: () => manager.worktreeDirs(),
    exists: (target) =>
      fs.promises.access(target).then(
        () => true,
        () => false,
      ),
    branchExists: (branch) => manager.branchExists(branch),
    prune: () => manager.pruneWorktrees(),
    drop: (id) => state.removeWorktree(id),
    log: (msg) => log(msg),
  }).catch((err: unknown) => {
    log("Failed to reconcile worktree health:", err)
    return undefined
  })
  if (!report) return undefined
  ctx.report = report
  log(`worktree health: ${summarize(report)}`)
  trackOrphanSizes(ctx, report.orphans, log)
  return report
}

/**
 * Fast reactivation of an already-initialized context: push in-memory state without re-running the
 * full initialization sequence. Returns false when the context is not ready and the caller must run
 * the full init.
 */
export function reactivateProject(ctx: ProjectContext, pushState: (ctx: ProjectContext) => void): boolean {
  if (ctx.lifecycle !== "ready" || !ctx.peekState()) return false
  pushState(ctx)
  return true
}
