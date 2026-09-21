import { createSignal, type Accessor } from "solid-js"
import type { SessionInfo } from "../types/messages"

interface SessionPaging {
  hasMore: Accessor<boolean>
  loadingMore: Accessor<boolean>
  loadMore: () => void
  finish: (hasMore: boolean) => void
}

/**
 * Owns the "load more" state for the local history list and posts the paging
 * request. Kept outside the session context so the large context file stays
 * within its line cap.
 */
export function createSessionPaging(
  post: (message: { type: "loadMoreSessions" }) => void,
  connected: () => boolean,
): SessionPaging {
  const [hasMore, setHasMore] = createSignal(false)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const loadMore = () => {
    if (!connected() || !hasMore() || loadingMore()) return
    setLoadingMore(true)
    post({ type: "loadMoreSessions" })
  }
  const finish = (more: boolean) => {
    setHasMore(more)
    setLoadingMore(false)
  }
  return { hasMore, loadingMore, loadMore, finish }
}

/**
 * Apply one `sessionsLoaded` message. A full load reconciles the store and
 * drops sessions that are no longer listed; an appended page only adds older
 * sessions and must never delete.
 */
export function mergeSessionsLoaded(input: {
  loaded: SessionInfo[]
  preserve?: string[]
  append?: boolean
  fresh: Set<string>
  setSessions: (updater: (sessions: Record<string, SessionInfo>) => void) => void
}): void {
  const ids = new Set(input.loaded.map((session) => session.id))
  for (const id of ids) input.fresh.delete(id)
  const kept = new Set([...(input.preserve ?? []), ...input.fresh])
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
