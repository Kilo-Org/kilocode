import { expect } from "bun:test"
import { Context, Effect, Exit, Layer, Schema } from "effect"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { storedAbsolutePath } from "@opencode/core/database/path"
import { Bus } from "@opencode/core/bus"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionStore } from "@opencode/core/session/store"
import { SessionTable, SessionMessageTable, SessionPartTable, type SessionPartData } from "@opencode/core/session/sql"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../../core/test/lib/effect"
import { Store } from "../src/session-sync/store"
import { type Change, digest, json, jsonNodes, reconstructMessage } from "../src/session-sync/protocol"

const it = testEffect(Layer.empty)
const sessionID = Session.ID.make("ses_sync_parts")
const messageID = SessionMessage.ID.make("msg_sync_parts")
const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)

const fixture = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-sync-parts-")))),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  )
  const directory = path.join(root, "workspace")
  yield* Effect.promise(() => mkdir(directory))
  const context = yield* Layer.build(
    AppNodeBuilder.build(
      LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Global.node]),
      [
        Global.node.replace(
          Global.layerWith(
            Object.fromEntries(
              ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((name) => [
                name,
                path.join(root, name),
              ]),
            ),
          ),
        ),
        Database.node.replace(Database.configured({ path: path.join(root, "native.sqlite") })),
      ],
    ),
  )
  const db = Context.get(context, Database.Service).db
  yield* Store.initialize(db)
  yield* db
    .insert(ProjectTable)
    .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
    .run()
  yield* db
    .insert(SessionTable)
    .values({
      id: sessionID,
      project_id: Project.ID.global,
      directory,
      slug: "sync-parts",
      version: "test",
      time_created: 10,
      time_updated: 20,
    })
    .run()
  return {
    db,
    directory,
    bus: Context.get(context, Bus.Service),
    store: Context.get(context, SessionStore.Service),
  }
})

type Fixture = Effect.Success<typeof fixture>

const assistantRow = (id = messageID, seq = 0, content: SessionPartData[] = []) => {
  const {
    id: _,
    type,
    ...data
  } = encodeMessage(
    decodeMessage({
      id,
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "model", variant: "default" },
      metadata: { opaque: { nil: null, list: [false, 7, 'quoted "text"\nline'] } },
      native: { provider: { replay: "preserve this", nil: null } },
      content,
      time: { created: 10, completed: 20 },
    }),
  )
  return { id, session_id: sessionID, type, seq, data, time_created: 10 }
}

const parts = (db: Pick<Store.DB, "insert">, content: { ordinal: number; data: SessionPartData }[]) =>
  db
    .insert(SessionPartTable)
    .values(
      content.map(({ ordinal, data }) => ({
        message_id: messageID,
        session_id: sessionID,
        ordinal,
        type: data.type,
        call_id: data.type === "tool" ? data.id : null,
        data,
        time_created: 10,
        time_updated: 20,
      })),
    )
    .run()

const allow = (f: Fixture) =>
  Store.enable(f.db, {
    directory: f.directory,
    destination: "http://127.0.0.1:1",
    local: true,
    organizationID: null,
    tenant: { type: "user", id: "fixture" },
    userID: "fixture",
  }).pipe(
    Effect.andThen(
      f.db
        .update(SessionTable)
        .set({ time_updated: sql`time_updated` })
        .where(and(eq(SessionTable.directory, f.directory), isNull(SessionTable.workspace_id)))
        .run(),
    ),
    Effect.andThen(Store.sessions(f.db, f.directory)),
    Effect.tap((sessions) => Effect.sync(() => expect(sessions.map((session) => session.id)).toContain(sessionID))),
    Effect.andThen(Store.reconcile(f.db, f.directory, true)),
  )

