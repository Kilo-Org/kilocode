/**
 * Bridges the worktree-health reconcile into the webview payload and decides when to re-run it.
 *
 * Reconcile is the only thing that knows whether a missing worktree can be restored from its branch,
 * so the presence probe does not guess: it reports what it saw and asks for a fresh reconcile when
 * the set of unhealthy worktrees changes.
 *
 * No vscode imports — the provider owns the plumbing, this owns the policy.
 */

import type { WorktreeHealth, WorktreeHealthReport } from "./worktree-reconcile"

/** Health of every worktree still present in state, plus any orphaned directories. */
export function healthPayload(
  report: WorktreeHealthReport | undefined,
  worktrees: { id: string }[],
): { worktreeHealth?: Record<string, WorktreeHealth>; orphanDirectories?: string[] } {
  if (!report) return {}
  const ids = new Set(worktrees.map((wt) => wt.id))
  const health: Record<string, WorktreeHealth> = {}
  for (const entry of report.entries) {
    if (!ids.has(entry.id)) continue
    if (entry.health === "ok") continue
    health[entry.id] = entry.health
  }
  // Paths, not just a count: the confirmation dialog has to show exactly what will be deleted, and
  // the host re-validates every path against the current orphan set before removing anything.
  return { worktreeHealth: health, orphanDirectories: report.orphans.map((orphan) => orphan.path) }
}

/**
 * Fold a presence probe into the tracked stale set and sync branches.
 *
 * A degraded probe learned nothing, so it must not clear or extend the stale set: "we could not
 * check" is not "the worktree is fine" and not "the worktree is gone".
 */
export function applyPresence(
  result: { worktrees: { worktreeId: string; missing: boolean; branch?: string }[]; degraded: boolean },
  stale: Set<string>,
  worktrees: { id: string }[],
  syncBranch: (id: string, branch: string) => boolean,
): { staleChanged: boolean; branchChanged: boolean; degraded: boolean } {
  const ids = new Set(worktrees.map((wt) => wt.id))
  for (const id of [...stale]) {
    if (!ids.has(id)) stale.delete(id)
  }
  if (result.degraded) return { staleChanged: false, branchChanged: false, degraded: true }

  const entries = result.worktrees.filter((item) => ids.has(item.worktreeId))
  if (entries.length === 0) return { staleChanged: false, branchChanged: false, degraded: false }

  // Every drifted branch must be synced, so no short-circuiting: `some` would stop at the first
  // row that actually changed and leave the rest stale until a later tick.
  const branchChanged = entries
    .map((entry) => entry.branch !== undefined && syncBranch(entry.worktreeId, entry.branch))
    .includes(true)
  const next = new Set(entries.filter((entry) => entry.missing).map((entry) => entry.worktreeId))
  const staleChanged = next.size !== stale.size || [...next].some((id) => !stale.has(id))
  stale.clear()
  for (const id of next) stale.add(id)
  return { staleChanged, branchChanged, degraded: false }
}

/**
 * Whether a presence probe should ask for a fresh reconcile.
 *
 * A changed stale set needs one to say why and to self-heal. A degraded report needs one too: it
 * learned nothing, so every row is `unavailable`, and a probe that answered has just proved git can
 * answer again. Without this the report stays degraded until an explicit recovery action, because an
 * unchanged missing-set never sets `staleChanged`.
 */
export function needsReconcile(applied: { staleChanged: boolean }, report?: { degraded: boolean }): boolean {
  return applied.staleChanged || report?.degraded === true
}

/**
 * Stale ids that still refer to a tracked worktree, dropping the rest.
 *
 * The stale set outlives individual worktrees — a deleted worktree would otherwise stay in it
 * forever and keep being reported to the webview.
 */
export function staleForState(stale: Set<string>, worktrees: { id: string }[]): string[] {
  const ids = new Set(worktrees.map((wt) => wt.id))
  for (const id of [...stale]) {
    if (!ids.has(id)) stale.delete(id)
  }
  return worktrees.filter((wt) => stale.has(wt.id)).map((wt) => wt.id)
}

/**
 * Coalesces reconcile requests per project.
 *
 * The presence probe runs every few seconds; a worktree that disappears would otherwise trigger a
 * reconcile per tick. One pass per project at a time, delayed enough that a rename or a `git
 * worktree add` in progress settles first.
 */
export class HealthScheduler<T extends { id: string }> {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly running = new Set<string>()

  constructor(
    private readonly run: (target: T) => Promise<void>,
    private readonly delay = 2_000,
  ) {}

  schedule(target: T): void {
    if (this.running.has(target.id)) return
    const pending = this.timers.get(target.id)
    if (pending) clearTimeout(pending)
    const timer = setTimeout(() => {
      this.timers.delete(target.id)
      this.running.add(target.id)
      void this.run(target).finally(() => this.running.delete(target.id))
    }, this.delay)
    this.timers.set(target.id, timer)
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }
}
