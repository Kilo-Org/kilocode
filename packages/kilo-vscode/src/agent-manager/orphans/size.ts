/**
 * Apparent on-disk size for orphaned worktree directories.
 *
 * Walks each path with `opendir`, summing `lstat` sizes for regular files only. Symlinks are
 * skipped outright — never followed — so a broken or cyclic link cannot inflate the total or hang
 * the walk. A directory that cannot be read (permissions, mid-flight deletion by the worktree pool)
 * is simply omitted from the result: sizing is a UI nicety, never a reason to block or fail the
 * orphan report it annotates.
 *
 * No vscode imports — pure fs, callable from the reconcile pass or a test.
 */

import * as fs from "fs"
import * as path from "path"

async function readInto(dir: string, pending: string[], signal: AbortSignal | undefined): Promise<number> {
  let total = 0
  const entries = await fs.promises.opendir(dir)
  for await (const entry of entries) {
    if (signal?.aborted) break
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      pending.push(full)
      continue
    }
    if (!entry.isFile()) continue
    const stat = await fs.promises.lstat(full).catch(() => undefined)
    if (stat) total += stat.size
  }
  return total
}

async function walk(root: string, signal?: AbortSignal): Promise<number> {
  const pending: string[] = []
  // The root itself has to be readable, or this path fails outright and the caller omits it — this
  // call is deliberately not wrapped in a try/catch.
  let total = await readInto(root, pending, signal)
  while (pending.length > 0) {
    if (signal?.aborted) return total
    const dir = pending.pop()
    if (dir === undefined) break
    // A subdirectory discovered underneath the root is different: `opendir` can resolve for a
    // directory the process cannot actually scan (Node defers the real `scandir` syscall to the
    // first read, which throws out of the `for await` inside `readInto` rather than out of
    // `opendir` itself), and a permission error partway through the tree should only drop that
    // subtree, not the whole walk.
    total += await readInto(dir, pending, signal).catch(() => 0)
  }
  return total
}

/**
 * Total apparent size of each path, walked with bounded concurrency.
 *
 * A path that fails outright — gone before the walk starts, unreadable throughout — is omitted
 * from the returned map rather than throwing, so one bad orphan can never block the size of the
 * rest. Aborting `signal` stops new work quickly; a walk already in flight for one path finishes
 * its current directory rather than being torn down mid-read.
 */
export async function sizes(
  paths: string[],
  opts: { signal?: AbortSignal; concurrency?: number } = {},
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const queue = [...paths]
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, queue.length || 1))
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      if (opts.signal?.aborted) return
      const target = queue.shift()
      if (target === undefined) return
      const bytes = await walk(target, opts.signal).catch(() => undefined)
      if (bytes !== undefined && !opts.signal?.aborted) result.set(target, bytes)
    }
  })
  await Promise.all(workers)
  return result
}
