import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../../session/sql"

export const BoardTable = sqliteTable("kilo_board", {
  root_session_id: text()
    .notNull()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  objective: text().notNull(),
  objective_message_id: text(),
  next_seq: integer().notNull().default(1),
  cleared_seq: integer().notNull().default(0),
  message_count: integer().notNull().default(0),
  message_bytes: integer().notNull().default(0),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
})

export const BoardMessageTable = sqliteTable(
  "kilo_board_message",
  {
    id: text().notNull().primaryKey(),
    board_root_session_id: text()
      .notNull()
      .references(() => BoardTable.root_session_id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    time_created: integer().notNull(),
    sender_session_id: text().notNull(),
    recipient: text().notNull(),
    type: text().notNull(),
    body: text().notNull(),
    reply_to: text(),
    source_message_id: text().notNull(),
    source_call_id: text().notNull(),
  },
  (table) => [uniqueIndex("kilo_board_message_board_seq_idx").on(table.board_root_session_id, table.seq)],
)
