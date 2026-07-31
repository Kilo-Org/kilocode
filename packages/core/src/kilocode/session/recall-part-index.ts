import { sql } from "drizzle-orm"
import { index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core"

export namespace RecallPartIndex {
  export function make(table: {
    session_id: AnySQLiteColumn
    id: AnySQLiteColumn
    message_id: AnySQLiteColumn
    data: AnySQLiteColumn
  }) {
    return index("recall_part_search_idx")
      .on(
        table.session_id,
        table.id,
        table.message_id,
        sql`json_extract(${table.data}, '$.type')`,
        sql`CASE WHEN json_extract(${table.data}, '$.type') = 'text' THEN coalesce(json_extract(${table.data}, '$.text'), '') WHEN json_extract(${table.data}, '$.type') = 'file' THEN trim(coalesce(json_extract(${table.data}, '$.filename'), '') || ' ' || CASE WHEN coalesce(json_extract(${table.data}, '$.url'), '') NOT LIKE 'data:%' THEN coalesce(json_extract(${table.data}, '$.url'), '') ELSE '' END || ' ' || coalesce(json_extract(${table.data}, '$.source.path'), '') || ' ' || coalesce(json_extract(${table.data}, '$.source.name'), '') || ' ' || CASE WHEN coalesce(json_extract(${table.data}, '$.source.uri'), '') NOT LIKE 'data:%' THEN coalesce(json_extract(${table.data}, '$.source.uri'), '') ELSE '' END || ' ' || coalesce(json_extract(${table.data}, '$.source.clientName'), '')) ELSE coalesce(json_extract(${table.data}, '$.state.error'), '') END`,
      )
      .where(
        sql`json_valid(${table.data}) AND ((json_extract(${table.data}, '$.type') = 'text' AND coalesce(json_extract(${table.data}, '$.synthetic'), 0) = 0 AND coalesce(json_extract(${table.data}, '$.ignored'), 0) = 0) OR json_extract(${table.data}, '$.type') = 'file' OR (json_extract(${table.data}, '$.type') = 'tool' AND json_extract(${table.data}, '$.state.status') = 'error'))`,
      )
  }
}
