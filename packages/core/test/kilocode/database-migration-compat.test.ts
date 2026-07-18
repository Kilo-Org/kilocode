import { describe, expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { EffectDrizzleSqlite } from "@opencode-ai/effect-drizzle-sqlite"
import { DatabaseMigration } from "@opencode-ai/core/database/migration"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import legacyWriterMigration from "@opencode-ai/core/database/migration/20260714141136_session-message-legacy-writer-compat"
import { Effect } from "effect"
import type { SqlClient as SqlClientService } from "effect/unstable/sql/SqlClient"
import { sql } from "drizzle-orm"
import path from "path"
import { tmpdir } from "../fixture/tmpdir"
import { SessionHistory } from "@opencode-ai/core/session/history"
import { SessionV2 } from "@opencode-ai/core/session"

const make = EffectDrizzleSqlite.makeWithDefaults()
const run = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

describe("database migration compatibility", () => {
  test("accepts released v7.4.7 session message writes after current migrations", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* make
        const split = migrations.findIndex((migration) => migration.id === "20260601010001_normalize_storage_paths")
        expect(split).toBeGreaterThan(0)
        yield* DatabaseMigration.applyOnly(db, migrations.slice(0, split))
        yield* db.run(
          sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('project', '/repo', 1, 1, '[]')`,
        )
        yield* db.run(
          sql`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_session', 'project', 'session', '/repo', 'Session', '7.4.7', 1, 1)`,
        )
        yield* db.run(
          sql`INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('legacy-message', 'ses_session', 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('legacy-part', 'legacy-message', 'ses_session', 1, 1, '{}')`,
        )
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ('legacy-projection', 'ses_session', 'user', 1, 1, '{}')`,
        )

        yield* DatabaseMigration.applyOnly(db, migrations.slice(split))

        // This is the projection shape written by the CLI bundled with VS Code v7.4.7.
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ('message', 'ses_session', 'user', 1, 1, '{}')`,
        )
        yield* db.run(sql`UPDATE session_message SET data = '{"text":"updated"}' WHERE id = 'message'`)

        expect(yield* db.get(sql`SELECT id, seq, data FROM session_message WHERE id = 'message'`)).toEqual({
          id: "message",
          seq: null,
          data: '{"text":"updated"}',
        })
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('msg_sequenced', 'ses_session', 'user', 1, 2, 2, '{"text":"current","files":[],"agents":[],"time":{"created":2}}')`,
        )
        const legacy = JSON.stringify({
          agent: "code",
          model: { id: "model", providerID: "provider" },
          content: [
            {
              type: "tool",
              id: "tool",
              name: "read",
              state: {
                status: "completed",
                input: {},
                content: [{ type: "media", mediaType: "image/png", data: "AAAA", filename: "image.png" }],
                structured: {
                  nested: {
                    status: "completed",
                    content: [{ type: "media", mediaType: "text/plain", data: "unchanged" }],
                  },
                },
              },
              time: { created: 3, completed: 3 },
            },
          ],
          time: { created: 3, completed: 3 },
        })
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('msg_legacy_tool', 'ses_session', 'assistant', 2, 3, 3, ${legacy})`,
        )
        const session = SessionV2.ID.make("ses_session")
        const history = yield* SessionHistory.load(db, session)
        expect(history.map((item) => String(item.id))).toEqual(["msg_sequenced", "msg_legacy_tool"])
        expect(history[1]).toMatchObject({
          content: [
            {
              state: {
                content: [
                  {
                    type: "file",
                    uri: "data:image/png;base64,AAAA",
                    mime: "image/png",
                    name: "image.png",
                  },
                ],
                structured: {
                  nested: {
                    status: "completed",
                    content: [{ type: "media", mediaType: "text/plain", data: "unchanged" }],
                  },
                },
              },
            },
          ],
        })
        expect((yield* SessionHistory.entriesForRunner(db, session, 0)).map((item) => item.seq)).toEqual([1, 2])

        expect(yield* db.get(sql`SELECT id FROM session WHERE id = 'ses_session'`)).toEqual({ id: "ses_session" })
        expect(yield* db.get(sql`SELECT id FROM message WHERE id = 'legacy-message'`)).toEqual({ id: "legacy-message" })
        expect(yield* db.get(sql`SELECT id FROM part WHERE id = 'legacy-part'`)).toEqual({ id: "legacy-part" })
      }),
    )
  })

  test("preserves sequenced projections when repairing an already-migrated database", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* make
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL, FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE)`,
        )
        yield* db.run(sql`CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq)`)
        yield* db.run(sql`INSERT INTO session (id) VALUES ('session')`)
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('sequenced', 'session', 'user', 7, 1, 1, '{}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [legacyWriterMigration])
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ('legacy', 'session', 'user', 2, 2, '{}')`,
        )

        expect(yield* db.all(sql`SELECT id, seq FROM session_message ORDER BY id`)).toEqual([
          { id: "legacy", seq: null },
          { id: "sequenced", seq: 7 },
        ])
      }),
    )
  })

  test("repairs a WAL database while preserving foreign keys and sequence uniqueness", async () => {
    await using tmp = await tmpdir()
    const filename = path.join(tmp.path, "kilo.db")
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* make
        yield* db.run(sql`PRAGMA journal_mode = WAL`)
        yield* db.run(sql`PRAGMA foreign_keys = ON`)
        yield* db.run(sql`CREATE TABLE session (id text PRIMARY KEY)`)
        yield* db.run(
          sql`CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL, FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE)`,
        )
        yield* db.run(sql`CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq)`)
        yield* db.run(sql`INSERT INTO session (id) VALUES ('session')`)
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('sequenced', 'session', 'user', 7, 1, 1, '{}')`,
        )

        yield* DatabaseMigration.applyOnly(db, [legacyWriterMigration])
        yield* db.run(
          sql`INSERT INTO session_message (id, session_id, type, time_created, time_updated, data) VALUES ('legacy-1', 'session', 'user', 2, 2, '{}'), ('legacy-2', 'session', 'user', 3, 3, '{}')`,
        )

        expect(yield* db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
        expect(
          yield* Effect.exit(
            db.run(
              sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES ('duplicate', 'session', 'user', 7, 4, 4, '{}')`,
            ),
          ),
        ).toMatchObject({ _tag: "Failure" })
        yield* db.run(sql`DELETE FROM session WHERE id = 'session'`)
        expect(yield* db.all(sql`SELECT id FROM session_message`)).toEqual([])
      }).pipe(Effect.provide(SqliteClient.layer({ filename })), Effect.scoped),
    )
  })
})
