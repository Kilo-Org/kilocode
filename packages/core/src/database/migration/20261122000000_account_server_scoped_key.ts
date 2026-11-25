// kilocode_change - new file
import { sql } from "drizzle-orm"
import { Effect } from "effect"
import { AccountV2 } from "../../account"
import { accountKey, normalizeServerUrl } from "../../account/key"
import type { DatabaseMigration } from "../migration"

/**
 * A stored address that cannot be normalized keeps its raw value, so the row survives the
 * migration and still receives a derived key from that raw address.
 */
const parse = (url: string): string => {
  try {
    return normalizeServerUrl(url)
  } catch {
    return url
  }
}

export default {
  id: "20261122000000_account_server_scoped_key",
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{ id: string; url: string }>(sql`SELECT \`id\`, \`url\` FROM \`account\``)
      if (rows.length === 0) return

      const active = yield* tx.get<{ active_account_id: string | null }>(
        sql`SELECT \`active_account_id\` FROM \`account_state\` WHERE \`id\` = 1`,
      )

      // account_state references account.id with no ON UPDATE action, so release the reference
      // before the parent key moves and restore it from the same mapping afterwards.
      if (active?.active_account_id) {
        yield* tx.run(sql`UPDATE \`account_state\` SET \`active_account_id\` = NULL WHERE \`id\` = 1`)
      }

      const keys = new Map<string, AccountV2.ID>()

      for (const row of rows) {
        const url = parse(row.url)
        const id = accountKey(url, row.id)
        keys.set(row.id, id)
        yield* tx.run(sql`UPDATE \`account\` SET \`id\` = ${id}, \`url\` = ${url} WHERE \`id\` = ${row.id}`)
      }

      const resumed = active?.active_account_id ? keys.get(active.active_account_id) : undefined
      if (resumed) {
        yield* tx.run(sql`UPDATE \`account_state\` SET \`active_account_id\` = ${resumed} WHERE \`id\` = 1`)
      }
    })
  },
} satisfies DatabaseMigration.Migration