// SessionTransfer.export uses this native messages reader. Compare the complete encoded object,
// not a hand-written content projection, so opaque transcript fields and the original shape survive.
const captured = (f: Fixture, id = messageID) =>
  Effect.gen(function* () {
    const rows = yield* f.db.all<Store.Dirty>(sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID}`)
    const row = rows.find((row) => row.kind === "message" && row.id === id)
    const native = (yield* f.store.messages({ sessionID, order: "asc" })).find((message) => message.id === id)
    const source = yield* f.db
      .select({ seq: SessionMessageTable.seq })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, id))
      .get()
    const session = (yield* Store.sessions(f.db, f.directory))[0]
    if (!row || !native || !source || !session) return yield* Effect.die("Missing split history fixture")
    expect(row.op).toBe("put")
    const result = reconstructMessage(
      Store.value(row),
      rows.filter((row) => row.kind === "message-part" && row.op === "put").map(Store.value),
      session.position,
    )
    if (!result.complete) return yield* Effect.die("Expected a complete native message snapshot")
    expect(result.value).toEqual(json({ seq: source.seq, message: encodeMessage(native) }))
    return { ...row, reconstructed: result.value }
  })

const partRows = (db: Store.DB) =>
  db
    .select()
    .from(SessionPartTable)
    .where(eq(SessionPartTable.message_id, messageID))
    .orderBy(asc(SessionPartTable.ordinal))
    .all()

it.live("bootstrap reconstructs ordered split assistant content and leaves legacy inline JSON exact", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const inlineID = SessionMessage.ID.make("msg_sync_inline")
    const inline: SessionPartData[] = [{ type: "text", text: "legacy inline", native: { nil: null } }]
    yield* f.db
      .insert(SessionMessageTable)
      .values([assistantRow(), assistantRow(inlineID, 1, inline)])
      .run()
    const reasoning: SessionPartData = { type: "reasoning", text: "first", native: { signature: "opaque", nil: null } }
    const text: SessionPartData = { type: "text", text: 'second\n"quoted"', native: { nested: { nil: null } } }
    const tool: SessionPartData = {
      type: "tool",
      id: "call_original",
      name: "read",
      executed: true,
      native: { original: [null, true] },
      state: { status: "completed", input: { path: "a.ts" }, content: [{ type: "text", text: "third" }] },
      time: { created: 10, ran: 11, completed: 12 },
    }
    yield* parts(f.db, [
      { ordinal: 90, data: tool },
      { ordinal: 2, data: reasoning },
      { ordinal: 17, data: text },
    ])
    expect(yield* Store.dirty(f.db, sessionID)).toEqual([])
    yield* allow(f)
    const split = yield* captured(f)
    const legacy = yield* captured(f, inlineID)
    expect(split.reconstructed).toEqual(
      json({
        seq: 0,
        message: { ...assistantRow().data, id: messageID, type: "assistant", content: [reasoning, text, tool] },
      }),
    )
    expect(legacy.reconstructed).toEqual(
      json({
        seq: 1,
        message: { ...assistantRow(inlineID, 1, inline).data, id: inlineID, type: "assistant" },
      }),
    )
    expect(
      (yield* f.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get())?.data,
    ).toMatchObject({ content: [] })
  }),
)

it.live("direct part inserts, updates, reordering and deletes capture every current native message", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* allow(f)
    const initial = yield* captured(f)
    yield* parts(f.db, [{ ordinal: 20, data: { type: "text", text: "last" } }])
    const inserted = yield* captured(f)
    expect(inserted.position).toBeGreaterThan(initial.position)
    yield* parts(f.db, [{ ordinal: 5, data: { type: "reasoning", text: "first" } }])
    const second = yield* captured(f)
    expect(second.position).toBeGreaterThan(inserted.position)
    yield* f.db
      .update(SessionPartTable)
      .set({ ordinal: 1, data: { type: "text", text: "moved before reasoning", native: { nil: null } } })
      .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 20)))
      .run()
    const updated = yield* captured(f)
    expect(updated.position).toBeGreaterThan(second.position)
    expect(updated.reconstructed).toMatchObject({
      message: {
        content: [
          { type: "text", text: "moved before reasoning" },
          { type: "reasoning", text: "first" },
        ],
      },
    })
    yield* f.db
      .delete(SessionPartTable)
      .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 1)))
      .run()
    const removed = yield* captured(f)
    expect(removed.position).toBeGreaterThan(updated.position)
    yield* f.db.delete(SessionPartTable).where(eq(SessionPartTable.message_id, messageID)).run()
    const empty = yield* captured(f)
    expect(empty.position).toBeGreaterThan(removed.position)
    expect(empty.reconstructed).toMatchObject({ message: { content: [] } })
    yield* parts(f.db, [{ ordinal: 0, data: { type: "text", text: "cascade must not resurrect this message" } }])
    yield* f.db.delete(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).run()
    expect((yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message")).toMatchObject({
      op: "remove",
      value: null,
    })
    expect(yield* partRows(f.db)).toEqual([])
  }),
)

it.live("native envelope-first projection captures final parts while old packet bytes and receipt stay immutable", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [
      { ordinal: 0, data: { type: "text", text: "before" } },
      { ordinal: 1, data: { type: "reasoning", text: "before reasoning" } },
    ])
    yield* allow(f)
    const before = yield* captured(f)
    const session = (yield* Store.sessions(f.db, f.directory))[0]
    if (!session) return yield* Effect.die("Missing sync enrollment")
    const pending = yield* Store.freeze(
      f.db,
      session,
      (yield* f.db.all<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} ORDER BY position`,
      ))
        .filter((row) => row.op === "put")
        .map((row) => ({ op: "put" as const, kind: row.kind, id: row.id, value: Store.value(row) })),
      before.position,
      [],
    )
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, {
      sessionID,
      messageID,
      content: [
        { type: "text", text: "projected update" },
        { type: "reasoning", text: "projected reasoning" },
        { type: "text", text: "projected insert" },
      ],
    })
    const appended = yield* captured(f)
    expect(appended.position).toBeGreaterThan(before.position)
    expect(yield* partRows(f.db)).toHaveLength(3)
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, {
      sessionID,
      messageID,
      content: [{ type: "text", text: "only final content", native: { original: [null, false] } }],
    })
    const reduced = yield* captured(f)
    expect(reduced.position).toBeGreaterThan(appended.position)
    expect(yield* partRows(f.db)).toHaveLength(1)
    expect(
      (yield* f.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get())?.data,
    ).toMatchObject({ content: [] })
    expect(yield* Store.packet(f.db, sessionID)).toEqual(pending)
    expect(digest(pending.body)).toBe(pending.digest)
    expect(pending.body).toContain("before reasoning")
    expect(pending.body).not.toContain("only final content")
    const receipt = {
      version: 1 as const,
      sessionID,
      batchID: pending.batch_id,
      after: pending.after,
      through: pending.through,
      digest: pending.digest,
      revision: 1,
      changes: 1,
      committedAt: 30,
    }
    yield* Store.acknowledge(f.db, pending, receipt)
    expect(yield* Store.packet(f.db, sessionID)).toBeUndefined()
    expect(yield* captured(f)).toEqual(reduced)
    expect((yield* Store.sessions(f.db, f.directory))[0]).toMatchObject({
      acknowledged: receipt.through,
      ack_batch: receipt.batchID,
      ack_digest: receipt.digest,
    })
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, { sessionID, messageID, content: [] })
    const empty = yield* captured(f)
    expect(empty.position).toBeGreaterThan(reduced.position)
    expect(empty.reconstructed).toMatchObject({ message: { content: [] } })
    expect(yield* partRows(f.db)).toEqual([])
  }),
)

