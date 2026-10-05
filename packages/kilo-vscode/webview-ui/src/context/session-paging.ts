import { createSignal, type Accessor } from "solid-js"
import type { SessionInfo } from "../types/messages"

interface SessionPaging {
  hasMore: Accessor<boolean>
  loadingMore: Accessor<boolean>
  loadMore: () => void
  finish: (hasMore: boolean) => void
  keep: (ids: Accessor<readonly string[]>) => () => void
  open: () => string[]
}

/**
 * Owns the "load more" state for the local history list and posts the paging
 * request. `keep` registers the sidebar's open tabs, which a partial full load
 * must leave in the store. Kept outside the session context so the large
 * context file stays within its line cap.
 */
export function createSessionPaging(
  post: (message: { type: "loadSessions"; more?: boolean }) => void,
  connected: () => boolean,
): SessionPaging {
  const [hasMore, setHasMore] = createSignal(false)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const loadMore = () => {
    if (!connected() || !hasMore() || loadingMore()) return
    setLoadingMore(true)
    post({ type: "loadSessions", more: true })
  }
  const finish = (more: boolean) => {
    setHasMore(more)
    setLoadingMore(false)
  }
  const tabs = new Set<Accessor<readonly string[]>>()
  const keep = (ids: Accessor<readonly string[]>) => {
    tabs.add(ids)
    return () => {
      tabs.delete(ids)
    }
  }
  const open = () => [...tabs].flatMap((ids) => [...ids()])
  return { hasMore, loadingMore, loadMore, finish, keep, open }
}

/**
 * Whether a `sessionsLoaded` message lists every session. An appended page, or
 * a first page with more pages behind it, leaves out older sessions, so a
 * session missing from it may still exist.
 */
export function complete(message: { append?: boolean; hasMore?: boolean }): boolean {
  return !message.append && !message.hasMore
}

/**
 * Apply one `sessionsLoaded` message. A full load reconciles the store and
 * drops sessions that are no longer listed; an appended page only adds older
 * sessions and must never delete. When the full load has more pages behind
 * it, sessions open in the UI (`open`) stay, since they may come from an
 * older page.
 */
export function mergeSessionsLoaded(input: {
  loaded: SessionInfo[]
  preserve?: string[]
  append?: boolean
  hasMore?: boolean
  open?: Iterable<string>
  fresh: Set<string>
  setSessions: (updater: (sessions: Record<string, SessionInfo>) => void) => void
}): void {
  const ids = new Set(input.loaded.map((session) => session.id))
  for (const id of ids) input.fresh.delete(id)
  const open = complete(input) ? [] : [...(input.open ?? [])]
  const kept = new Set([...(input.preserve ?? []), ...input.fresh, ...open])
  input.setSessions((sessions) => {
    if (!input.append) {
      for (const id of Object.keys(sessions)) {
        if (id.startsWith("cloud:")) continue
        if (kept.has(id)) continue
        if (!ids.has(id)) delete sessions[id]
      }
    }
    for (const session of input.loaded) sessions[session.id] = session
  })
}
