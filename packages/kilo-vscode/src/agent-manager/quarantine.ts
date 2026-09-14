/**
 * Per-worktree failure isolation for the polling loops.
 *
 * Without this, one permanently broken worktree degrades everything: its failures increment the
 * poller's single consecutive-failure counter, which backs off polling for every other worktree, and
 * it keeps spawning git/gh processes that cannot succeed. A worktree that repeatedly fails is parked
 * for a while and reported as unavailable; healthy neighbours keep their normal cadence.
 */

import { QUARANTINE_THRESHOLD, quarantineWindow } from "./command-budget"

type Entry = { failures: number; until: number }

export class Quarantine {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Record a failure. Returns true when this failure started or extended a quarantine. */
  fail(id: string): boolean {
    const entry = this.entries.get(id) ?? { failures: 0, until: 0 }
    entry.failures++
    this.entries.set(id, entry)
    if (entry.failures < QUARANTINE_THRESHOLD) return false
    entry.until = this.now() + quarantineWindow(entry.failures)
    return true
  }

  /** Forget a worktree's failure history after any success. */
  clear(id: string): void {
    this.entries.delete(id)
  }

  /** True while the worktree must not be polled. */
  blocked(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    if (entry.until === 0) return false
    if (this.now() < entry.until) return true
    // Window elapsed: allow one attempt through. A failure re-arms with a longer window, a success
    // clears the entry entirely.
    entry.until = 0
    return false
  }

  /** Consecutive failures recorded for a worktree. */
  failures(id: string): number {
    return this.entries.get(id)?.failures ?? 0
  }

  /** Drop entries for worktrees that no longer exist. */
  retain(ids: Set<string>): void {
    for (const id of [...this.entries.keys()]) {
      if (!ids.has(id)) this.entries.delete(id)
    }
  }

  reset(): void {
    this.entries.clear()
  }
}