it.live("split part insert, update and delete capture rolls back with native writes and late projector failure", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [
      { ordinal: 0, data: { type: "text", text: "keep first" } },
      { ordinal: 1, data: { type: "reasoning", text: "keep second" } },
    ])
    yield* allow(f)
    const dirty = yield* Store.dirty(f.db, sessionID)
    const sessions = yield* Store.sessions(f.db, f.directory)
    const originalParts = yield* partRows(f.db)
    const envelope = yield* f.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get()
    const rolledBack = yield* f.db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* tx
            .update(SessionPartTable)
            .set({ data: { type: "text", text: "discard update" } })
            .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 0)))
            .run()
          yield* parts(tx, [{ ordinal: 2, data: { type: "text", text: "discard insert" } }])
          yield* tx
            .delete(SessionPartTable)
            .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 1)))
            .run()
          return yield* Effect.fail("rollback split transaction")
        }),
      )
      .pipe(Effect.exit)
    expect(Exit.isFailure(rolledBack)).toBe(true)
    expect(yield* partRows(f.db)).toEqual(originalParts)
    expect(yield* Store.dirty(f.db, sessionID)).toEqual(dirty)
    expect(yield* Store.sessions(f.db, f.directory)).toEqual(sessions)
    yield* f.bus.project(SessionEvent.MessageContentUpdated, () => Effect.die("late projector rejects split rewrite"))
    for (const content of [
      [
        { type: "text" as const, text: "discard projected update" },
        { type: "text" as const, text: "discard second update" },
        { type: "text" as const, text: "discard projected insert" },
      ],
      [],
    ]) {
      const projected = yield* f.bus
        .publish(SessionEvent.MessageContentUpdated, { sessionID, messageID, content })
        .pipe(Effect.exit)
      expect(Exit.isFailure(projected)).toBe(true)
      expect(yield* partRows(f.db)).toEqual(originalParts)
      expect(yield* f.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get()).toEqual(
        envelope,
      )
      expect(yield* Store.dirty(f.db, sessionID)).toEqual(dirty)
      expect(yield* Store.sessions(f.db, f.directory)).toEqual(sessions)
      yield* captured(f)
    }
  }),
)

it.live("many native part rewrites retain independent bodies and a body-free envelope", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    const content = Array.from({ length: 80 }, (_, index) => ({
      type: "text" as const,
      text: `part ${index}: ${"original".repeat(32)}`,
    }))
    yield* parts(
      f.db,
      content.map((data, ordinal) => ({ ordinal, data })),
    )
    yield* allow(f)
    const initial = yield* captured(f)
    expect(Store.value(initial)).toMatchObject({ parts: { count: 80, through: initial.position } })
    expect(initial.value).not.toContain("original")
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, {
      sessionID,
      messageID,
      content: content.map((part) => ({ ...part, text: part.text.replace("original", "rewritten") })),
    })
    const current = yield* captured(f)
    expect(current.position).toBeGreaterThan(initial.position)
    expect(current.value).not.toContain("rewritten")
    expect(current.reconstructed).toMatchObject({
      message: { content: content.map((part) => ({ ...part, text: part.text.replace("original", "rewritten") })) },
    })
    expect(
      yield* f.db.all(sql`SELECT id FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message-part'`),
    ).toHaveLength(80)
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, { sessionID, messageID, content: [] })
    expect((yield* captured(f)).reconstructed).toMatchObject({ message: { content: [] } })
  }),
)

