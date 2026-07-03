/**
 * Tracks cloud-import message IDs awaiting parts cleanup. During preview,
 * parts are stored keyed by original cloud message IDs (store.parts["<cloud-msg-id>"]).
 * On import, the carried-over messages keep those IDs until handleMessagesLoaded
 * replaces them with server-assigned IDs. Once the carried-over messages are gone
 * from store.messages, their parts are orphans — pruneCloudOrphans drops them so
 * preview -> import cycles don't accumulate full transcripts in the reactive store.
 */
import type { Part } from "../types/messages"

export interface PruneStash {
  remove: (id: string) => void
}

export const createCloudPrune = (
  setParts: (mutator: (parts: Record<string, Part[]>) => void) => void,
  stash: PruneStash,
) => {
  const pendingCloudPrune = new Map<string, Set<string>>()

  const prune = (key: string) => {
    const ids = pendingCloudPrune.get(key)
    if (!ids) return
    setParts((parts) => {
      for (const id of ids) delete parts[id]
    })
    for (const id of ids) stash.remove(id)
    pendingCloudPrune.delete(key)
  }

  return { pendingCloudPrune, prune }
}

/** Clear a scope only if it still points at the given key. Async failure paths
 * must not clobber scopes the user has navigated to since the operation was
 * started. */
export function clearIfOn<T>(get: () => T, clear: () => void, key: T) {
  if (get() === key) clear()
}
