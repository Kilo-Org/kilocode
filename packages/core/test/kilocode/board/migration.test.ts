import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import boardMigration from "@opencode-ai/core/database/migration/20260828074139_kilocode_board"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"

const make = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

describe("board migration", () => {
  test("creates board tables and cascades only from the root", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* make
        yield* DatabaseMigration.apply(db)
        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kilo_board'`)).toEqual(
          {
            name: "kilo_board",
          },
        )
        expect(
          yield* db.get(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kilo_board_message'`),
        ).toEqual({ name: "kilo_board_message" })
        expect(yield* db.all(sql`PRAGMA foreign_key_list('kilo_board_message')`)).toMatchObject([
          { table: "kilo_board", on_delete: "CASCADE" },
        ])
        expect(yield* db.all(sql`PRAGMA foreign_key_list('kilo_board')`)).toMatchObject([
          { table: "session", on_delete: "CASCADE" },
        ])
        expect(migrations.at(-1)?.id).toContain("kilocode_board")
      }),
    )
  })

  test("adds board tables to an existing session database", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* make
        yield* db.run(sql`CREATE TABLE project (id text PRIMARY KEY)`)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY, project_id text)`)
        yield* db.run(sql`INSERT INTO project (id) VALUES ('project')`)
        yield* db.run(sql`INSERT INTO session (id, project_id) VALUES ('session', 'project')`)
        yield* DatabaseMigration.applyOnly(db, [boardMigration])
        expect(
          yield* db.get(sql`SELECT root_session_id FROM kilo_board WHERE root_session_id = 'session'`),
        ).toBeUndefined()
        expect(yield* db.get(sql`SELECT name FROM sqlite_master WHERE name = 'kilo_board_message'`)).toEqual({
          name: "kilo_board_message",
        })
      }),
    )
  })
})
