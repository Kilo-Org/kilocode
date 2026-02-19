/**
 * Pure navigation logic for the agent manager sidebar.
 *
 * The sidebar has a fixed "local" item at index -1, followed by
 * session items at indices 0..N-1 (sorted newest-first).
 *
 * Returns the action to take: select a session by ID, go to local, or do nothing.
 */

export type NavResult = { action: "select"; id: string } | { action: "local" } | { action: "none" }

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
  if (next === -1) return { action: "local" }

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
