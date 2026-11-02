import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Durable Continue-in-Cloud intent. One row per (account, operation key) holds
 * the exact validated Cloud request body (`prepared_json`) once, so every retry
 * and restart posts the same body without recomputing branch, model, or variant.
 *
 * The row never stores a token, API key, refresh token, cookie, auth seal, or
 * credential hash. `account_id` is the Kilo `user.id`, which is not a UUID.
 */
export const ContinuationIntentTable = sqliteTable(
  "kilo_continuation_intent",
  {
    account_id: text().notNull(),
    operation_key: text().notNull(),
    selection_json: text().notNull(),
    cloud_origin: text().notNull(),
    provider: text().notNull(),
    prepared_json: text().notNull(),
    created_at: integer().notNull(),
    expires_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.account_id, table.operation_key] })],
)
