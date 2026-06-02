import { sql } from "drizzle-orm"
import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ExportEventTypes } from "../envelope"

export const EventTable = sqliteTable(
  "event",
  {
    id: text().primaryKey(),
    schema_version: integer().notNull().default(1),
    session_id: text().notNull(),
    root_session_id: text().notNull(),
    parent_session_id: text(),
    seq: integer().notNull(),
    request_id: text(),
    type: text({ enum: ExportEventTypes }).notNull(),
    ts: integer().notNull(),
    agent_version: text().notNull(),
    data_json: text().notNull(),
    client_scrubbed: integer().notNull().default(1),
    uploaded_at: integer(),
    upload_attempts: integer().notNull().default(0),
    next_attempt_at: integer(),
  },
  (t) => [
    index("event_session_seq").on(t.session_id, t.seq),
    index("event_pending")
      .on(t.uploaded_at, t.next_attempt_at)
      .where(sql`${t.uploaded_at} IS NULL`),
  ],
)

export const ChunkTable = sqliteTable("chunk", {
  id: text().primaryKey(),
  bytes: blob({ mode: "buffer" }).notNull(),
  size: integer().notNull(),
  encoding: text({ enum: ["zstd"] }).notNull(),
  ref_count: integer().notNull(),
  uploaded_at: integer(),
})
