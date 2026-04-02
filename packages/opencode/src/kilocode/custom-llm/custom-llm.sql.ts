import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const CustomLlm2Table = sqliteTable("custom_llm2", {
  id: text().primaryKey(),
  name: text().notNull(),
  config: text().notNull(),
  ...Timestamps,
})
