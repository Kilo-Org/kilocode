/**
 * Reconciles the three views of a worktree that drift apart over time: the row in
 * `.kilo/agent-manager.json`, the entry in `git worktree list`, and the directory on disk.
 *
 * Drift is normal — users delete worktrees by hand, `git worktree prune` runs elsewhere, branches
 * get deleted after a merge. What is not acceptable is polling paths that cannot answer, reporting
 * a failed probe as an empty diff, or claiming git is missing because a directory is.
 *
 * Metadata is the only thing this module ever mutates, and only in the one case where nothing can
 * be lost: the directory is gone, the branch is gone, and no session refers to it. Everything else
 * is classified, reported, and left for the user to act on. No file is ever deleted here.
 *
 * Pure orchestration — no vscode imports, all IO injected.
 */

import * as path from "path"
import { pathKey } from "./project/paths"

export type WorktreeHealth =
  /** Directory exists and git still tracks it. The only state that gets polled. */
  | "ok"
  /** Directory is gone but the branch survives, so the worktree can be recreated. */
  | "absent-restorable"
  /** Directory and branch are both gone. */
  | "absent-gone"
  /** Directory exists, but git no longer tracks it — usually a hand-deleted `.git/worktrees` entry. */
  | "unregistered"
  /** Health could not be determined. Never a reason to mutate or to render as clean. */
  | "unavailable"

export type WorktreeHealthEntry = {
  id: string
  path: string
  branch: string
  health: WorktreeHealth
  /** How many sessions still point at this worktree. */
  sessions: number
}

/** A directory under `.kilo/worktrees/` that no state row and no git entry claims. */
export type OrphanDirectory = {
  path: string
  /** `broken` still has a `.git` file; `leftover` is a bare directory, e.g. only `.kilo-dev/`. */
  kind: "broken" | "leftover"
  /** Apparent size in bytes, filled in asynchronously by orphans/sizing.ts. Absent until it lands. */
  bytes?: number
  /**
   * True once a size pass has finished with this directory, whether or not it produced a number.
   *
   * `bytes` alone cannot answer "is a size still coming?": a directory that could not be walked
   * (permissions, or it vanished mid-pass) never gets one, and the UI would otherwise claim to be
   * calculating forever. `sized` without `bytes` means the answer is in and it is "unknown".
   */
  sized?: boolean
}

export type WorktreeHealthReport = {
  entries: WorktreeHealthEntry[]
  orphans: OrphanDirectory[]
  /** State rows dropped automatically, by id. */
  dropped: string[]
  /** True when `git worktree prune` ran this pass. */
  pruned: boolean
  /**
   * True when enumeration itself failed. Every entry is `unavailable`, nothing was mutated, and the
   * caller must not treat any worktree as stale.
   */
  degraded: boolean
}

export interface ReconcileDeps {
  /** Repository root; relative state paths resolve against it. */
  root: string
  /** Absolute `.kilo/worktrees` directory that {@link ReconcileDeps.dirs} lists. */
  dir: string
  /** State rows to classify. */
  rows: () => { id: string; path: string; branch: string }[]
  /** Session count for a worktree id. */
  sessions: (id: string) => number
  /** Normalized paths git currently tracks, or undefined when the listing failed. */
  registered: () => Promise<Set<string> | undefined>
  /** Directory names directly under `.kilo/worktrees/`, excluding temp dirs. */
  dirs: () => Promise<string[]>
  exists: (target: string) => Promise<boolean>
  branchExists: (branch: string) => Promise<boolean>
  /** `git worktree prune`; called at most once per pass. */
  prune: () => Promise<void>
  /** Remove a state row. Only ever called for `absent-gone` rows with no sessions. */
  drop: (id: string) => void
  log: (msg: string) => void
}

function resolve(root: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(root, target)
}

function degraded(rows: { id: string; path: string; branch: string }[], sessions: (id: string) => number) {
  return rows.map((row) => ({
    id: row.id,
    path: row.path,
    branch: row.branch,
    health: "unavailable" as const,
    sessions: sessions(row.id),
  }))
}

/**
 * Classify every tracked worktree and every directory under `.kilo/worktrees/`, prune stale git
 * metadata once when something is actually stale, and drop only the state rows that cannot lose
 * anything. Returns the report the UI and the diagnostics command both render.
 */
