/**
 * Tracks per-project orphan directory sizes and reports when a size pass lands.
 *
 * Sizing never decides orphan-ness — it only annotates the directories `worktree-reconcile.ts`
 * already classified — so a slow or failed walk can never change what the banner and dialog show,
 * only how long they wait to show a size next to it.
 *
 * Keyed by `ProjectContext` identity in a `WeakMap`: a disposed and garbage-collected context drops
 * its tracker for free, and a project that is removed and re-added starts with a clean slate rather
 * than inheriting a stale path set.
 *
 * No vscode imports.
 */

import { sizes } from "./orphan-size"
import type { ProjectContext } from "./project/context"
import type { OrphanDirectory } from "./worktree-reconcile"

type Tracker = { paths: string[]; abort: AbortController | undefined }

const trackers = new WeakMap<ProjectContext, Tracker>()

function samePaths(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

/**
 * Kick off (or skip) a size pass for the current orphan set.
 *
 * A no-op when the path set is unchanged since the last pass — an unrelated reconcile (e.g. a
 * routine worktree-health poll) must never re-walk directories nothing has touched. Results land on
 * `ctx.report?.orphans` in place, read fresh at completion time rather than closed over, so a report
 * replaced by a newer reconcile while the walk was in flight is never overwritten with stale data.
 */
export function trackOrphanSizes(
  ctx: ProjectContext,
  orphans: OrphanDirectory[],
  log: (...args: unknown[]) => void,
  onSized?: () => void,
): void {
  const tracker = trackers.get(ctx) ?? { paths: [], abort: undefined }
  trackers.set(ctx, tracker)
  const next = orphans.map((orphan) => orphan.path).toSorted()
  if (samePaths(next, tracker.paths)) return
  tracker.paths = next
  tracker.abort?.abort()
  if (next.length === 0) return
  const controller = new AbortController()
  tracker.abort = controller
  sizes(next, { signal: controller.signal })
    .then((result) => {
      if (controller.signal.aborted) return
      const current = ctx.report?.orphans ?? []
      for (const orphan of current) {
        const bytes = result.get(orphan.path)
        if (bytes !== undefined) orphan.bytes = bytes
      }
      if (current.length > 0) onSized?.()
    })
    .catch((err: unknown) => log(`Failed to compute orphan directory sizes: ${err}`))
}

/** Abort any in-flight size pass for a project context that is going away. */
export function disposeOrphanSizes(ctx: ProjectContext): void {
  trackers.get(ctx)?.abort?.abort()
  trackers.delete(ctx)
}
