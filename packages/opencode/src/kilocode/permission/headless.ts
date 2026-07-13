import { Database, eq } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"

/**
 * Headless roots (#11903).
 *
 * Root sessions driven by a client that cannot answer subagent permission
 * prompts (plain `kilo run`). Permission asks originating from their child
 * sessions must fail with DeniedError instead of blocking forever on a reply
 * that never comes. Interactive clients (TUI, extension) never mark sessions
 * here, so their subagent prompts stay answerable.
 */
export namespace KiloHeadless {
  const roots = new Set<string>()

  export function mark(id: string) {
    roots.add(id)
  }

  export function clear(id: string) {
    roots.delete(id)
  }

  /** True when `id` is a subagent session whose root run has no attached human. */
  export function denies(id: string): boolean {
    if (roots.size === 0) return false
    if (roots.has(id)) return false
    for (let parent = lookup(id); parent; parent = lookup(parent)) {
      if (roots.has(parent)) return true
    }
    return false
  }

  function lookup(id: string) {
    const row = Database.use((db) =>
      db
        .select({ parent: SessionTable.parent_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, id as SessionID))
        .get(),
    )
    return row?.parent ?? undefined
  }
}
