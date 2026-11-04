import { expect } from "bun:test"
import { Context, Effect, Exit, Layer, Schema } from "effect"
import { and, asc, eq, sql } from "drizzle-orm"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
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
import { digest, json } from "../src/session-sync/protocol"

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
  const { id: _, type, ...data } = encodeMessage(
    decodeMessage({
      id,
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "model", variant: "default" },
      metadata: { opaque: { nil: null, list: [false, 7, "quoted \"text\"\nline"] } },
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
  }).pipe(Effect.andThen(Store.reconcile(f.db, f.directory, true)))

// SessionTransfer.export uses this native messages reader. Compare the complete encoded object,
// not a hand-written content projection, so opaque transcript fields and the original shape survive.
const captured = (f: Fixture, id = messageID) =>
  Effect.gen(function* () {
    const row = (yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message" && row.id === id)
    const native = (yield* f.store.messages({ sessionID, order: "asc" })).find((message) => message.id === id)
    const source = yield* f.db
      .select({ seq: SessionMessageTable.seq })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, id))
      .get()
    if (!row || !native || !source) return yield* Effect.die("Missing split history fixture")
    expect(row.op).toBe("put")
    expect(Store.value(row)).toEqual(json({ seq: source.seq, message: encodeMessage(native) }))
    return row
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
    yield* f.db.insert(SessionMessageTable).values([assistantRow(), assistantRow(inlineID, 1, inline)]).run()
    const reasoning: SessionPartData = { type: "reasoning", text: "first", native: { signature: "opaque", nil: null } }
    const text: SessionPartData = { type: "text", text: "second\n\"quoted\"", native: { nested: { nil: null } } }
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
    expect(Store.value(split)).toEqual(json({
      seq: 0,
      message: { ...assistantRow().data, id: messageID, type: "assistant", content: [reasoning, text, tool] },
    }))
    expect(Store.value(legacy)).toEqual(json({
      seq: 1,
      message: { ...assistantRow(inlineID, 1, inline).data, id: inlineID, type: "assistant" },
    }))
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
    expect(Store.value(updated)).toMatchObject({
      message: {
        content: [{ type: "text", text: "moved before reasoning" }, { type: "reasoning", text: "first" }],
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
    expect(Store.value(empty)).toMatchObject({ message: { content: [] } })
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
      [{ op: "put", kind: "message", id: messageID, value: Store.value(before) }],
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
    expect(Store.value(empty)).toMatchObject({ message: { content: [] } })
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
    const envelope = yield* f.db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, messageID))
      .get()
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
      expect(
        yield* f.db.select().from(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).get(),
      ).toEqual(envelope)
      expect(yield* Store.dirty(f.db, sessionID)).toEqual(dirty)
      expect(yield* Store.sessions(f.db, f.directory)).toEqual(sessions)
      yield* captured(f)
    }
  }),
)

it.live("many native part rewrites retain one lazy position marker and reconstruct only when read", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    const content = Array.from({ length: 80 }, (_, index) => ({
      type: "text" as const,
      text: `part ${index}: ${"original".repeat(32)}`,
    }))
    yield* parts(f.db, content.map((data, ordinal) => ({ ordinal, data })))
    expect(yield* Store.dirty(f.db, sessionID)).toEqual([])
    expect(yield* f.db.all(sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID}`)).toEqual([])
    yield* allow(f)
    const initial = yield* f.db.get<Store.Dirty>(
      sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
    )
    if (!initial) return yield* Effect.die("Missing initial lazy marker")
    expect(initial.value).toBeNull()
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, {
      sessionID,
      messageID,
      content: content.map((part) => ({ ...part, text: part.text.replace("original", "rewritten") })),
    })
    const markers = yield* f.db.all<Store.Dirty>(
      sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message'`,
    )
    expect(markers).toHaveLength(1)
    const marker = markers[0]
    if (!marker) return yield* Effect.die("Missing rewritten lazy marker")
    expect(marker.value).toBeNull()
    expect(marker.position).toBeGreaterThan(initial.position)
    const current = yield* captured(f)
    expect(current.position).toBe(marker.position)
    expect(Store.value(current)).toMatchObject({
      message: { content: content.map((part) => ({ ...part, text: part.text.replace("original", "rewritten") })) },
    })
    expect(
      yield* f.db.get(sql`SELECT value,position FROM _kilo_sync_dirty
        WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`),
    ).toEqual({ value: null, position: marker.position })
    yield* f.bus.publish(SessionEvent.MessageContentUpdated, { sessionID, messageID, content: [] })
    const empty = yield* captured(f)
    expect(empty.position).toBeGreaterThan(current.position)
    expect(Store.value(empty)).toMatchObject({ message: { content: [] } })
  }),
)

