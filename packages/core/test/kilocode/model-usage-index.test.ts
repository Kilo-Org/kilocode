import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import migration from "@opencode-ai/core/database/migration/20260907102000_kilocode_model_usage_index"
import { sql } from "drizzle-orm"
import { Effect } from "effect"

test("creates the step-finish index on fresh and upgraded databases and uses it for family usage", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* DatabaseMigration.apply(db)
      const definition = sql`SELECT sql FROM sqlite_master WHERE name = 'part_session_step_finish_idx'`
      const fresh = yield* db.get(definition)
      expect(fresh).toBeDefined()
      expect(migrations).toContain(migration)

      // Recreate the pre-migration state, including parts that must be indexed on upgrade.
      yield* db.run(sql`DROP INDEX part_session_step_finish_idx`)
      yield* db.run(sql`DELETE FROM migration WHERE id = ${migration.id}`)
      yield* db.run(
        sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('project', '/repo', 1, 1, '[]')`,
      )
      yield* db.run(
        sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('root', 'project', 'root', '/repo', 'Root', '1', 1, 1)`,
      )
      yield* db.run(
        sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('message', 'root', 1, 1, '{"role":"assistant"}')`,
      )
      yield* db.run(
        sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('step', 'message', 'root', 1, 1, '{"type":"step-finish","cost":0.25}'), ('tool', 'message', 'root', 1, 1, '{"type":"tool","cost":99}')`,
      )
      yield* db.run(
        sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('unrelated', 'project', 'unrelated', '/repo', 'Unrelated', '1', 1, 1)`,
      )
      yield* db.run(
        sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('unrelated', 'unrelated', 1, 1, '{"role":"assistant"}')`,
      )
      yield* db.run(
        sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('malformed', 'unrelated', 'unrelated', 1, 1, '{')`,
      )
      const query = sql`
        SELECT sum(json_extract(part.data, '$.cost')) AS cost
        FROM part
        JOIN message ON message.id = part.message_id AND message.session_id = part.session_id
        WHERE part.session_id IN (${"root"}, ${"child"})
          AND json_valid(part.data)
          AND json_extract(part.data, '$.type') = 'step-finish'
          AND json_extract(message.data, '$.role') = 'assistant'`
      const before = yield* db.get(query)
      expect(before).toEqual({ cost: 0.25 })

      yield* DatabaseMigration.apply(db)
      yield* DatabaseMigration.apply(db)
      expect(yield* db.get(sql`SELECT data FROM part WHERE id = 'malformed'`)).toEqual({ data: "{" })
      expect(yield* db.get(definition)).toEqual(fresh)
      expect(yield* db.get(query)).toEqual(before)
      const plan = yield* db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query}`)
      expect(plan.some((row) => row.detail.includes("USING INDEX part_session_step_finish_idx"))).toBe(true)
      expect(yield* db.get(sql`SELECT count(*) AS count FROM migration WHERE id = ${migration.id}`)).toEqual({
        count: 1,
      })
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )
})
