import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { BoardStore } from "@/kilocode/board/store"
import { SessionID } from "@/session/schema"
import { tmpdir } from "../../fixture/fixture"

const use = <A, E>(effect: Effect.Effect<A, E, Database.Service>, file = ":memory:") =>
  Effect.runPromise(Effect.provide(Database.layerFromPath(file))(Effect.scoped(effect)))

const id = (value: string) => SessionID.make(`ses_${value}`)

const seed = (db: Database.Interface["db"]) =>
  Effect.gen(function* () {
    yield* db.run(
      sql`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('p', '/', 1, 1, '[]')`,
    )
    yield* db.run(sql`
      INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
      VALUES ('ses_root', 'p', 'root', '/', 'Root', 'test', 1, 1)
    `)
    yield* db.run(sql`
      INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
      VALUES ('ses_child', 'p', 'ses_root', 'child', '/', 'Child', 'test', 2, 2)
    `)
    yield* db.run(sql`
      INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
      VALUES ('ses_sibling', 'p', 'ses_root', 'sibling', '/', 'Sibling', 'test', 3, 3)
    `)
    yield* db.run(sql`
      INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
      VALUES ('msg_objective', 'ses_root', 'user', 1, 1, 1, ${JSON.stringify({ text: "Build the shared board", synthetic: false })})
    `)
  })

const setup = <A, E>(effect: (db: Database.Interface["db"]) => Effect.Effect<A, E, Database.Service>) =>
  use(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* seed(db)
      return yield* effect(db)
    }),
  )

