import { Database } from "@opencode-ai/core/database/database"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
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
  export const denies = Effect.fn("KiloHeadless.denies")(function* (id: string) {
    if (roots.size === 0) return false
    if (roots.has(id)) return false
    const { db } = yield* Database.Service
    const ancestors = yield* db
      .all<{ id: SessionID }>(sql`
        WITH RECURSIVE ancestor(id) AS (
          SELECT parent_id
          FROM session
          WHERE id = ${id} AND parent_id IS NOT NULL

          UNION

          SELECT session.parent_id
          FROM session
          JOIN ancestor ON session.id = ancestor.id
          WHERE session.parent_id IS NOT NULL
        )
        SELECT id FROM ancestor`)
      .pipe(Effect.orDie)
    return ancestors.some((item) => roots.has(item.id))
  })
}