it.live("local deletion preserves split snapshots before FK cascades without changing a frozen packet", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [{ ordinal: 0, data: { type: "text", text: "already frozen" } }])
    yield* allow(f)
    const before = yield* captured(f)
    const session = (yield* Store.sessions(f.db, f.directory))[0]
    if (!session) return yield* Effect.die("Missing split deletion enrollment")
    const pending = yield* Store.freeze(
      f.db,
      session,
      (yield* f.db.all<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} ORDER BY position`,
      ))
        .filter((row) => row.op === "put")
        .map((row) => ({ op: "put" as const, kind: row.kind, id: row.id, value: Store.value(row) })),
      before.position,
      [],
    )
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, {
      sessionID,
      messageID,
      content: [
        { type: "text", text: "unread newest content" },
        { type: "reasoning", text: "preserve ordered parts through both native foreign keys" },
      ],
    })
    const marker = yield* f.db.get<Store.Dirty>(
      sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
    )
    const native = (yield* f.store.messages({ sessionID, order: "asc" }))[0]
    if (!marker || !native) return yield* Effect.die("Missing unread split content")
    expect(marker.value).not.toBeNull()
    expect(marker.position).toBeGreaterThan(pending.through)
    yield* f.bus.publish(SessionEvent.Deleted, { sessionID })
    expect(yield* partRows(f.db)).toEqual([])
    expect(yield* f.store.messages({ sessionID, order: "asc" })).toEqual([])
    const retained = (yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message")
    if (!retained) return yield* Effect.die("Local deletion erased unread split history")
    expect(retained.position).toBe(marker.position)
    const retainedParts = yield* f.db.all<Store.Dirty>(
      sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message-part' AND op='put'`,
    )
    expect(reconstructMessage(Store.value(retained), retainedParts.map(Store.value), marker.position)).toEqual({
      complete: true,
      value: json({ seq: 0, message: encodeMessage(native) }),
    })
    expect(
      yield* f.db.get(sql`SELECT value FROM _kilo_sync_dirty
        WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`),
    ).toEqual({ value: retained.value })
    expect(yield* Store.packet(f.db, sessionID)).toEqual(pending)
    yield* Store.acknowledge(f.db, pending, {
      version: 1,
      sessionID,
      batchID: pending.batch_id,
      after: pending.after,
      through: pending.through,
      digest: pending.digest,
      revision: 1,
      changes: 1,
      committedAt: 30,
    })
    expect((yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message")).toEqual(retained)
    expect((yield* Store.sessions(f.db, f.directory))[0]).toMatchObject({ local_deleted: 1 })
  }),
)

it.live("split snapshots and native cascades roll back together after a late projector rejects deletion", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [
      { ordinal: 0, data: { type: "text", text: "keep snapshot content" } },
      { ordinal: 1, data: { type: "reasoning", text: "keep snapshot reasoning" } },
    ])
    yield* allow(f)
    const marker = yield* f.db.get<Store.Dirty>(
      sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
    )
    if (!marker) return yield* Effect.die("Missing rollback split snapshot")
    expect(marker.value).not.toBeNull()
    const originalParts = yield* partRows(f.db)
    const sessions = yield* Store.sessions(f.db, f.directory)
    yield* f.bus.project(SessionEvent.Deleted, () => Effect.die("late projector refuses local deletion"))
    const deleted = yield* f.bus.publish(SessionEvent.Deleted, { sessionID }).pipe(Effect.exit)
    expect(Exit.isFailure(deleted)).toBe(true)
    expect(
      yield* f.db.get<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
      ),
    ).toEqual(marker)
    expect(yield* partRows(f.db)).toEqual(originalParts)
    expect(yield* Store.sessions(f.db, f.directory)).toEqual(sessions)
    yield* captured(f)
  }),
)

it.live("excluded envelope and part mutations preserve the last authorized split values and positions", () =>
  Effect.gen(function* () {
    for (const [scope, mutation] of [
      ["directory", "envelope"],
      ["alias", "insert"],
      ["directory", "update"],
      ["alias", "delete"],
      ["alias", "message-delete"],
    ] as const) {
      const f = yield* fixture
      yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
      yield* parts(f.db, [
        { ordinal: 0, data: { type: "text", text: "last authorized text" } },
        { ordinal: 1, data: { type: "reasoning", text: "last authorized reasoning" } },
      ])
      yield* allow(f)
      const marker = yield* f.db.get<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
      )
      const native = (yield* f.store.messages({ sessionID, order: "asc" }))[0]
      if (!marker || !native) return yield* Effect.die("Missing authorized split content")
      expect(marker.value).not.toBeNull()
      const excluded = path.join(path.dirname(f.directory), "excluded")
      yield* Effect.promise(() => mkdir(excluded))
      if (scope === "directory")
        yield* f.db.update(SessionTable).set({ directory: excluded }).where(eq(SessionTable.id, sessionID)).run()
      else {
        yield* Store.enable(f.db, {
          directory: excluded,
          destination: "http://127.0.0.1:1",
          local: true,
          organizationID: null,
          tenant: { type: "user", id: "other-fixture" },
          userID: "other-fixture",
        })
        yield* f.db.run(sql`UPDATE _kilo_sync_directory SET directory=${excluded},canonical=${excluded}
          WHERE alias=${storedAbsolutePath(f.directory)}`)
        expect(
          yield* f.db.get<{ directory: string }>(
            sql`SELECT directory FROM _kilo_sync_directory WHERE alias=${storedAbsolutePath(f.directory)}`,
          ),
        ).toEqual({ directory: excluded })
      }
      if (mutation === "envelope")
        yield* f.db
          .update(SessionMessageTable)
          .set({ data: { ...assistantRow().data, metadata: { excluded: true } } })
          .where(eq(SessionMessageTable.id, messageID))
          .run()
      if (mutation === "insert") yield* parts(f.db, [{ ordinal: 2, data: { type: "text", text: "excluded insert" } }])
      if (mutation === "update")
        yield* f.db
          .update(SessionPartTable)
          .set({ data: { type: "text", text: "excluded update" } })
          .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 0)))
          .run()
      if (mutation === "delete")
        yield* f.db
          .delete(SessionPartTable)
          .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 1)))
          .run()
      if (mutation === "message-delete")
        yield* f.db.delete(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).run()
      const frozen = yield* f.db.get<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
      )
      if (!frozen) return yield* Effect.die("Excluded mutation erased authorized history")
      expect(frozen.value).not.toBeNull()
      expect(frozen.position).toBe(marker.position)
      const retainedParts = yield* f.db.all<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message-part' AND op='put'`,
      )
      expect(reconstructMessage(Store.value(frozen), retainedParts.map(Store.value), marker.position)).toEqual({
        complete: true,
        value: json({ seq: 0, message: encodeMessage(native) }),
      })
      yield* f.db
        .update(SessionPartTable)
        .set({ data: { type: "text", text: "another excluded mutation" } })
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 0)))
        .run()
      expect(
        yield* f.db.get<Store.Dirty>(
          sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
        ),
      ).toEqual(frozen)
      expect((yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message")).toEqual(frozen)
    }
  }),
)

