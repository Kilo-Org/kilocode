import { Effect } from "effect"

type Project = {
  readonly id: string
  readonly worktree: string
  readonly sandboxes?: readonly string[]
}

/**
 * Drop projects whose recorded directories are all gone.
 *
 * A removed checkout leaves its row behind, and the console then offered a
 * project that can never be opened. A project stays visible while any of its
 * directories exists: its worktree or one of its sandboxes (linked
 * worktrees). The global id is not exempt, so a removed git checkout that
 * resolved to it is dropped as well.
 */
export function prune<A extends Project>(
  items: readonly A[],
  exists: (path: string) => Effect.Effect<boolean>,
): Effect.Effect<A[]> {
  const dirs = (item: A) => [item.worktree, ...(item.sandboxes ?? [])]
  const present = (item: A) =>
    Effect.forEach(dirs(item), (dir) => exists(dir), { concurrency: "unbounded" }).pipe(
      Effect.map((found) => found.some(Boolean)),
    )
  return Effect.forEach(
    items,
    (item) => present(item).pipe(Effect.map((ok) => (ok ? item : undefined))),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((rows) => rows.filter((row): row is A => row !== undefined)))
}
