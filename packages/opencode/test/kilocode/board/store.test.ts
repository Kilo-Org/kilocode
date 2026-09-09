import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { sql } from "drizzle-orm"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
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
  test("observes without creating a board and pages latest messages in chronological order", async () => {
    await setup((db) =>
      Effect.gen(function* () {
        const input = { sessionID: id("child"), directory: "/", limit: 2 }
        expect(yield* BoardStore.observe(input)).toEqual({
          ownerSessionID: id("root"),
          revision: 0,
          messages: [],
          hasMore: false,
        })
        expect(yield* db.all(sql`SELECT * FROM kilo_board`)).toEqual([])
        const posts = yield* Effect.forEach(
          Array.from({ length: 5 }, (_, index) => index),
          (index) =>
            BoardStore.post({
              sessionID: id("root"),
              messageID: `msg_view_${index}`,
              to: "ALL",
              type: "INFO",
              body: `${index}`,
            }),
        )
        const latest = yield* BoardStore.observe(input)
        expect(latest).toEqual({
          ownerSessionID: id("root"),
          revision: 5,
          messages: posts.slice(3),
          hasMore: true,
          cursor: posts.at(3)?.id,
        })
        const older = yield* BoardStore.observe({ ...input, before: latest.cursor })
        expect(older.messages).toEqual(posts.slice(1, 3))
        const first = yield* BoardStore.observe({ ...input, before: older.cursor })
        expect(first.messages).toEqual(posts.slice(0, 1))
        expect(first.hasMore).toBe(false)
        expect(first.cursor).toBeUndefined()
        expect(yield* db.all(sql`SELECT * FROM part`)).toEqual([])
        expect((yield* BoardStore.observe({ ...input, directory: "/other" }).pipe(Effect.exit))._tag).toBe("Failure")
        expect((yield* BoardStore.observe({ ...input, before: "board_missing" }).pipe(Effect.exit))._tag).toBe(
          "Failure",
        )
      }),
    )
  })

  test("compares canonical routed directories without admitting other worktrees", async () => {
    await using tmp = await tmpdir()
    await setup((db) =>
      Effect.gen(function* () {
        yield* db.update(SessionTable).set({ directory: tmp.path }).run()
        const stored = yield* db.get<{ directory: string }>(sql`SELECT directory FROM session WHERE id = 'ses_root'`)
        expect(stored?.directory).toBe(process.platform === "win32" ? tmp.path.replaceAll("\\", "/") : tmp.path)
        const input = { sessionID: id("root"), directory: tmp.path }
        const first = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_directory",
          to: "ALL",
          type: "INFO",
          body: "Same directory",
        })
        const dirs = [tmp.path, `${tmp.path}${path.sep}.`, `${tmp.path}${path.sep}`]
        if (process.platform === "win32") {
          dirs.push(
            tmp.path.replaceAll("\\", "/"),
            tmp.path.replace(/^[A-Z]:/i, (drive) => drive.toLowerCase()),
          )
        }
        for (const directory of dirs) {
          expect((yield* BoardStore.observe({ ...input, directory })).messages).toEqual([first])
        }
        for (const directory of [path.dirname(tmp.path), path.join(tmp.path, "nested"), `${tmp.path}-other`, ""]) {
          expect((yield* BoardStore.observe({ ...input, directory }).pipe(Effect.flip)).message).toBe(
            "Session is not in the routed directory",
          )
          expect((yield* BoardStore.reset({ ...input, directory, revision: 1 }).pipe(Effect.flip)).message).toBe(
            "Session is not in the routed directory",
          )
        }
        for (const directory of dirs) {
          expect((yield* BoardStore.reset({ ...input, directory, revision: 1 })).messages).toEqual([])
        }
        expect(yield* db.get(sql`SELECT directory FROM session WHERE id = 'ses_root'`)).toEqual(stored)
        yield* db.run(sql`UPDATE session SET directory = '' WHERE id = 'ses_root'`)
        expect((yield* BoardStore.observe({ ...input, directory: process.cwd() }).pipe(Effect.flip)).message).toBe(
          "Session is not in the routed directory",
        )
        expect(
          (yield* BoardStore.reset({ ...input, directory: process.cwd(), revision: 1 }).pipe(Effect.flip)).message,
        ).toBe("Session is not in the routed directory")
      }),
    )
  })

  test("resets visible history without breaking old cursors, replies, retries, or new posts", async () => {
    await setup((db) =>
      Effect.gen(function* () {
        const input = { sessionID: id("root"), directory: "/" }
        const args = {
          sessionID: id("child"),
          messageID: "msg_reset",
          callID: "first",
          to: "ALL",
          type: "INFO" as const,
          body: "Before reset",
        }
        const first = yield* BoardStore.post(args)
        yield* db.run(sql`UPDATE kilo_board SET message_count = 1000, message_bytes = ${2 * 1024 * 1024}`)
        expect((yield* BoardStore.post({ ...args, callID: "full" }).pipe(Effect.exit))._tag).toBe("Failure")
        expect(
          (yield* BoardStore.reset({ ...input, sessionID: id("child"), revision: 1 }).pipe(Effect.exit))._tag,
        ).toBe("Failure")
        expect((yield* BoardStore.reset({ ...input, directory: "/other", revision: 1 }).pipe(Effect.exit))._tag).toBe(
          "Failure",
        )
        expect(yield* BoardStore.reset({ ...input, revision: 1 })).toEqual({
          ownerSessionID: id("root"),
          revision: 1,
          messages: [],
          hasMore: false,
        })
        expect(yield* BoardStore.activity({ sessionID: id("root"), after: 0 })).toEqual({ cursor: 1, message: 0 })
        expect(yield* BoardStore.read({ sessionID: id("root"), since: first.id })).toMatchObject({
          messages: [],
          cursor: first.id,
        })
        expect(yield* BoardStore.post(args)).toEqual(first)
        expect(
          yield* db.get(sql`SELECT next_seq, cleared_seq, message_count, message_bytes, objective FROM kilo_board`),
        ).toEqual({
          next_seq: 2,
          cleared_seq: 1,
          message_count: 0,
          message_bytes: 0,
          objective: "Build the shared board",
        })
        const next = yield* BoardStore.post({ ...args, callID: "after", body: "After reset", reply_to: first.id })
        expect((yield* BoardStore.read({ sessionID: id("root"), since: first.id })).messages).toEqual([next])
        expect(yield* BoardStore.activity({ sessionID: id("root"), after: 1 })).toEqual({ cursor: 2, message: 2 })
        expect((yield* BoardStore.observe({ ...input, before: first.id })).messages).toEqual([])
        expect((yield* BoardStore.reset({ ...input, revision: 1 }).pipe(Effect.exit))._tag).toBe("Failure")
        expect((yield* BoardStore.observe(input)).messages).toEqual([next])
        expect(yield* db.all(sql`SELECT seq FROM kilo_board_message ORDER BY seq`)).toEqual([{ seq: 1 }, { seq: 2 }])
        expect(yield* db.all(sql`SELECT id FROM session`)).toHaveLength(3)
        expect(yield* db.all(sql`SELECT id FROM session_message`)).toHaveLength(1)
      }),
    )
  })

  test("bounds human pages by bytes without skipping older messages", async () => {
    await setup(() =>
      Effect.gen(function* () {
        const posts = yield* Effect.forEach(
          Array.from({ length: 10 }, (_, index) => index),
          (index) =>
            BoardStore.post({
              sessionID: id("root"),
              messageID: `msg_large_${index}`,
              to: "ALL",
              type: "INFO",
              body: "x".repeat(3500),
            }),
        )
        const input = { sessionID: id("root"), directory: "/", limit: 50 }
        const latest = yield* BoardStore.observe(input)
        expect(latest.hasMore).toBe(true)
        expect(Buffer.byteLength(JSON.stringify(latest))).toBeLessThanOrEqual(32 * 1024)
        const older = yield* BoardStore.observe({ ...input, before: latest.cursor })
        expect([...older.messages, ...latest.messages]).toEqual(posts)
        expect(older.hasMore).toBe(false)
      }),
    )
  })

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
    expect(result.first).toMatchObject({ fromLabel: "Root", toLabel: "Child" })
    expect(result.second).toMatchObject({ fromLabel: "Child", toLabel: "Root" })
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

  test("rejects messages addressed to the sending session", async () => {
    const result = await setup(() =>
      Effect.gen(function* () {
        const main = yield* Effect.exit(
          BoardStore.post({
            sessionID: id("root"),
            messageID: "msg_self_main",
            to: "main",
            type: "INFO",
            body: "Main cannot receive its own message",
          }),
        )
        const child = yield* Effect.exit(
          BoardStore.post({
            sessionID: id("child"),
            messageID: "msg_self_child",
            to: id("child"),
            type: "INFO",
            body: "Child cannot receive its own message",
          }),
        )
        return { main, child, messages: (yield* BoardStore.read({ sessionID: id("root") })).messages }
      }),
    )
    expect(result.main._tag).toBe("Failure")
    expect(result.child._tag).toBe("Failure")
    expect(result.messages).toEqual([])
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

  test("deduplicates trusted retries after title changes", async () => {
    const title = "Renamed (retry) (@general subagent)"
    const result = await setup((db) =>
      Effect.gen(function* () {
        const first = yield* BoardStore.post({
          sessionID: id("child"),
          messageID: "msg_retry",
          callID: "call_retry",
          to: "ALL",
          type: "HOLD",
          body: "Pause before editing",
        })
        yield* db.run(sql`UPDATE session SET title = ${title} WHERE id = 'ses_child'`)
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
    expect(BoardStore.format(result.retry)).toBe(BoardStore.format(result.first))
    expect(result.retry.fromLabel).toBe(title)
    expect(result.read.messages).toEqual([result.retry])
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

  test("discovers new, nested, and resumed active participants beyond the roster limit", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        const snapshot = { observedAt: 200, sessions: new Map<string, BoardStore.Execution>() }
        snapshot.sessions.set(id("sibling"), { state: "completed" })
        for (let index = 0; index < 80; index++) {
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${`ses_extra_${index}`}, 'p', 'ses_root', ${`extra-${index}`}, '/', ${"x".repeat(128)}, 'test', ${index + 4}, ${index + 4})
          `)
          if (index === 46) {
            const complete = yield* BoardStore.read({ sessionID: id("child"), snapshot })
            expect(complete.participants).toHaveLength(50)
            expect(complete.participantsTruncated).toBeUndefined()
          }
        }
        const before = yield* BoardStore.read({ sessionID: id("child"), snapshot })
        expect(before.participants.map((item) => item.id)).not.toContain(id("sibling"))
        expect(before.participants.map((item) => item.id)).not.toContain(id("extra_0"))
        expect(yield* BoardStore.availability({ sessionID: id("child"), to: "ALL", snapshot })).toMatchObject({
          total: 82,
          active: 0,
          inactive: 1,
          unknown: 81,
        })
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES
            ('ses_new', 'p', 'ses_root', 'new', '/', 'New task', 'test', 100, 100),
            ('ses_nested', 'p', 'ses_extra_0', 'nested', '/', 'Nested task', 'test', 101, 101)
        `)
        snapshot.sessions.set(id("new"), { state: "running", updated: 110 })
        snapshot.sessions.set(id("nested"), { state: "busy", updated: 120 })
        snapshot.sessions.set(id("sibling"), { state: "retry", updated: 130 })
        for (let index = 0; index < 80; index++)
          snapshot.sessions.set(id(`extra_${index}`), { state: "running", updated: index })
        expect(yield* BoardStore.availability({ sessionID: id("child"), to: "ALL", snapshot })).toMatchObject({
          total: 84,
          active: 83,
          inactive: 0,
          unknown: 1,
        })
        yield* BoardStore.post({
          sessionID: id("extra_0"),
          messageID: "msg_roster",
          to: id("extra_1"),
          type: "INFO",
          body: "message survives roster truncation",
        })
        return yield* BoardStore.read({ sessionID: id("child"), snapshot })
      }),
    )
    expect(result.participants.slice(0, 5).map((item) => [item.id, item.state])).toEqual([
      ["main", "unknown"],
      [id("child"), "unknown"],
      [id("sibling"), "retry"],
      [id("nested"), "busy"],
      [id("new"), "running"],
    ])
    expect(result.messages).toHaveLength(1)
    expect(result.messages.at(0)).toMatchObject({
      from: id("extra_0"),
      to: id("extra_1"),
      fromLabel: "x".repeat(128),
      toLabel: "x".repeat(128),
      body: "message survives roster truncation",
    })
    expect(result.participants.some((item) => item.id === id("extra_0") || item.id === id("extra_1"))).toBe(false)
    expect(result.participants).toHaveLength(50)
    expect(result.participantsTruncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32 * 1024)
  })

  test("filters foreign project and directory branches before limiting discovery and availability", async () => {
    await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
          VALUES ('q', '/other', 1, 1, '[]')
        `)
        for (let index = 0; index < 60; index++) {
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
            VALUES (${`ses_foreign_${index}`}, ${index % 2 ? "p" : "q"}, 'ses_root', ${`foreign-${index}`}, ${index % 2 ? "/other" : "/"}, 'Foreign', 'test', ${index + 100}, ${index + 100})
          `)
        }
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES
            ('ses_late', 'p', 'ses_root', 'late', '/', 'Late', 'test', 5, 5),
            ('ses_reentry', 'p', 'ses_foreign_0', 'reentry', '/', 'Reentry', 'test', 1000, 1000),
            ('ses_returned', 'p', 'ses_foreign_1', 'returned', '/', 'Returned', 'test', 1000, 1000)
        `)
        const result = yield* BoardStore.read({ sessionID: id("root") })
        expect(result.participants.map((item) => item.id)).toEqual(["main", id("late"), id("sibling"), id("child")])
        expect(result.participantsTruncated).toBeUndefined()
        const snapshot = { observedAt: 100, sessions: new Map<string, BoardStore.Execution>() }
        expect((yield* BoardStore.availability({ sessionID: id("root"), to: "ALL", snapshot })).total).toBe(3)
      }),
    )
  })

  test("keeps root and self first, then active update, newest creation, and binary ID order", async () => {
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`
          INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
          VALUES
            ('ses_a', 'p', 'ses_root', 'a', '/', 'A', 'test', 4, 1000),
            ('ses_Z', 'p', 'ses_root', 'z', '/', 'Z', 'test', 4, 4),
            ('ses_nested', 'p', 'ses_child', 'nested', '/', 'Nested', 'test', 0, 0),
            ('ses_offline', 'p', 'ses_root', 'offline', '/', 'Offline', 'test', 6, 6),
            ('ses_unknown', 'p', 'ses_root', 'unknown', '/', 'Unknown', 'test', 100, 100)
        `)
        const snapshot = {
          observedAt: 200,
          sessions: new Map<string, BoardStore.Execution>([
            [id("root"), { state: "completed" }],
            [id("nested"), { state: "cancelled" }],
            [id("sibling"), { state: "busy", updated: 70 }],
            [id("Z"), { state: "retry", updated: 50 }],
            [id("a"), { state: "running", updated: 50 }],
            [id("offline"), { state: "offline", updated: 50 }],
          ]),
        }
        const read = yield* BoardStore.read({ sessionID: id("nested"), snapshot })
        const availability = yield* BoardStore.availability({ sessionID: id("nested"), to: "ALL", snapshot })
        return { read, availability }
      }),
    )
    expect(result.read.participants.map((item) => [item.id, item.state])).toEqual([
      ["main", "completed"],
      [id("nested"), "cancelled"],
      [id("sibling"), "busy"],
      [id("offline"), "offline"],
      [id("a"), "running"],
      [id("Z"), "retry"],
      [id("unknown"), "unknown"],
      [id("child"), "unknown"],
    ])
    expect(result.read.participantsTruncated).toBeUndefined()
    expect(result.availability).toEqual({ observedAt: 200, total: 7, active: 4, inactive: 1, unknown: 2 })
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
        const overhead = Buffer.byteLength(JSON.stringify(probe)) - Buffer.byteLength(probe.body)
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
    expect(result.first.messages).toHaveLength(7)
    expect(Buffer.byteLength(JSON.stringify(result.first))).toBeLessThanOrEqual(32 * 1024)
    expect([...result.first.messages, ...result.second.messages]).toHaveLength(8)
    expect(result.second.hasMore).toBe(false)
  })

  test("bounds encoded roster and route labels while reserving space for enriched messages", async () => {
    const body = "\u0002".repeat(600)
    const title = "\u0001".repeat(600)
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`UPDATE session SET title = ${title}`)
        for (let index = 0; index < 40; index++) {
          yield* db.run(sql`
            INSERT INTO session (id, project_id, parent_id, slug, directory, title, agent, version, time_created, time_updated)
            VALUES (${`ses_encoded_${index}`}, 'p', 'ses_root', ${`encoded-${index}`}, '/', ${title}, ${"\u0001".repeat(256)},
              'test', ${index + 4}, ${index + 4})
          `)
        }
        yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_encoded_roster",
          to: id("child"),
          type: "INFO",
          body,
        })
        return yield* BoardStore.read({ sessionID: id("child") })
      }),
    )
    expect(result.messages.at(0)).toMatchObject({
      body,
      fromLabel: BoardStore.excerpt(title, 512),
      toLabel: BoardStore.excerpt(title, 512),
    })
    expect(Buffer.byteLength(JSON.stringify(result.messages.at(0)))).toBeGreaterThan(4096)
    expect(result.participants.slice(0, 2).map((item) => item.id)).toEqual(["main", id("child")])
    for (const participant of result.participants) {
      expect(Buffer.byteLength(participant.label)).toBeLessThanOrEqual(512)
      expect(Buffer.byteLength(participant.agent ?? "")).toBeLessThanOrEqual(128)
    }
    expect(result.participants.length).toBeLessThan(43)
    expect(result.participantsTruncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32 * 1024)
  })

  test("reopens persisted identities and history without retaining stale execution states", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "board.db")
    const name = "Inspect caching (LRU) (@general subagent) - v2"
    const title = `${"Review ".repeat(60)}(backoff) (@general subagent)`
    const first = await use(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* seed(db)
        yield* db.run(sql`UPDATE session SET title = ${name}, agent = 'general' WHERE id = 'ses_child'`)
        yield* db.run(sql`UPDATE session SET title = ${title}, agent = 'general' WHERE id = 'ses_sibling'`)
        const message = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_restart",
          to: "ALL",
          type: "RESULT",
          body: "survived restart",
        })
        const read = yield* BoardStore.read({
          sessionID: id("child"),
          snapshot: { observedAt: 100, sessions: new Map([[id("child"), { state: "busy" }]]) },
        })
        return { message, read }
      }),
      file,
    )
    const before = Date.now()
    const second = await use(BoardStore.read({ sessionID: id("child") }), file)
    expect(second.messages).toEqual([first.message])
    expect(first.read.observedAt).toBe(100)
    expect(first.read.participants.map((row) => [row.id, row.sessionID, row.label, row.agent, row.state])).toEqual([
      ["main", id("root"), "Root", undefined, "unknown"],
      [id("child"), id("child"), name, "general", "busy"],
      [id("sibling"), id("sibling"), title, "general", "unknown"],
    ])
    expect(second.participants).toEqual(first.read.participants.map((item) => ({ ...item, state: "unknown" })))
    expect(second.observedAt).toBeGreaterThanOrEqual(before)
    expect(second.observedAt).toBeLessThanOrEqual(Date.now())
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
          to: id("sibling"),
          type: "RESULT",
          body: "child history",
        })
        const other = yield* BoardStore.read({ sessionID: id("other") })
        const cursor = yield* Effect.exit(BoardStore.read({ sessionID: id("root"), since: "missing" }))
        yield* db.run(sql`UPDATE session SET directory = '/other' WHERE id = 'ses_sibling'`)
        const foreign = yield* BoardStore.read({ sessionID: id("root") })
        expect(foreign.messages.at(0)?.fromLabel).toBe("Child")
        expect(foreign.messages.at(0)).not.toHaveProperty("toLabel")
        yield* db.run(sql`DELETE FROM session WHERE id IN ('ses_child', 'ses_sibling')`)
        const retained = yield* BoardStore.read({ sessionID: id("root") })
        yield* db.run(sql`DELETE FROM session WHERE id = 'ses_root'`)
        const deleted = yield* db.all(sql`SELECT id FROM kilo_board_message`)
        return { post, other, cursor, retained, deleted }
      }),
    )
    expect(result.other.messages).toEqual([])
    expect(result.cursor._tag).toBe("Failure")
    expect(result.retained.messages).toMatchObject([{ id: result.post.id, from: id("child"), to: id("sibling") }])
    expect(result.retained.messages.at(0)).not.toHaveProperty("fromLabel")
    expect(result.retained.messages.at(0)).not.toHaveProperty("toLabel")
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
    expect(result.board.participants.map((item) => item.id)).toEqual(["main", id("nested"), id("sibling"), id("child")])
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

  test("bounds excerpts and canonical storage without charging for display labels", async () => {
    expect(Buffer.byteLength(BoardStore.excerpt("世界".repeat(2000), 2048))).toBeLessThanOrEqual(2048)
    const result = await setup((db) =>
      Effect.gen(function* () {
        yield* db.run(sql`UPDATE session SET title = ${"\u0001".repeat(1024)}`)
        const probe = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_probe",
          to: "ALL",
          type: "INFO",
          body: "x",
        })
        yield* db.run(sql`UPDATE kilo_board SET message_bytes = ${2 * 1024 * 1024 - 4096}`)
        const first = yield* BoardStore.post({
          sessionID: id("root"),
          messageID: "msg_big",
          to: "ALL",
          type: "INFO",
          body: "x".repeat(4096 - Buffer.byteLength(BoardStore.format(probe)) + 1),
        })
        expect(yield* db.get(sql`SELECT message_bytes FROM kilo_board`)).toEqual({ message_bytes: 2 * 1024 * 1024 })
        const read = yield* BoardStore.read({ sessionID: id("child"), since: probe.id, limit: 1 })
        return { first, read }
      }),
    )
    expect(Buffer.byteLength(BoardStore.format(result.first))).toBe(4096)
    expect(Buffer.byteLength(JSON.stringify(result.first))).toBeGreaterThan(4096)
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