it.live("active message removal discards its envelope without materializing the complete message", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [{ ordinal: 0, data: { type: "text", text: "removed without serialization" } }])
    yield* allow(f)
    yield* f.db.run("CREATE TABLE snapshot_observation(value TEXT)")
    yield* f.db.run(`CREATE TRIGGER observe_materialized_message AFTER UPDATE ON _kilo_sync_dirty
      WHEN NEW.kind='message' AND NEW.op='put' AND instr(NEW.value,'removed without serialization')>0 BEGIN
        INSERT INTO snapshot_observation(value) VALUES(NEW.value);
      END`)
    yield* f.db.delete(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).run()
    expect(yield* f.db.all(sql`SELECT * FROM snapshot_observation`)).toEqual([])
    expect(
      (yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message" && row.id === messageID),
    ).toMatchObject({ op: "remove", value: null })
  }),
)

it.live("reader rejects partial, deferred, future and mixed-frontier snapshots and sorts ordinals numerically", () =>
  Effect.sync(() => {
    const envelope = json({
      seq: 7,
      message: { id: messageID, type: "assistant", native: { nil: null } },
      parts: { count: 2, through: 20 },
    })
    const first = json({
      messageID,
      ordinal: 2,
      position: 10,
      part: { type: "reasoning", text: "first", native: { nil: null } },
    })
    const last = json({ messageID, ordinal: 10, position: 19, part: { type: "text", text: "last" } })
    expect(reconstructMessage(envelope, [last, first], 20)).toEqual({
      complete: true,
      value: {
        seq: 7,
        message: {
          id: messageID,
          type: "assistant",
          native: { nil: null },
          content: [
            { type: "reasoning", text: "first", native: { nil: null } },
            { type: "text", text: "last" },
          ],
        },
      },
    })
    expect(reconstructMessage(envelope, [first], 20)).toEqual({ complete: false })
    expect(reconstructMessage(envelope, [last, first], 19)).toEqual({ complete: false })
    expect(
      reconstructMessage(
        envelope,
        [first, json({ messageID, ordinal: 10, position: 21, part: { type: "text", text: "new" } })],
        21,
      ),
    ).toEqual({ complete: false })
    expect(
      reconstructMessage(envelope, [first, json({ messageID, ordinal: 10, position: 19, deferred: true })], 20),
    ).toEqual({ complete: false })
    expect(reconstructMessage(envelope, [first, first], 20)).toEqual({ complete: false })
    const legacy = json({
      seq: 8,
      message: {
        id: messageID,
        type: "assistant",
        content: [{ type: "text", text: "legacy", native: { nil: null } }],
        native: { opaque: [null, true] },
      },
    })
    expect(reconstructMessage(legacy, [first, last], 20)).toEqual({ complete: true, value: legacy })
  }),
)

it.live(
  "direct writes release preceding text, restore deferred tails and keep legacy fallback after last removal",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const legacy: SessionPartData[] = [{ type: "text", text: "original inline fallback", native: { nil: null } }]
      const row = assistantRow(messageID, 0, legacy)
      yield* f.db
        .insert(SessionMessageTable)
        .values({ ...row, data: { ...row.data, time: { created: 10 } } })
        .run()
      yield* allow(f)
      yield* parts(f.db, [{ ordinal: 2, data: { type: "text", text: "mutable tail" } }])
      expect(
        (yield* Store.dirty(f.db, sessionID)).find(
          (part) => part.kind === "message-part" && part.id === `${messageID}/2`,
        )?.value,
      ).not.toContain("mutable tail")
      yield* parts(f.db, [{ ordinal: 10, data: { type: "reasoning", text: "next tail" } }])
      expect(
        (yield* Store.dirty(f.db, sessionID)).find(
          (part) => part.kind === "message-part" && part.id === `${messageID}/2`,
        )?.value,
      ).toContain("mutable tail")
      yield* f.db
        .delete(SessionPartTable)
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 10)))
        .run()
      expect(
        (yield* Store.dirty(f.db, sessionID)).find(
          (part) => part.kind === "message-part" && part.id === `${messageID}/2`,
        )?.value,
      ).not.toContain("mutable tail")
      expect(
        (yield* Store.dirty(f.db, sessionID)).find(
          (part) => part.kind === "message-part" && part.id === `${messageID}/10`,
        ),
      ).toMatchObject({ op: "remove", cause: "part-removed" })
      yield* f.db.update(SessionMessageTable).set({ data: row.data }).where(eq(SessionMessageTable.id, messageID)).run()
      // The native reader appends inline content that is still on a split row after its part rows.
      expect((yield* captured(f)).reconstructed).toMatchObject({
        message: { content: [{ type: "text", text: "mutable tail" }, ...legacy] },
      })
      yield* f.db.delete(SessionPartTable).where(eq(SessionPartTable.message_id, messageID)).run()
      expect((yield* captured(f)).reconstructed).toMatchObject({ message: { content: legacy } })
    }),
)

