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

type Tracker = { paths: string[]; abort: AbortController | undefined; paused: boolean }

const trackers = new WeakMap<ProjectContext, Tracker>()

function samePaths(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

function tracker(ctx: ProjectContext): Tracker {
  const existing = trackers.get(ctx)
  if (existing) return existing
  const created: Tracker = { paths: [], abort: undefined, paused: false }
  trackers.set(ctx, created)
  return created
}

/**
 * Kick off (or skip) a size pass for the current orphan set.
 *
 * A no-op when the path set is unchanged since the last pass — an unrelated reconcile (e.g. a
 * routine worktree-health poll) must never re-walk directories nothing has touched. A set that *has*
 * changed aborts the pass in flight before starting the new one: its answer is already worthless, and
 * the walk is the expensive part, so leaving it running would burn I/O on directories nobody is
 * waiting for. Results land on `ctx.report?.orphans` in place, read fresh at completion time rather
 * than closed over, so a report replaced by a newer reconcile while the walk was in flight is never
 * overwritten with stale data.
 */
export function trackOrphanSizes(
  ctx: ProjectContext,
  orphans: OrphanDirectory[],
  log: (...args: unknown[]) => void,
  onSized?: () => void,
): void {
  const state = tracker(ctx)
  if (state.paused) return
  const next = orphans.map((orphan) => orphan.path).toSorted()
  if (samePaths(next, state.paths)) return
  state.paths = next
  state.abort?.abort()
  if (next.length === 0) return
  const controller = new AbortController()
  state.abort = controller
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

/**
 * Abort the in-flight size pass and hold off new ones until [resumeOrphanSizes].
 *
 * Called when a delete starts: the walk is holding the very paths that are about to be renamed away,
 * so it is measuring folders the user already decided to destroy. Pausing rather than merely aborting
 * matters because a delete re-reconciles before it touches anything, and that reconcile would
 * otherwise start a fresh pass over the doomed set immediately.
 *
 * The measured path set is forgotten too: whatever survives the delete has to be walked again, and
 * leaving the old set here would make the next pass look redundant and skip itself.
 */
export function pauseOrphanSizes(ctx: ProjectContext): void {
  const state = tracker(ctx)
  state.paused = true
  state.abort?.abort()
  state.abort = undefined
  state.paths = []
}

/**
 * Allow size passes again after [pauseOrphanSizes].
 *
 * Does not start one — the reconcile that follows a delete does, for whatever orphans are left.
 */
export function resumeOrphanSizes(ctx: ProjectContext): void {
  const state = trackers.get(ctx)
  if (!state) return
  state.paused = false
}

/** Abort any in-flight size pass for a project context that is going away. */
export function disposeOrphanSizes(ctx: ProjectContext): void {
  trackers.get(ctx)?.abort?.abort()
  trackers.delete(ctx)
}