export async function reconcileWorktrees(deps: ReconcileDeps): Promise<WorktreeHealthReport> {
  const rows = deps.rows()
  const registered = await deps.registered()
  if (!registered) {
    deps.log("worktree health: could not list git worktrees, skipping reconcile")
    return { entries: degraded(rows, deps.sessions), orphans: [], dropped: [], pruned: false, degraded: true }
  }

  const entries: WorktreeHealthEntry[] = []
  const claimed = new Set<string>()
  for (const row of rows) {
    const abs = resolve(deps.root, row.path)
    claimed.add(pathKey(abs))
    const present = await deps.exists(abs)
    const health = await (async (): Promise<WorktreeHealth> => {
      if (present) return registered.has(pathKey(abs)) ? "ok" : "unregistered"
      return (await deps.branchExists(row.branch)) ? "absent-restorable" : "absent-gone"
    })()
    entries.push({ id: row.id, path: abs, branch: row.branch, health, sessions: deps.sessions(row.id) })
  }

  // One prune per pass, and only when a tracked directory really did vanish. Pruning on every
  // startup would spend a git invocation to discover there is nothing to do.
  const stale = entries.some((entry) => entry.health === "absent-restorable" || entry.health === "absent-gone")
  if (stale) await deps.prune()

  const dropped: string[] = []
  for (const entry of entries) {
    if (entry.health !== "absent-gone") continue
    // Re-read the session count: `deps.drop` deletes every session on the row, and a session could
    // have been attached during the awaits above (classification, prune) since it was counted.
    if (entry.sessions > 0 || deps.sessions(entry.id) > 0) continue
    deps.log(`worktree health: dropping ${entry.id} (${entry.path}, branch ${entry.branch} gone, no sessions)`)
    deps.drop(entry.id)
    dropped.push(entry.id)
  }

  const candidates: string[] = []
  for (const name of await deps.dirs()) {
    const abs = path.join(deps.dir, name)
    const key = pathKey(abs)
    if (claimed.has(key) || registered.has(key)) continue
    candidates.push(abs)
  }

  // The registration snapshot is older than the directory listing by every await above, and
  // `.kilo/worktrees/` is written by more than this reconcile: the worktree pool creates and removes
  // slot checkouts on a timer, and a create can land mid-pass. A directory that git registered in
  // the meantime is not an orphan, so candidates are checked against a fresh listing rather than
  // reported from a stale one — otherwise a slot the pool just built is offered for deletion, and
  // the fail-closed re-check in removeOrphanDirectory turns that offer into an error.
  const orphans: OrphanDirectory[] = []
  const current = candidates.length > 0 ? await deps.registered() : registered
  if (!current) deps.log("worktree health: could not re-check git worktrees, reporting no orphans")
  for (const abs of candidates) {
    // An unanswerable re-check is not evidence that nothing owns the directory.
    if (!current || current.has(pathKey(abs))) continue
    const kind = (await deps.exists(path.join(abs, ".git"))) ? "broken" : "leftover"
    orphans.push({ path: abs, kind })
  }

  if (orphans.length > 0) {
    deps.log(`worktree health: ${orphans.length} orphaned directory(ies) under .kilo/worktrees (not removed)`)
  }
  return { entries, orphans, dropped, pruned: stale, degraded: false }
}

/**
 * True for the health states that really do block a worktree from answering a git or gh query.
 *
 * `unavailable` is deliberately excluded: a single failed `git worktree list` marks every row
 * `unavailable`, and that means "we could not check", not "the worktree is broken". Treating it as
 * broken would pause polling for the rest of the session and offer destructive recovery actions for
 * a worktree that is almost certainly fine.
 */
export function broken(health: WorktreeHealth): boolean {
  return health !== "ok" && health !== "unavailable"
}

/** Worktrees that must not be polled: they cannot answer, or answering would be misleading. */
export function unhealthy(report: WorktreeHealthReport): Set<string> {
  const ids = new Set<string>()
  for (const entry of report.entries) {
    if (broken(entry.health)) ids.add(entry.id)
  }
  return ids
}

/** One-line-per-worktree summary shared by the log and the diagnostics report. */
export function summarize(report: WorktreeHealthReport): string {
  const counts = new Map<WorktreeHealth, number>()
  for (const entry of report.entries) counts.set(entry.health, (counts.get(entry.health) ?? 0) + 1)
  const parts = [...counts.entries()].map(([health, count]) => `${health}=${count}`)
  parts.push(`orphans=${report.orphans.length}`)
  if (report.dropped.length > 0) parts.push(`dropped=${report.dropped.length}`)
  if (report.pruned) parts.push("pruned")
  if (report.degraded) parts.push("degraded")
  return parts.join(" ")
}
