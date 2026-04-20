/**
 * PartStash holds message parts outside the reactive Solid store until a
 * turn is actually rendered by the virtualizer. Writing parts for off-screen
 * messages into the reactive store triggers expensive DOM work for invisible
 * content — parking them here keeps initial-load churn cheap.
 *
 * The stash lives alongside (not inside) the reactive store. Every lifecycle
 * event that invalidates a message must reach both the store and the stash.
 * Centralising stash access behind this helper keeps that invariant easy to
 * audit (and easy to unit-test, since the store is Solid-specific).
 */
import type { Part } from "../types/messages"

export class PartStash {
  private map = new Map<string, Part[]>()

  /** Stash parts for a message that hasn't been rendered yet. */
  put(messageID: string, parts: Part[]): void {
    this.map.set(messageID, parts)
  }

  /** Read without consuming. Returns `undefined` if absent. */
  peek(messageID: string): Part[] | undefined {
    return this.map.get(messageID)
  }

  /**
   * Invalidate any stashed parts for a message. Callers MUST invoke this in
   * every path that removes a message from state (messageRemoved,
   * sendMessageFailed, sessionDeleted) or promotes it into the reactive
   * store (messageCreated, partUpdated, hydrateParts). Missing a call here
   * leaks memory and, worse, can resurface stale parts via `peek()` after
   * the message is gone.
   */
  remove(messageID: string): void {
    this.map.delete(messageID)
  }

  /**
   * Collect parts for the given IDs, consuming the stash. Used by the
   * virtualizer when a turn is about to render: the returned parts should
   * be written to the reactive store atomically by the caller.
   *
   * IDs already present in the reactive store are skipped — pass an optional
   * `isHydrated` predicate for that check.
   */
  take(ids: string[], isHydrated?: (id: string) => boolean): Record<string, Part[]> {
    const out: Record<string, Part[]> = {}
    for (const id of ids) {
      if (isHydrated?.(id)) continue
      const parts = this.map.get(id)
      if (!parts) continue
      out[id] = parts
      this.map.delete(id)
    }
    return out
  }

  /** Diagnostics and tests only. */
  size(): number {
    return this.map.size
  }
}
