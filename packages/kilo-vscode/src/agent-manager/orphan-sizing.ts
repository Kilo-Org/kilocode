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

type Tracker = {
  abort: AbortController | undefined
  paused: boolean
  /**
   * Settled measurements by path. A present key means the walk is done with that directory; the value
   * is its size, or undefined when it could not be measured at all.
   *
   * This is the only durable home for a size. Every reconcile rebuilds the report's orphan objects
   * from scratch (see worktree-reconcile.ts), so a size written onto them is gone by the next
   * worktree-health poll — and because the path set is unchanged at that point, no new pass would run
   * to recover it. Keeping the numbers here, on a tracker that outlives the report, is what lets a
   * rebuilt report inherit what is already known.
   */
  known: Map<string, number | undefined>
}

const trackers = new WeakMap<ProjectContext, Tracker>()

function tracker(ctx: ProjectContext): Tracker {
  const existing = trackers.get(ctx)
  if (existing) return existing
  const created: Tracker = { abort: undefined, paused: false, known: new Map() }
  trackers.set(ctx, created)
  return created
}

/**
 * Copy what is already known onto the report's current orphan objects.
 *
 * Read fresh from `ctx.report` rather than closed over, so a report replaced by a newer reconcile
 * while a walk was in flight is never overwritten with sizes for directories it does not list.
 */
function apply(ctx: ProjectContext, known: Map<string, number | undefined>): boolean {
  let applied = false
  for (const orphan of ctx.report?.orphans ?? []) {
    if (!known.has(orphan.path)) continue
    const bytes = known.get(orphan.path)
    if (bytes !== undefined && orphan.bytes !== bytes) {
      orphan.bytes = bytes
      applied = true
    }
    // Marked even without a size, so the UI stops waiting for a number that is never coming.
    if (!orphan.sized) {
      orphan.sized = true
      applied = true
    }
  }
  return applied
}

/**
 * Annotate the current orphan set with sizes, walking only what is not already known.
 *
 * Called by every reconcile. Known sizes are re-applied to the objects that reconcile just built —
 * that part is not an optimization, it is what stops the banner from losing its total on every
 * worktree-health poll. Only genuinely new directories are walked, so a routine poll costs nothing and
 * one new leftover folder does not re-read the other forty. A pass in flight is abandoned when new
 * directories appear, since the walk is the expensive part and its results are cached per path
 * anyway: whatever it had not finished is simply picked up by the next pass.
 */
export function trackOrphanSizes(
  ctx: ProjectContext,
  orphans: OrphanDirectory[],
  log: (...args: unknown[]) => void,
): void {
  const state = tracker(ctx)
  if (state.paused) return
  const next = orphans.map((orphan) => orphan.path).toSorted()
  apply(ctx, state.known)
  // Directories that have left the list stop being interesting; without this the cache would grow for
  // the life of the window.
  const covered = new Set(next)
  for (const path of state.known.keys()) {
    if (!covered.has(path)) state.known.delete(path)
  }
  const missing = next.filter((path) => !state.known.has(path))
  if (missing.length === 0) return
  state.abort?.abort()
  const controller = new AbortController()
  state.abort = controller
  sizes(missing, { signal: controller.signal })
    .then((result) => {
      if (controller.signal.aborted) return
      // Recorded for every path walked, with or without an answer: `sizes` omits a directory it could
      // not read rather than failing the batch, and "we tried" is what the UI needs to stop waiting.
      for (const path of missing) state.known.set(path, result.get(path))
      if (apply(ctx, state.known)) ctx.notifySized()
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
 * Already-measured sizes are kept: deleting one folder does not change the size of the others, so the
 * reconcile after the delete can show a correct total straight away instead of re-reading everything
 * that survived. The deleted directories drop out of the cache on that same reconcile, since they are
 * no longer in the list.
 */
export function pauseOrphanSizes(ctx: ProjectContext): void {
  const state = tracker(ctx)
  state.paused = true
  state.abort?.abort()
  state.abort = undefined
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