it.live("terminal tool writes release their body even before assistant completion and edits remain exact", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const row = assistantRow()
    yield* f.db
      .insert(SessionMessageTable)
      .values({ ...row, data: { ...row.data, time: { created: 10 } } })
      .run()
    yield* allow(f)
    const running: SessionPartData = {
      type: "tool",
      id: "call_direct",
      name: "read",
      time: { created: 10 },
      state: { status: "running", input: {}, metadata: { partial: "not yet portable" } },
    }
    yield* parts(f.db, [{ ordinal: 0, data: running }])
    expect((yield* Store.dirty(f.db, sessionID)).find((part) => part.kind === "message-part")?.value).not.toContain(
      "not yet portable",
    )
    const completed: SessionPartData = {
      type: "tool",
      id: "call_direct",
      name: "read",
      native: { opaque: [null, false] },
      time: { created: 10, completed: 20 },
      state: { status: "completed", input: {}, content: [{ type: "text", text: "settled output" }] },
    }
    yield* f.db
      .update(SessionPartTable)
      .set({ data: completed })
      .where(eq(SessionPartTable.message_id, messageID))
      .run()
    yield* captured(f)
    const edited: SessionPartData = { ...completed, native: { opaque: [null, "direct edit"] } }
    yield* f.db.update(SessionPartTable).set({ data: edited }).where(eq(SessionPartTable.message_id, messageID)).run()
    expect((yield* captured(f)).reconstructed).toMatchObject({ message: { content: [edited] } })
  }),
)

it.live("JSON admission counts keys and values and accepts exactly 64 nested containers", () =>
  Effect.sync(() => {
    expect(jsonNodes({ key: 1 })).toBe(3)
    expect(jsonNodes(Array.from({ length: 8191 }, () => null))).toBe(8192)
    expect(jsonNodes(Array.from({ length: 8192 }, () => null))).toBeUndefined()
    let value: unknown = null
    for (let depth = 0; depth < 64; depth++) value = [value]
    expect(jsonNodes(value)).toBe(65)
    expect(jsonNodes([value])).toBeUndefined()
  }),
)

for (const transition of ["non-assistant", "without-content"] as const)
  it.live(`direct ${transition} message transition removes obsolete parts and restores them on return`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const row = assistantRow()
      yield* f.db.insert(SessionMessageTable).values(row).run()
      yield* parts(f.db, [
        { ordinal: 2, data: { type: "text", text: "restored first" } },
        { ordinal: 10, data: { type: "text", text: "restored last", native: { nil: null } } },
      ])
      yield* allow(f)
      const before = yield* captured(f)
      if (transition === "non-assistant")
        yield* f.db
          .update(SessionMessageTable)
          .set({ type: "user", data: { text: "replacement", time: { created: 10 } } })
          .where(eq(SessionMessageTable.id, messageID))
          .run()
      else yield* f.db.run(sql`UPDATE session_message SET data=json_remove(data,'$.content') WHERE id=${messageID}`)
      const removed = yield* Store.dirty(f.db, sessionID)
      expect(removed.filter((part) => part.kind === "message-part")).toHaveLength(2)
      for (const part of removed.filter((part) => part.kind === "message-part"))
        expect(part).toMatchObject({ op: "remove", cause: "part-removed", value: null })
      const envelope = removed.find((part) => part.kind === "message")
      if (!envelope) return yield* Effect.die("Expected replacement envelope")
      expect(Store.value(envelope)).not.toHaveProperty("parts")
      if (transition === "non-assistant")
        expect((yield* captured(f)).reconstructed).toMatchObject({ message: { type: "user", text: "replacement" } })
      yield* f.db
        .update(SessionMessageTable)
        .set({ type: row.type, data: row.data })
        .where(eq(SessionMessageTable.id, messageID))
        .run()
      expect((yield* captured(f)).reconstructed).toEqual(before.reconstructed)
      expect(
        (yield* Store.dirty(f.db, sessionID))
          .filter((part) => part.kind === "message-part")
          .every((part) => part.op === "put"),
      ).toBe(true)
    }),
  )

it.live("initialization removes obsolete lazy snapshot triggers and view", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    for (const name of ["_kilo_sync_message_snapshot", "_kilo_sync_message_scope_snapshot"])
      yield* f.db.run(`CREATE TRIGGER ${name} BEFORE UPDATE ON session_message BEGIN SELECT 1; END`)
    yield* f.db.run("CREATE VIEW _kilo_sync_dirty_current AS SELECT * FROM _kilo_sync_dirty")
    yield* Store.initialize(f.db)
    expect(
      yield* f.db.all(sql`SELECT name FROM sqlite_master WHERE name IN
      ('_kilo_sync_message_snapshot','_kilo_sync_message_scope_snapshot','_kilo_sync_dirty_current')`),
    ).toEqual([])
  }),
)

