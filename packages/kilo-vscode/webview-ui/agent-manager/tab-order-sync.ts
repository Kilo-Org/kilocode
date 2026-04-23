/**
 * Factory for tab-order mutations used when sessions/terminals are created,
 * a pending tab is promoted to a real session id, or a session is forked.
 *
 * Exists as a separate module to keep the tab-order branching out of
 * AgentManagerApp's main message-handler arrow (complexity cap).
 */
import { replaceInTabOrder, insertInTabOrderAfter } from "./tab-order"

export interface TabOrderSyncDeps {
  /** Constants that identify the local context and review tab. */
  LOCAL: string
  REVIEW_TAB_ID: string
  /** Read/update the `contextKey → ordered tab ids` map (in-memory). */
  order: () => Record<string, string[]>
  setOrder: (updater: (prev: Record<string, string[]>) => Record<string, string[]>) => void
  /** Persist to durable state. Callers should strip transient ids here. */
  persist: (key: string, value: string[]) => void
  /** State accessors used to rebuild the base order `[sessions, review, terminals]`. */
  localSessionIDs: () => string[]
  sessions: () => { id: string; createdAt: string }[]
  managedSessions: () => { id: string; worktreeId?: string | null }[]
  reviewOpenByContext: () => Record<string, boolean>
  terminalIdsFor: (key: string) => string[]
}

export function createTabOrderSync(deps: TabOrderSyncDeps) {
  const baseFor = (key: string): string[] => {
    const sids =
      key === deps.LOCAL
        ? deps.localSessionIDs()
        : deps
            .sessions()
            .filter((s) => deps.managedSessions().some((ms) => ms.id === s.id && ms.worktreeId === key))
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((s) => s.id)
    const withReview = deps.reviewOpenByContext()[key] === true ? [...sids, deps.REVIEW_TAB_ID] : sids
    return [...withReview, ...deps.terminalIdsFor(key)]
  }

  const commit = (key: string, next: string[]) => {
    deps.setOrder((prev) => ({ ...prev, [key]: next }))
    deps.persist(key, next)
  }

  const resolve = (key: string | undefined): string => key ?? deps.LOCAL

  // Merge stored + any base ids not yet in stored — mirrors `applyTabOrder`'s
  // output so we can pin `id` at a specific rendered position (tail for
  // append, right-of-anchor for insertAfter) regardless of whether the
  // caller already mutated source state (localSessionIDs, terms, etc).
  const merge = (key: string): string[] => {
    const stored = deps.order()[key] ?? []
    const set = new Set(stored)
    const unknowns = baseFor(key).filter((x) => !set.has(x))
    return [...stored, ...unknowns]
  }

  return {
    /** Place `id` at the tail of the persisted order for `key`. */
    append(key: string | undefined, id: string) {
      const k = resolve(key)
      const rest = merge(k).filter((x) => x !== id)
      commit(k, [...rest, id])
    },
    /** Swap `oldId` for `newId` preserving position, or append if missing. */
    replaceOrAppend(key: string | undefined, oldId: string, newId: string) {
      const k = resolve(key)
      const stored = deps.order()[k] ?? []
      const swapped = replaceInTabOrder(stored, oldId, newId)
      if (swapped) return commit(k, swapped)
      const rest = merge(k).filter((x) => x !== newId)
      commit(k, [...rest, newId])
    },
    /** Place `id` directly after `anchorId`; append if anchor is missing. */
    insertAfter(key: string | undefined, anchorId: string, id: string) {
      const k = resolve(key)
      const rest = merge(k).filter((x) => x !== id)
      const next = insertInTabOrderAfter(rest, anchorId, id)
      commit(k, next)
    },
  }
}
