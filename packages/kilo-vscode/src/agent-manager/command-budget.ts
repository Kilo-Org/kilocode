/**
 * Timeout budgets for the git/gh commands Agent Manager spawns while polling.
 *
 * One 30s-ish budget for everything is what let a single hanging command stall a whole poll cycle:
 * `git --version` and `gh pr view` are not the same kind of work and must not share a deadline.
 * Budgets are deliberately short — a poll that misses is retried, and a worktree that keeps missing
 * is quarantined and reported as unavailable rather than silently rendered as clean.
 */
export const BUDGET = {
  /** Metadata lookups that touch little more than `.git`: rev-parse, worktree list, --version. */
  probe: 5_000,
  /** Content reads that scale with the diff: diff, rev-list, ls-files, cat-file, show. */
  read: 15_000,
  /** Anything that talks to GitHub through `gh`. */
  gh: 10_000,
} as const

/**
 * Consecutive failures a single worktree may accumulate before it is skipped by pollers.
 *
 * This is also what makes the short budgets above safe: one timeout on a cold filesystem is not
 * proof of a broken worktree, so a worktree is only parked after it has failed repeatedly.
 */
export const QUARANTINE_THRESHOLD = 3

/** First quarantine window; doubles per additional failure up to {@link QUARANTINE_MAX}. */
export const QUARANTINE_BASE = 60_000

export const QUARANTINE_MAX = 30 * 60_000

/** Quarantine window for a worktree that has failed `failures` times in a row. */
export function quarantineWindow(failures: number): number {
  const over = Math.max(0, failures - QUARANTINE_THRESHOLD)
  return Math.min(QUARANTINE_MAX, QUARANTINE_BASE * 2 ** over)
}

/**
 * True when a command was killed for exceeding its budget.
 *
 * Node reports an `execFile` timeout as `killed: true` with `signal: "SIGTERM"` and a generic
 * "Command failed" message, so the text alone cannot be trusted; `GitOps` raises its own "timed out"
 * message instead. Both shapes are accepted, because misreading a timeout as a real error is how a
 * hanging command ends up reported as "gh is not installed".
 */
export function isTimeout(err: unknown): boolean {
  if (typeof err === "string") return /timed out/i.test(err)
  if (!(err instanceof Error)) return false
  const killed = err as Error & { killed?: boolean; signal?: NodeJS.Signals | null }
  if (killed.killed === true && (killed.signal === "SIGTERM" || killed.signal === "SIGKILL")) return true
  return /timed out/i.test(err.message)
}