for (const pause of ["disable", "account", "scope", "alias"] as const)
  it.live(`a continued message reconciles paused part edits once after ${pause}, ACK and capture restart`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const untouchedID = SessionMessage.ID.make("msg_paused_untouched")
      yield* f.db.insert(SessionMessageTable).values([assistantRow(), assistantRow(untouchedID, 1)]).run()
      yield* parts(f.db, [
        { ordinal: 0, data: { type: "text", text: "before update" } },
        { ordinal: 2, data: { type: "text", text: "unchanged part" } },
        { ordinal: 5, data: { type: "text", text: "before deletion" } },
        { ordinal: 10, data: { type: "text", text: "before reorder" } },
      ])
      yield* f.db.insert(SessionPartTable).values({
        session_id: sessionID, message_id: untouchedID, ordinal: 0, type: "text",
        data: { type: "text", text: "untouched cloud snapshot" },
      }).run()
      yield* allow(f)
      const cloud = new Map<string, Schema.Json>()
      const settle = () => Effect.gen(function* () {
        const session = (yield* Store.sessions(f.db, f.directory))[0]
        if (!session) return yield* Effect.die("Expected an enrolled resumed session")
        const changes: Change[] = []
        for (const row of yield* Store.dirty(f.db, sessionID)) {
          if (row.op === "put") {
            changes.push({ op: "put", kind: row.kind, id: row.id, value: Store.value(row) })
            continue
          }
          if (row.kind === "session" || row.cause !== "part-removed")
            return yield* Effect.die("Expected ordinary native part reconciliation")
          changes.push({ op: "remove", kind: row.kind, id: row.id, cause: row.cause })
        }
        const pending = yield* Store.freeze(f.db, session, changes, session.position, [])
        for (const change of changes)
          if (change.op === "remove") cloud.delete(`${change.kind}/${change.id}`)
          else if ("value" in change) cloud.set(`${change.kind}/${change.id}`, change.value)
        yield* Store.acknowledge(f.db, pending, {
          version: 1, sessionID, batchID: pending.batch_id, after: pending.after, through: pending.through,
          digest: pending.digest, revision: session.position, changes: changes.length, committedAt: 30,
        })
      })
      yield* settle()
      expect(yield* Store.dirty(f.db, sessionID)).toEqual([])
      const before = new Map(cloud)
      const inventory = yield* f.db.all(sql`SELECT * FROM _kilo_sync_part ORDER BY session_id,id`)
      const excluded = path.join(path.dirname(f.directory), "paused-scope")
      if (pause === "disable") yield* Store.disable(f.db, f.directory)
      if (pause === "account") yield* f.db.run(sql`UPDATE _kilo_sync_consent SET enabled=0 WHERE directory=${f.directory}`)
      if (pause === "scope") {
        yield* Effect.promise(() => mkdir(excluded))
        yield* f.db.update(SessionTable).set({ directory: excluded }).where(eq(SessionTable.id, sessionID)).run()
      }
      if (pause === "alias")
        yield* f.db.run(sql`UPDATE _kilo_sync_directory SET directory=${excluded}
          WHERE alias=${storedAbsolutePath(f.directory)}`)
      yield* f.db.update(SessionPartTable).set({ data: { type: "text", text: "updated during pause" } })
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 0))).run()
      yield* f.db.delete(SessionPartTable)
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 5))).run()
      yield* f.db.update(SessionPartTable).set({ ordinal: 17, data: { type: "text", text: "reordered during pause" } })
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 10))).run()
      yield* parts(f.db, [{ ordinal: 20, data: { type: "text", text: "inserted during pause" } }])
      yield* f.db.insert(SessionPartTable).values({
        session_id: sessionID, message_id: untouchedID, ordinal: 9, type: "text",
        data: { type: "text", text: "completed while paused; stays local" },
      }).run()
      yield* f.db.update(SessionMessageTable).set({
        data: { ...assistantRow(untouchedID, 1).data, time: { created: 10, completed: 30 } },
      }).where(eq(SessionMessageTable.id, untouchedID)).run()
      expect(yield* Store.dirty(f.db, sessionID)).toEqual([])
      expect(yield* f.db.all(sql`SELECT * FROM _kilo_sync_part ORDER BY session_id,id`)).toEqual(inventory)
      yield* Store.enable(f.db, {
        directory: f.directory, destination: "http://127.0.0.1:1", local: true, organizationID: null,
        tenant: { type: "user", id: "fixture" }, userID: "fixture",
      })
      if (pause === "scope")
        yield* f.db.update(SessionTable).set({ directory: f.directory }).where(eq(SessionTable.id, sessionID)).run()
      yield* Store.reconcile(f.db, f.directory)
      yield* Store.initialize(f.db)
      expect((yield* Store.dirty(f.db, sessionID)).some((row) => row.kind === "message" || row.kind === "message-part")).toBe(false)
      const pending = yield* Store.dirty(f.db, sessionID)
      const sessions = yield* Store.sessions(f.db, f.directory)
      const rollback = yield* f.db.transaction((tx) => Effect.gen(function* () {
        yield* tx.update(SessionPartTable).set({ data: { type: "text", text: "rolled-back continuation" } })
          .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 20))).run()
        return yield* Effect.fail("rollback resumed snapshot")
      })).pipe(Effect.exit)
      expect(Exit.isFailure(rollback)).toBe(true)
      expect(yield* Store.dirty(f.db, sessionID)).toEqual(pending)
      expect(yield* Store.sessions(f.db, f.directory)).toEqual(sessions)
      expect(yield* f.db.all(sql`SELECT * FROM _kilo_sync_part ORDER BY session_id,id`)).toEqual(inventory)
      expect(yield* f.db.get(sql`SELECT needs_snapshot FROM _kilo_sync_message
        WHERE session_id=${sessionID} AND id=${messageID}`)).toEqual({ needs_snapshot: 1 })
      yield* f.db.update(SessionPartTable).set({ data: { type: "text", text: "authorized continuation" } })
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 20))).run()
      const restored = yield* captured(f)
      const resumed = yield* Store.dirty(f.db, sessionID)
      for (const ordinal of [5, 10])
        expect(resumed.find((row) => row.kind === "message-part" && row.id === `${messageID}/${ordinal}`))
          .toMatchObject({ op: "remove", cause: "part-removed" })
      const current = resumed.filter((row) => row.kind === "message-part" && row.op === "put")
      expect(current).toHaveLength(4)
      expect(current.every((row) => row.position < restored.position)).toBe(true)
      expect(resumed.some((row) => row.id === untouchedID || row.id.startsWith(`${untouchedID}/`))).toBe(false)
      yield* settle()
      expect(reconstructMessage(cloud.get(`message/${messageID}`)!,
        [...cloud.entries()].filter(([key]) => key.startsWith("message-part/")).map(([, value]) => value),
        (yield* Store.sessions(f.db, f.directory))[0]!.position)).toEqual({ complete: true, value: restored.reconstructed })
      expect(cloud.get(`message/${untouchedID}`)).toEqual(before.get(`message/${untouchedID}`))
      expect(cloud.get(`message-part/${untouchedID}/0`)).toEqual(before.get(`message-part/${untouchedID}/0`))
      expect(cloud.has(`message-part/${untouchedID}/9`)).toBe(false)
      yield* f.db.update(SessionPartTable).set({ data: { type: "text", text: "ordinary next revision" } })
        .where(and(eq(SessionPartTable.message_id, messageID), eq(SessionPartTable.ordinal, 20))).run()
      expect((yield* Store.dirty(f.db, sessionID)).filter((row) => row.kind === "message-part").map((row) => row.id))
        .toEqual([`${messageID}/20`])
    }),
  )

