import { sql } from "drizzle-orm"
import { index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core"

// Covering index so recall search can resolve message roles without reading message rows.
export namespace RecallMessageIndex {
  export const name = "recall_message_role_idx"

  export const createSql = `CREATE INDEX IF NOT EXISTS \`${name}\` ON \`message\` (\`id\`,json_extract("data", '$.role'),coalesce(json_extract("data", '$.parentID'), ''));`

  export function make(table: { id: AnySQLiteColumn; data: AnySQLiteColumn }) {
    return index(name).on(
      table.id,
      sql`json_extract(${table.data}, '$.role')`,
      sql`coalesce(json_extract(${table.data}, '$.parentID'), '')`,
    )
  }
}