it.live("local deletion freezes unread lazy split content before FK cascades without changing a frozen packet", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [{ ordinal: 0, data: { type: "text", text: "already frozen" } }])
    yield* allow(f)
    const before = yield* captured(f)
    const session = (yield* Store.sessions(f.db, f.directory))[0]
    if (!session) return yield* Effect.die("Missing lazy deletion enrollment")
    const pending = yield* Store.freeze(
      f.db,
      session,
      [{ op: "put", kind: "message", id: messageID, value: Store.value(before) }],
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
    expect(marker.value).toBeNull()
    expect(marker.position).toBeGreaterThan(pending.through)
    yield* f.bus.publish(SessionEvent.Deleted, { sessionID })
    expect(yield* partRows(f.db)).toEqual([])
    expect(yield* f.store.messages({ sessionID, order: "asc" })).toEqual([])
    const retained = (yield* Store.dirty(f.db, sessionID)).find((row) => row.kind === "message")
    if (!retained) return yield* Effect.die("Local deletion erased unread split history")
    expect(retained.position).toBe(marker.position)
    expect(Store.value(retained)).toEqual(json({ seq: 0, message: encodeMessage(native) }))
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

it.live("pre-delete lazy snapshots and native cascades roll back together after a late projector rejects deletion", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* f.db.insert(SessionMessageTable).values(assistantRow()).run()
    yield* parts(f.db, [
      { ordinal: 0, data: { type: "text", text: "keep lazy content" } },
      { ordinal: 1, data: { type: "reasoning", text: "keep lazy reasoning" } },
    ])
    yield* allow(f)
    const marker = yield* f.db.get<Store.Dirty>(
      sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
    )
    if (!marker) return yield* Effect.die("Missing rollback lazy marker")
    expect(marker.value).toBeNull()
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

it.live("the first excluded envelope or part mutation freezes the last authorized lazy value and position", () =>
  Effect.gen(function* () {
    for (const [scope, mutation] of [
      ["directory", "envelope"],
      ["alias", "insert"],
      ["directory", "update"],
      ["alias", "delete"],
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
      if (!marker || !native) return yield* Effect.die("Missing authorized lazy content")
      expect(marker.value).toBeNull()
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
          WHERE alias=${f.directory}`)
      }
      if (mutation === "envelope")
        yield* f.db
          .update(SessionMessageTable)
          .set({ data: { ...assistantRow().data, metadata: { excluded: true } } })
          .where(eq(SessionMessageTable.id, messageID))
          .run()
      if (mutation === "insert")
        yield* parts(f.db, [{ ordinal: 2, data: { type: "text", text: "excluded insert" } }])
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
      const frozen = yield* f.db.get<Store.Dirty>(
        sql`SELECT * FROM _kilo_sync_dirty WHERE session_id=${sessionID} AND kind='message' AND id=${messageID}`,
      )
      if (!frozen) return yield* Effect.die("Excluded mutation erased authorized history")
      expect(frozen.value).not.toBeNull()
      expect(frozen.position).toBe(marker.position)
      expect(Store.value(frozen)).toEqual(json({ seq: 0, message: encodeMessage(native) }))
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
