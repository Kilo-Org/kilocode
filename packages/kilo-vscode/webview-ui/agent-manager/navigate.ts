/**
 * Pure navigation logic for the agent manager sidebar.
 *
 * The sidebar has a fixed "local" item at index -1, followed by
 * session items at indices 0..N-1 (sorted newest-first).
 *
 * Returns the action to take: select a session by ID, go to local, or do nothing.
 */

/** Sentinel value for the local workspace selection. */
export const LOCAL = "local" as const

export type NavResult = { action: "select"; id: string } | { action: typeof LOCAL } | { action: "none" }

export function resolveNavigation(direction: "up" | "down", current: string | undefined, ids: string[]): NavResult {
  // Determine current position: -1 = local, 0..N-1 = session index
  if (!current) {
    // On local
    if (direction === "up") return { action: "none" }
    if (ids.length === 0) return { action: "none" }
    return { action: "select", id: ids[0]! }
  }

  const idx = ids.indexOf(current)
  // Current session not found in list — don't navigate
  if (idx === -1) return { action: "none" }

  const next = direction === "up" ? idx - 1 : idx + 1

  // Moving up past the first session → go to local
  if (next === -1) return { action: LOCAL }

  // At the bottom boundary
  if (next >= ids.length) return { action: "none" }

  return { action: "select", id: ids[next]! }
}

/**
 * Validate a persisted local session ID against the current sessions list.
 * Returns the ID if it still exists, undefined otherwise.
 */
export function validateLocalSession(persisted: string | undefined, ids: string[]): string | undefined {
  if (!persisted) return undefined
  if (ids.indexOf(persisted) === -1) return undefined
  return persisted
}

/**
 * After removing a worktree, pick the nearest remaining sidebar neighbor.
 * Order: the worktree just below → the one above → LOCAL.
 */
export function nextSelectionAfterDelete(deletedId: string, worktreeIds: string[]): typeof LOCAL | string {
  const idx = worktreeIds.indexOf(deletedId)
  if (idx === -1) return LOCAL
  const remaining = worktreeIds.filter((id) => id !== deletedId)
  if (remaining.length === 0) return LOCAL
  // Prefer the item that was below (same index in the shortened list), else the one above
  return remaining[Math.min(idx, remaining.length - 1)]!
}
