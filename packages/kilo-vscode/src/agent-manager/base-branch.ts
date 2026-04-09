/**
 * Pure logic for resolving the effective base branch.
 *
 * Priority chain:
 *   1. Explicit (per-worktree override, from dialog)
 *   2. Configured default (persisted in agent-manager.json), if it still exists
 *   3. Auto-detect (undefined → WorktreeManager.defaultBranch() at call site)
 */

/** Trim whitespace, return undefined for empty/blank. */
export function normalizeBaseBranch(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Pick the effective base branch given an explicit override, a configured
 * default, and whether that configured branch still exists in the repo.
 *
 * Returns `{ branch }` with the winner, and optionally `{ stale }` when the
 * configured branch no longer exists (so the caller can clear it).
 */
export function chooseBaseBranch(opts: { explicit?: string; configured?: string; configuredExists?: boolean }): {
  branch?: string
  stale?: string
} {
  if (opts.explicit) return { branch: opts.explicit }
  if (opts.configured) {
    if (opts.configuredExists) return { branch: opts.configured }
    return { stale: opts.configured }
  }
  return {}
}