for (const inactive of ["old", "new", "both"] as const)
  it.live(`part moves capture either authorized session when ${inactive} scope is inactive`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const otherSession = Session.ID.make("ses_sync_parts_other")
      const otherMessage = SessionMessage.ID.make("msg_sync_parts_other")
      const otherDirectory = path.join(path.dirname(f.directory), "other-workspace")
      yield* Effect.promise(() => mkdir(otherDirectory))
      yield* f.db.insert(SessionTable).values({
        id: otherSession, project_id: Project.ID.global, directory: otherDirectory,
        slug: "other-parts", version: "test", time_created: 10, time_updated: 20,
      }).run()
      yield* f.db.insert(SessionMessageTable).values([
        assistantRow(), { ...assistantRow(otherMessage), session_id: otherSession },
      ]).run()
      yield* parts(f.db, [{ ordinal: 0, data: { type: "text", text: "moving part" } }])
      yield* allow(f)
      yield* Store.enable(f.db, {
        directory: otherDirectory, destination: "http://127.0.0.1:1", local: true, organizationID: null,
        tenant: { type: "user", id: "fixture" }, userID: "fixture",
      })
      yield* f.db.update(SessionTable).set({ time_updated: sql`time_updated` })
        .where(eq(SessionTable.id, otherSession)).run()
      yield* Store.reconcile(f.db, otherDirectory, true)
      for (const session of yield* Store.sessions(f.db)) {
        const changes = (yield* Store.dirty(f.db, session.id))
          .filter((row) => row.op === "put").map((row) => ({
            op: "put" as const, kind: row.kind, id: row.id, value: Store.value(row),
          }))
        const pending = yield* Store.freeze(f.db, session, changes, session.position, [])
        yield* Store.acknowledge(f.db, pending, {
          version: 1, sessionID: session.id, batchID: pending.batch_id, after: pending.after,
          through: pending.through, digest: pending.digest, revision: 1, changes: changes.length, committedAt: 30,
        })
      }
      if (inactive !== "new") yield* Store.disable(f.db, f.directory)
      if (inactive !== "old") yield* Store.disable(f.db, otherDirectory)
      yield* f.db.update(SessionPartTable).set({ session_id: otherSession, message_id: otherMessage })
        .where(eq(SessionPartTable.message_id, messageID)).run()
      const old = yield* Store.dirty(f.db, sessionID)
      const next = yield* Store.dirty(f.db, otherSession)
      if (inactive === "new")
        expect(old.find((row) => row.kind === "message-part")).toMatchObject({
          id: `${messageID}/0`, op: "remove", cause: "part-removed",
        })
      else expect(old).toEqual([])
      if (inactive === "old")
        expect(next.find((row) => row.kind === "message-part")).toMatchObject({
          id: `${otherMessage}/0`, op: "put", value: expect.stringContaining("moving part"),
        })
      else expect(next).toEqual([])
    }),
  )