describe("BoardStore", () => {
  test("resolves scope, objective, recipients, replies, and public formatting", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        const scope = yield* BoardStore.scope(id("child"))
        const first = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_tool",
          callID: "call_1",
          to: id("child"),
          type: "INFO",
          body: "Use the new schema",
        })
        const second = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_tool_2",
          callID: "call_2",
          to: "main",
          type: "RESULT",
          body: "Confirmed",
          reply_to: first.id,
        })
        return { scope, first, second, raw: yield* db.get(sql`SELECT objective, objective_message_id FROM kilo_board`) }
      }),
    )
    expect(result.scope).toMatchObject({ root: id("root"), agent: id("child"), objective: "Build the shared board" })
    expect(result.scope.parent).toBe(id("root"))
    expect(result.first).toMatchObject({ from: "main", to: id("child"), type: "INFO" })
    expect(result.second).toMatchObject({ from: id("child"), to: "main", reply_to: result.first.id })
    expect(BoardStore.format(result.first)).toBe(
      JSON.stringify({
        id: result.first.id,
        timestamp: result.first.timestamp,
        from: "main",
        to: id("child"),
        type: "INFO",
        body: "Use the new schema",
      }),
    )
    expect(result.raw).toEqual({ objective: "Build the shared board", objective_message_id: "msg_objective" })
  })

  test.each(["legacy", "sequenced", "unsequenced"] as const)(
    "rejects JavaScript whitespace before capturing a %s objective",
    async (source) => {
      await setup((db) =>
        Effect.gen(function* () {
          yield* db.run(sql`DELETE FROM session_message`)
          const blank =
            "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
          expect(blank.trim()).toBe("")
          for (const [index, text] of [blank, " \tMeaningful objective\n"].entries()) {
            const message = `msg_${index}`
            const statements =
              source === "legacy"
                ? [
                    sql`INSERT INTO message (id, session_id, time_created, time_updated, data)
                    VALUES (${message}, 'ses_root', ${index}, ${index}, ${JSON.stringify({ role: "user" })})`,
                    sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
                    VALUES (${`prt_${index}`}, ${message}, 'ses_root', ${index}, ${index}, ${JSON.stringify({ type: "text", text })})`,
                  ]
                : [
                    sql`INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
                  VALUES (${message}, 'ses_root', 'user', ${source === "sequenced" ? index : null}, ${index}, ${index}, ${JSON.stringify({ text })})`,
                  ]
            yield* Effect.forEach(statements, (statement) => db.run(statement), { discard: true })
            expect((yield* BoardStore.scope(id("child"))).objective).toBe(index === 0 ? "" : text)
            expect(yield* db.get(sql`SELECT objective_message_id FROM kilo_board`)).toEqual({
              objective_message_id: index === 0 ? null : message,
            })
          }
        }),
      )
    },
  )

  test("preserves sequenced, unsequenced, and legacy objective ordering", async () => {
    await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`UPDATE session_message SET time_created = 100`)
        yield* db.run(sql`
          INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
          VALUES
            ('msg_synthetic', 'ses_root', 'user', 0, 0, 0, ${JSON.stringify({ text: "Synthetic", synthetic: true })}),
            ('msg_later', 'ses_root', 'user', 2, 0, 0, ${JSON.stringify({ text: "Later sequence" })}),
            ('msg_unsequenced', 'ses_root', 'user', NULL, 5, 5, ${JSON.stringify({ text: "Unsequenced objective" })})
        `)
        yield* db.run(sql`
          INSERT INTO message (id, session_id, time_created, time_updated, data)
          VALUES
            ('msg_b', 'ses_root', 10, 10, ${JSON.stringify({ role: "user" })}),
            ('msg_a', 'ses_root', 10, 10, ${JSON.stringify({ role: "user" })}),
            ('msg_skip', 'ses_root', 0, 0, ${JSON.stringify({ role: "user" })})
        `)
        for (const [part, message, data] of [
          ["prt_b", "msg_b", { type: "text", text: "Later message ID" }],
          ["prt_second", "msg_a", { type: "text", text: "Later part ID" }],
          ["prt_first", "msg_a", { type: "text", text: "Legacy objective" }],
          ["prt_ignored", "msg_skip", { type: "text", text: "Ignored", ignored: true }],
          ["prt_synthetic", "msg_skip", { type: "text", text: "Synthetic", synthetic: true }],
        ] as const) {
          yield* db.run(sql`INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
            VALUES (${part}, ${message}, 'ses_root', 0, 0, ${JSON.stringify(data)})`)
        }
        expect((yield* BoardStore.scope(id("root"))).objective).toBe("Build the shared board")
        yield* db.run(sql`DELETE FROM kilo_board`)
        yield* db.run(sql`DELETE FROM session_message WHERE seq IS NOT NULL`)
        expect((yield* BoardStore.scope(id("root"))).objective).toBe("Unsequenced objective")
        yield* db.run(sql`DELETE FROM kilo_board`)
        yield* db.run(sql`DELETE FROM session_message`)
        expect((yield* BoardStore.scope(id("root"))).objective).toBe("Legacy objective")
        expect(yield* db.get(sql`SELECT objective_message_id FROM kilo_board`)).toEqual({
          objective_message_id: "msg_a",
        })
      }),
    )
  })

  test("persists across operations and deduplicates trusted retries", async () => {
    const result = await setup(() =>
      Effect.gen(function* () {
        const first = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_retry",
          callID: "call_retry",
          to: "ALL",
          type: "HOLD",
          body: "Pause before editing",
        })
        const retry = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_retry",
          callID: "call_retry",
          to: "ALL",
          type: "HOLD",
          body: "Pause before editing",
        })
        const read = yield* BoardStore.read({ sessionID: id("root") })
        const activity = yield* BoardStore.activity({ sessionID: id("root"), after: 0 })
        return { first, retry, read, activity }
      }),
    )
    expect(result.retry).toEqual(result.first)
    expect(result.read.messages).toHaveLength(1)
    expect(result.activity).toEqual({ cursor: 1, message: 1 })
  })

  test("does not notify siblings about main-only direct messages", async () => {
    const result = await setup(() =>
      Effect.gen(function* () {
        const post = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_direct_main",
          to: "main",
          type: "INFO",
          body: "Only main should receive this automatically",
        })
        const main = yield* BoardStore.activity({ sessionID: id("root"), after: 0 })
        const sibling = yield* BoardStore.activity({ sessionID: id("sibling"), after: 0 })
        const history = yield* BoardStore.read({ sessionID: id("sibling") })
        return { post, main, sibling, history }
      }),
    )
    expect(result.post.to).toBe("main")
    expect(result.main).toEqual({ cursor: 1, message: 1 })
    expect(result.sibling).toEqual({ cursor: 1, message: 0 })
    expect(result.history.messages).toContainEqual(result.post)
  })

  test("returns cursors on final and empty pages", async () => {
    const result = await setup(() =>
      Effect.gen(function* () {
        const first = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_cursor",
          to: "ALL",
          type: "INFO",
          body: "cursor",
        })
        const final = yield* BoardStore.read({ sessionID: id("child"), limit: 1 })
        const empty = yield* BoardStore.read({ sessionID: id("child"), since: first.id, limit: 1 })
        return { first, final, empty }
      }),
    )
    expect(result.final.messages).toEqual([result.first])
    expect(result.final.cursor).toBe(result.first.id)
    expect(result.final.hasMore).toBe(false)
    expect(result.empty.messages).toEqual([])
    expect(result.empty.cursor).toBe(result.first.id)
    expect(result.empty.hasMore).toBe(false)
  })

  test("uses distinct task titles and preserves unknown invocation state", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(
          sql`UPDATE session SET agent = 'general', title = 'Inspect parser (@general subagent)' WHERE id = 'ses_child'`,
        )
        yield* db.run(
          sql`UPDATE session SET agent = 'general', title = 'Inspect serializer (@general subagent)' WHERE id = 'ses_sibling'`,
        )
        return yield* BoardStore.read({ sessionID: id("root") })
      }),
    )
    expect(result.participants).toContainEqual({
      id: "main",
      sessionID: id("root"),
      label: "main",
      description: "Root",
      state: "unknown",
    })
    expect(result.participants).toContainEqual({
      id: id("child"),
      sessionID: id("child"),
      label: "Inspect parser (@general subagent)",
      agent: "general",
      description: "Inspect parser",
      state: "unknown",
    })
    expect(result.participants).toContainEqual({
      id: id("sibling"),
      sessionID: id("sibling"),
      label: "Inspect serializer (@general subagent)",
      agent: "general",
      description: "Inspect serializer",
      state: "unknown",
    })
    expect(result.observedAt).toBeLessThanOrEqual(Date.now())
    expect(JSON.stringify(result.participants)).not.toContain("Build the shared board")
  })

  test("ignores unrelated active roots and deleted state when the local roster is complete", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        const states: Record<string, BoardStore.State> = { [id("child")]: "completed", [id("sibling")]: "completed" }
        for (let index = 0; index < 150; index++) {
          const root = id(`unrelated_${index}`)
          const child = id(`foreign_${index}`)
          yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES (${root}, 'p', NULL, ${root}, '/', 'Other root', 'test', ${index + 10}, ${index + 10}),
            (${child}, 'p', ${root}, ${child}, '/', 'Other task', 'test', ${index + 10}, ${index + 10})
        `)
          states[root] = "busy"
          states[child] = "running"
          states[id(`deleted_${index}`)] = "running"
        }
        return yield* BoardStore.participants({ sessionID: id("root"), states })
      }),
    )
    expect(result.rows.map((member) => member.id)).toEqual(["main", id("sibling"), id("child")])
    expect(result.rows.filter((member) => member.id !== "main").every((member) => member.state === "completed")).toBe(
      true,
    )
    expect(result.truncated).toBe(false)
  })

  test("keeps active members and messages when the roster exceeds its budget", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        for (let index = 0; index < 80; index++) {
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${`ses_extra_${index}`}, 'p', 'ses_root', ${`extra-${index}`}, '/', ${"x".repeat(128)}, 'test', ${index + 4}, ${index + 4})
          `)
          if (index === 46) {
            const complete = yield* BoardStore.read({ sessionID: id("child") })
            expect(complete.participants).toHaveLength(50)
            expect(complete.participantsTruncated).toBeUndefined()
          }
        }
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_nested', 'p', 'ses_extra_0', 'nested', '/', 'New nested task', 'test', 1000, 1000)
        `)
        yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_roster",
          to: "ALL",
          type: "INFO",
          body: "message survives roster truncation",
        })
        const states: Record<string, BoardStore.State> = { [id("sibling")]: "busy", [id("nested")]: "running" }
        for (let index = 0; index < 55; index++) {
          const root = id(`busy_root_${index}`)
          const child = id(`busy_child_${index}`)
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${root}, 'p', NULL, ${root}, '/', 'Other root', 'test', ${index + 2000}, ${index + 2000}),
              (${child}, 'p', ${root}, ${child}, '/', 'Other active task', 'test', ${index + 2000}, ${index + 2000})
          `)
          states[child] = "busy"
        }
        return yield* BoardStore.read({ sessionID: id("child"), states })
      }),
    )
    expect(result.participants.slice(0, 4).map((member) => member.id)).toEqual([
      "main",
      id("child"),
      id("sibling"),
      id("nested"),
    ])
    expect(result.participants.find((member) => member.id === id("nested"))?.state).toBe("running")
    expect(result.participants.find((member) => member.id === id("sibling"))?.state).toBe("busy")
    expect(result.messages).toHaveLength(1)
    expect(result.messages.at(0)).toMatchObject({ body: "message survives roster truncation" })
    expect(result.participants).toHaveLength(50)
    expect(result.participantsTruncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32 * 1024)
  })

  test("bounds discovery before filtering foreign children", async () => {
    await setup((db) =>
      Effect.gen(function* () {
        for (let index = 0; index < 60; index++) {
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${`ses_foreign_${index}`}, 'p', 'ses_root', ${`foreign-${index}`}, '/other', 'Foreign', 'test', 4, 4)
          `)
        }
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_late', 'p', 'ses_root', 'late', '/', 'Late', 'test', 5, 5)
        `)
        const bounded = yield* BoardStore.read({ sessionID: id("root") })
        expect(bounded.participants.map((item) => item.id)).toEqual(["main", id("late")])
        expect(bounded.participantsTruncated).toBe(true)
        yield* db.run(sql`DELETE FROM session WHERE directory = '/other'`)
        const complete = yield* BoardStore.read({ sessionID: id("root") })
        expect(complete.participants.map((item) => item.id)).toEqual(["main", id("late"), id("sibling"), id("child")])
        expect(complete.participantsTruncated).toBeUndefined()
      }),
    )
  })

  test("keeps the reader and recent children discoverable before older descendants", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES
            ('ses_a', 'p', 'ses_root', 'a', '/', 'A', 'test', 4, 4),
            ('ses_Z', 'p', 'ses_root', 'z', '/', 'Z', 'test', 4, 4),
            ('ses_nested', 'p', 'ses_child', 'nested', '/', 'Nested', 'test', 0, 0)
        `)
        return yield* BoardStore.read({ sessionID: id("root") })
      }),
    )
    expect(result.participants.map((item) => item.id)).toEqual([
      "main",
      id("Z"),
      id("a"),
      id("sibling"),
      id("child"),
      id("nested"),
    ])
    expect(result.participantsTruncated).toBeUndefined()
  })

  test("includes the cursor in the read budget without dropping messages", async () => {
    const result = await setup(() =>
      Effect.gen(function* () {
        const probe = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_boundary_probe",
          to: "ALL",
          type: "INFO",
          body: "probe",
        })
        const empty = yield* BoardStore.read({ sessionID: id("child"), since: probe.id })
        const overhead = Buffer.byteLength(BoardStore.format(probe)) - Buffer.byteLength(probe.body)
        const budget = 32 * 1024 - Buffer.byteLength(JSON.stringify(empty)) - 7 + 1
        for (let index = 0; index < 8; index++) {
          const size = Math.floor(budget / 8) + (index < budget % 8 ? 1 : 0)
          yield* BoardStore.post({
            sessionID: id("root"),
            messageID: `msg_boundary_${index}`,
            to: "ALL",
            type: "INFO",
            body: "x".repeat(size - overhead),
          })
        }
        const first = yield* BoardStore.read({ sessionID: id("child"), since: probe.id })
        const second = yield* BoardStore.read({ sessionID: id("child"), since: first.cursor })
        return { first, second }
      }),
    )
    expect(result.first.hasMore).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result.first))).toBeLessThanOrEqual(32 * 1024)
    expect([...result.first.messages, ...result.second.messages]).toHaveLength(8)
    expect(result.second.hasMore).toBe(false)
  })

  test("reports a roster shortened by encoded byte size", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        for (let index = 0; index < 40; index++) {
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${`ses_encoded_${index}`}, 'p', 'ses_root', ${`encoded-${index}`}, '/', ${"\u0001".repeat(128)}, 'test', ${index + 4}, ${index + 4})
          `)
        }
        yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_encoded_roster",
          to: "ALL",
          type: "INFO",
          body: "kept",
        })
        return yield* BoardStore.read({ sessionID: id("child") })
      }),
    )
    expect(result.messages.at(0)?.body).toBe("kept")
    expect(result.participants.length).toBeLessThan(43)
    expect(result.participantsTruncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32 * 1024)
  })

  test("reopens the same board from the database", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "board.db")
    const first = await use(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seed(db)
        return yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_restart",
          to: "ALL",
          type: "RESULT",
          body: "survived restart",
        })
      }),
      file,
    )
    const second = await use(BoardStore.read({ sessionID: id("child") }), file)
    expect(second.messages).toEqual([first])
    expect(second.participants.every((member) => member.state === "unknown")).toBe(true)
  })

  test("isolates roots, rejects invalid ancestry and cursors, and retains child history", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_other', 'p', 'other', '/', 'Other', 'test', 4, 4)
        `)
        const post = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_child",
          to: "main",
          type: "RESULT",
          body: "child history",
        })
        const other = yield* BoardStore.read({ sessionID: id("other") })
        const cursor = yield* Effect.exit(BoardStore.read({ sessionID: id("root"), since: "missing" }))
        yield* db.run(sql`DELETE FROM session WHERE id = 'ses_child'`)
        const retained = yield* BoardStore.read({ sessionID: id("root") })
        yield* db.run(sql`DELETE FROM session WHERE id = 'ses_root'`)
        const deleted = yield* db.all(sql`SELECT id FROM kilo_board_message`)
        return { post, other, cursor, retained, deleted }
      }),
    )
    expect(result.other.messages).toEqual([])
    expect(result.cursor._tag).toBe("Failure")
    expect(result.retained.messages).toMatchObject([{ id: result.post.id, from: id("child") }])
    expect(result.deleted).toEqual([])
  })

  test("fails closed for missing and cyclic persisted parents", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_missing', 'p', 'ses_gone', 'missing', '/', 'Missing', 'test', 4, 4)
        `)
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_cycle_a', 'p', 'ses_cycle_b', 'cycle-a', '/', 'Cycle A', 'test', 5, 5)
        `)
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES ('ses_cycle_b', 'p', 'ses_cycle_a', 'cycle-b', '/', 'Cycle B', 'test', 6, 6)
        `)
        const missing = yield* Effect.exit(BoardStore.scope(id("missing")))
        const cycle = yield* Effect.exit(BoardStore.scope(id("cycle_a")))
        return { missing, cycle }
      }),
    )
    expect(result.missing._tag).toBe("Failure")
    expect(result.cycle._tag).toBe("Failure")
  })

  test("rejects ancestry across stored projects or worktrees and excludes it from the roster", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('q', '/other', 1, 1, '[]')
        `)
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES
            ('ses_worktree', 'p', 'ses_root', 'worktree', '/other', 'Worktree', 'test', 4, 4),
            ('ses_project', 'q', 'ses_root', 'project', '/', 'Project', 'test', 5, 5),
            ('ses_descendant', 'p', 'ses_worktree', 'descendant', '/other', 'Descendant', 'test', 6, 6),
            ('ses_nested', 'p', 'ses_child', 'nested', '/', 'Nested', 'test', 7, 7)
        `)
        const denied = yield* Effect.forEach([id("worktree"), id("project"), id("descendant")], (session) =>
          Effect.all([
            Effect.exit(BoardStore.read({ sessionID: session })),
            Effect.exit(
              BoardStore.post({
                sessionID: session,
                messageID: `msg_${session}`,
                to: "ALL",
                type: "INFO",
                body: "Foreign sender",
              }),
            ),
            Effect.exit(
              BoardStore.post({
                sessionID: id("root"),
                messageID: `msg_to_${session}`,
                to: session,
                type: "INFO",
                body: "Foreign recipient",
              }),
            ),
          ]),
        )
        const nested = yield* BoardStore.scope(id("nested"))
        const board = yield* BoardStore.read({ sessionID: id("root") })
        return { denied: denied.flat(), nested, board }
      }),
    )
    for (const denied of result.denied) expect(denied._tag).toBe("Failure")
    expect(result.nested.root).toBe(id("root"))
    expect(result.board.messages).toEqual([])
    expect(result.board.participants.map((item) => item.id)).toEqual(["main", id("sibling"), id("child"), id("nested")])
  })

  test("coalesces concurrent activity without returning bodies or replaying irrelevant history", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        const values = yield* Effect.all(
          Array.from({ length: 60 }, (_, index) =>
            BoardStore.post({
              sessionID: id("child"),
              messageID: `msg_${index}`,
              callID: `call_${index}`,
              to: "ALL",
              type: "HOLD",
              body: `message ${index}`,
            }),
          ),
          { concurrency: "unbounded" },
        )
        const first = yield* BoardStore.activity({ sessionID: id("root"), after: 0 })
        const page = yield* BoardStore.read({ sessionID: id("root"), limit: 50 })
        const rest = yield* BoardStore.read({ sessionID: id("root"), since: page.cursor })
        const sequences = yield* db.all<{ seq: number }>(sql`SELECT seq FROM kilo_board_message ORDER BY seq`)
        yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_outgoing",
          to: id("child"),
          type: "INFO",
          body: "Outgoing note",
        })
        const own = yield* BoardStore.activity({ sessionID: id("root"), after: first.cursor })
        yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_notice",
          to: "ALL",
          type: "INFO",
          body: "Available on demand",
        })
        const notice = yield* BoardStore.activity({ sessionID: id("root"), after: own.cursor })
        const caught = yield* BoardStore.activity({ sessionID: id("root"), after: notice.cursor })
        yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_incoming",
          to: "main",
          type: "INFO",
          body: "Incoming after catch-up",
        })
        const incoming = yield* BoardStore.activity({ sessionID: id("root"), after: caught.cursor })
        return { values, first, page, rest, sequences, own, notice, caught, incoming }
      }),
    )
    expect(new Set(result.values.map((item) => item.id)).size).toBe(60)
    expect(result.sequences.map((item) => item.seq)).toEqual(Array.from({ length: 60 }, (_, index) => index + 1))
    expect(result.first).toEqual({ cursor: 60, message: 60 })
    expect(result.page.messages).toHaveLength(50)
    expect(result.page.hasMore).toBe(true)
    expect(result.rest.messages).toHaveLength(10)
    expect(result.rest.hasMore).toBe(false)
    expect(result.own).toEqual({ cursor: 61, message: 0 })
    expect(result.notice).toEqual({ cursor: 62, message: 62 })
    expect(result.caught).toEqual({ cursor: 62, message: 0 })
    expect(result.incoming).toEqual({ cursor: 63, message: 63 })
  })

  test("bounds excerpts and read messages without evicting history", async () => {
    expect(Buffer.byteLength(BoardStore.excerpt("世界".repeat(2000), 2048))).toBeLessThanOrEqual(2048)
    const result = await setup(() =>
      Effect.gen(function* () {
        const body = "x".repeat(3000)
        const first = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_big",
          to: "ALL",
          type: "INFO",
          body,
        })
        const read = yield* BoardStore.read({ sessionID: id("child"), limit: 1 })
        return { first, read }
      }),
    )
    expect(Buffer.byteLength(BoardStore.format(result.first))).toBeLessThanOrEqual(4096)
    expect(result.read.messages).toHaveLength(1)
    expect(result.read.hasMore).toBe(false)
  })

  test("rejects oversized formatted messages and invalid read limits", async () => {
    const result = await setup(() =>
      Effect.gen(function* () {
        const oversized = yield* Effect.exit(
          BoardStore.post({
            sessionID: id("root"),
            messageID: "msg_oversized",
            to: "ALL",
            type: "INFO",
            body: "x".repeat(4096),
          }),
        )
        const invalid = yield* Effect.exit(BoardStore.read({ sessionID: id("root"), limit: 51 }))
        return { oversized, invalid }
      }),
    )
    expect(result.oversized._tag).toBe("Failure")
    expect(result.invalid._tag).toBe("Failure")
  })
})
