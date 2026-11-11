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

/** Rendered scopes in a stable order, and the same scopes from least to most recently used. */
export type BrowserScopes = { entries: string[]; recent: string[] }

/**
 * Mark a scope as used and evict the least recently used scopes beyond `max`. A known scope keeps its place in
 * `entries`, because the panel renders that list and moving a retained DevTools iframe in the DOM reloads it.
 */
export function rememberBrowserScope(
  scopes: BrowserScopes,
  entry: string,
  max: number = BROWSER_CACHE_SIZE,
): BrowserScopes {
  const recent = [...scopes.recent.filter((value) => value !== entry), entry].slice(-max)
  const entries = scopes.entries.includes(entry) ? scopes.entries : [...scopes.entries, entry]
  if (entries.length === recent.length && scopes.recent.at(-1) === entry) return scopes
  return { entries: entries.filter((value) => recent.includes(value)), recent }
}

/**
 * Drop entries whose session is gone from the active project. Entries for other
 * projects are kept so returning to a project restores its preserved pages.
 */
export function evictBrowserScopes(
  scopes: BrowserScopes,
  known: Set<string>,
  project: string | undefined,
  keep?: string,
): BrowserScopes {
  const active = project ?? "single"
  const retained = (entry: string) => {
    if (entry === keep) return true
    const parts = browserScopeParts(entry)
    return parts.project !== active || known.has(parts.session)
  }
  if (scopes.entries.every(retained)) return scopes
  return { entries: scopes.entries.filter(retained), recent: scopes.recent.filter(retained) }
}
