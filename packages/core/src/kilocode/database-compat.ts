import { Effect } from "effect"
import type { Database } from "../database/database"

type Db = Database.Interface["db"]

export function ensure(db: Db) {
  return db.transaction(
    (tx) =>
      Effect.gen(function* () {
        const rows = yield* tx.all<{ name: string }>("PRAGMA table_info('session_context_epoch')")
        const names = new Set(rows.map((row) => row.name))

        if (!names.has("agent"))
          yield* tx.run("ALTER TABLE `session_context_epoch` ADD `agent` text DEFAULT 'build' NOT NULL")
        if (!names.has("replacement_seq"))
          yield* tx.run("ALTER TABLE `session_context_epoch` ADD `replacement_seq` integer")
        if (!names.has("revision"))
          yield* tx.run("ALTER TABLE `session_context_epoch` ADD `revision` integer DEFAULT 0 NOT NULL")
      }),
    { behavior: "immediate" },
  )
}
