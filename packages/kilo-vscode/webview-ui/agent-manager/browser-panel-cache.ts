/**
 * Bookkeeping for the Agent Manager browser panel cache.
 *
 * The browser panel keeps one iframe alive per browser scope so switching to
 * another worktree, project, or session and back does not reload the loaded
 * page. Entries are keyed by project and session; the pure helpers below are
 * extracted so the retention rules stay unit testable.
 */

export const BROWSER_CACHE_SIZE = 8

export function browserScopeKey(project: string | undefined, session: string): string {
  return `${project ?? "single"}\0${session}`
}

export function browserScopeParts(entry: string): { project: string; session: string } {
  const at = entry.indexOf("\0")
  return { project: entry.slice(0, at), session: entry.slice(at + 1) }
}

/** Append a scope, keeping the most recently used entries within `max`. */
export function rememberBrowserScope(entries: string[], entry: string, max: number = BROWSER_CACHE_SIZE): string[] {
  if (entries.includes(entry)) return entries
  const next = [...entries, entry]
  return next.length > max ? next.slice(next.length - max) : next
}

/**
 * Drop entries whose session is gone from the active project. Entries for other
 * projects are kept so returning to a project restores its preserved pages.
 */
export function evictBrowserScopes(
  entries: string[],
  known: Set<string>,
  project: string | undefined,
  keep?: string,
): string[] {
  const active = project ?? "single"
  return entries.filter((entry) => {
    if (entry === keep) return true
    const parts = browserScopeParts(entry)
    return parts.project !== active || known.has(parts.session)
  })
}
