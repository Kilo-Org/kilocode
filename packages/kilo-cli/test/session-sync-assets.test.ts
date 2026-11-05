import { expect } from "bun:test"
import { Context, Effect, Layer, Schema } from "effect"
import { and, eq, isNull, sql } from "drizzle-orm"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionBlob } from "@opencode/core/session/blob"
import { SessionMessageTable, SessionInboxTable, SessionPartTable, SessionTable } from "@opencode/core/session/sql"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../../core/test/lib/effect"
import { Assets } from "../src/session-sync/assets"
import { Store, type Dirty } from "../src/session-sync/store"
import { type Change, digest, json, parse } from "../src/session-sync/protocol"

const it = testEffect(Layer.empty)
const id = Session.ID.make("ses_asset_regression")
const messageID = SessionMessage.ID.make("msg_asset_regression")

const boot = (root: string) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([Database.node, Global.node]), [
        Database.node.replace(Database.configured({ path: path.join(root, "native.sqlite") })),
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
      ]),
    )
    const db = Context.get(context, Database.Service).db
    yield* Store.initialize(db)
    return { db, global: Context.get(context, Global.Service) }
  })
const fixture = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-sync-assets-")))),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  )
  const directory = path.join(root, "workspace")
  const child = path.join(directory, "private")
  yield* Effect.promise(() => mkdir(child, { recursive: true }))
  return { root, directory, child }
})
const enable = (
  db: Store.DB,
  directory: string,
  userID = "alice",
  approvals: readonly { path: string; hash: string; bytes: number; pin: string }[] = [],
) =>
  Store.enable(
    db,
    { directory, destination: "http://127.0.0.1:8789", local: true, organizationID: null, tenant: { type: "user", id: userID }, userID },
    approvals,
  ).pipe(
    Effect.andThen(db.update(SessionTable)
      .set({ time_updated: sql`time_updated` })
      .where(and(eq(SessionTable.directory, directory), isNull(SessionTable.workspace_id)))
      .run()),
    Effect.andThen(Store.reconcile(db, directory, true)),
  )
const seed = (db: Store.DB, directory: string, sessionID = id) =>
  Effect.gen(function* () {
    yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] }).onConflictDoNothing().run()
    yield* db.insert(SessionTable).values({ id: sessionID, project_id: Project.ID.global, directory, slug: "assets", version: "test", time_created: 1, time_updated: 1 }).run()
  })
const toolData = (uri: string) => {
  const { id: _, type: __, ...data } = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.Assistant))({
    id: messageID,
    type: "assistant",
    agent: "build",
    model: { id: "fixture", providerID: "fixture", variant: "default" },
    content: [{ type: "tool", id: "call_asset", name: "fixture", time: { created: 1, completed: 2 }, state: { status: "completed", input: {}, content: [{ type: "file", uri, mime: "application/octet-stream" }] } }],
    time: { created: 1, completed: 2 },
  })
  return data
}
const capture = (s: { db: Store.DB; global: Global.Interface }, directory: string, kind: Dirty["kind"], entityID: string) =>
  Effect.gen(function* () {
    const row = (yield* Store.dirty(s.db, id)).find((row) => row.kind === kind && row.id === entityID)
    if (!row) return yield* Effect.die("Expected a durable native mutation")
    const value = Store.value(row)
    const assets = yield* Assets.collect(s.db, s.global, directory, row, value)
    return { row, value, assets }
  })
const freeze = (db: Store.DB, row: Dirty, changes: Change[], blobs: { hash: string; bytes: number }[] = []) =>
  Effect.gen(function* () {
    const session = (yield* Store.sessions(db)).find((session) => session.id === row.session_id)
    if (!session) return yield* Effect.die("Expected an enrolled native session")
    return yield* Store.freeze(db, session, changes, row.position, blobs)
  })
const acknowledge = (db: Store.DB, packet: Store.Packet) =>
  Store.acknowledge(db, packet, { version: 1, sessionID: packet.session_id, batchID: packet.batch_id, after: packet.after, through: packet.through, revision: 1, changes: 1, digest: packet.digest, committedAt: Date.now() })

for (const disabled of [false, true])
  it.live(`a ${disabled ? "disabled" : "separately consented"} child allocation requires exact-file approval in its parent`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* enable(s.db, f.child, "bob")
      yield* seed(s.db, f.directory)
      yield* enable(s.db, f.directory)
      const file = path.join(s.global.data, "tool-output", "private.bin")
      const bytes = Buffer.from("child-account bytes")
      yield* Effect.promise(async () => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes) })
      yield* Assets.owned(s.db, s.global, f.child, file)
      if (disabled) yield* Store.disable(s.db, f.child)
      yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: messageID, type: "assistant", seq: 0, data: toolData(pathToFileURL(file).href) }).run()
      expect(yield* capture(s, f.directory, "message", messageID).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
      expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_asset_reference`)).toEqual([])
      const approvals = yield* Assets.prepareApproval(s.db, s.global, f.directory, [file])
      yield* enable(s.db, f.directory, "alice", approvals)
      const captured = yield* capture(s, f.directory, "message", messageID)
      expect(captured.assets.blobs).toEqual([{ hash: digest(bytes), bytes: bytes.byteLength }])
    }),
  )

it.live("a child allocation without its own consent inherits the parent, but ancestor provenance never authorizes a child", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* enable(s.db, f.directory)
    const file = path.join(s.global.data, "tool-output", "inherited.bin")
    yield* Effect.promise(async () => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "inherited bytes") })
    yield* Assets.owned(s.db, s.global, f.child, file)
    yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: messageID, type: "assistant", seq: 0, data: toolData(file) }).run()
    expect((yield* capture(s, f.directory, "message", messageID)).assets.blobs).toHaveLength(1)
    const childID = Session.ID.make("ses_child_assets")
    yield* enable(s.db, f.child, "bob")
    yield* seed(s.db, f.child, childID)
    const ancestor = path.join(s.global.data, "tool-output", "ancestor.bin")
    yield* Effect.promise(() => writeFile(ancestor, "ancestor bytes"))
    yield* Assets.owned(s.db, s.global, f.directory, ancestor)
    const row: Dirty = { session_id: childID, kind: "message", id: "msg_child", position: 1, op: "put", value: null, cause: null }
    expect(yield* Assets.collect(s.db, s.global, f.child, row, json({ message: { type: "assistant", ...toolData(ancestor) } })).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
  }),
)

it.live("owned native media in user, inbox and tool content is preserved verbatim with durable byte mappings", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const bytes = Buffer.from("native database-backed media")
    const hash = digest(bytes)
    yield* Effect.scoped(Effect.gen(function* () {
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      yield* enable(s.db, f.directory)
      const user = SessionBlob.split({ text: "user", files: [{ data: bytes.toString("base64"), mime: "application/octet-stream", source: { type: "inline" as const }, name: "native.bin" }], time: { created: 1 } })
      const tool = SessionBlob.split(toolData(`data:application/octet-stream;base64,${bytes.toString("base64")}`))
      const inboxID = SessionMessage.ID.make("msg_asset_inbox")
      const toolID = SessionMessage.ID.make("msg_asset_tool")
      yield* SessionBlob.save(s.db, [...user.blobs, ...tool.blobs])
      yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: messageID, type: "user", seq: 0, data: user.data }).run()
      yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: toolID, type: "assistant", seq: 1, data: tool.data }).run()
      yield* s.db.insert(SessionInboxTable).values({ session_id: id, id: inboxID, type: "user", enqueued_seq: 2, delivery: "queue", payload: { text: "queued", files: user.data.files } }).run()
      for (const [entityID, seq, hashes] of [[messageID, 0, user.hashes], [toolID, 1, tool.hashes], [inboxID, 2, user.hashes]] as const)
        yield* SessionBlob.recordHashes(s.db, { sessionID: id, messageID: entityID, seq }, hashes)
      for (const [kind, entityID, pointer] of [["message", messageID, "/message/files/0"], ["message", toolID, "/message/content/0/state/content/0"], ["inbox", inboxID, "/payload/files/0"]] as const) {
        const captured = yield* capture(s, f.directory, kind, entityID)
        const original = captured.row.value
        expect(captured.assets.changes).toEqual([{ op: "put", kind: "asset", id: digest(`${kind}:${entityID}:${pointer}`), value: expect.objectContaining({ entity: { kind, id: entityID }, pointer, reference: `media:${hash}`, blob: { hash, bytes: bytes.byteLength } }) }])
        expect(JSON.stringify(captured.value)).toBe(JSON.stringify(parse(original ?? "null")))
        expect(JSON.stringify(captured.value)).toContain(`media:${hash}`)
        expect(Buffer.from(yield* Assets.read(s.global, id, { hash, bytes: bytes.byteLength }))).toEqual(bytes)
        const packet = yield* freeze(s.db, captured.row, [...captured.assets.changes, { op: "put", kind, id: entityID, value: captured.value }], captured.assets.blobs)
        expect(packet.body).toContain(`media:${hash}`)
        yield* acknowledge(s.db, packet)
      }
      // Native ownership and blob cleanup cannot invalidate already preserved packet bytes.
      yield* SessionBlob.releaseSession(s.db, id)
      expect(yield* s.db.all(sql`SELECT hash FROM blob`)).toEqual([])
    }))
    const restarted = yield* boot(f.root)
    expect(Buffer.from(yield* Assets.read(restarted.global, id, { hash, bytes: bytes.byteLength }))).toEqual(bytes)
  }),
)

it.live("media references cannot borrow another session or another entity's native blob ownership", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    const foreignID = Session.ID.make("ses_foreign_media")
    yield* seed(s.db, f.directory)
    yield* seed(s.db, f.child, foreignID)
    yield* enable(s.db, f.directory)
    const split = SessionBlob.split({ text: "private", files: [{ data: Buffer.from("foreign media").toString("base64"), mime: "text/plain", source: { type: "inline" as const } }], time: { created: 1 } })
    yield* SessionBlob.save(s.db, split.blobs)
    const other = SessionMessage.ID.make("msg_foreign_media")
    for (const sessionID of [foreignID, id]) {
      yield* SessionBlob.recordHashes(s.db, { sessionID, messageID: other, seq: 0 }, split.hashes)
      yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: messageID, type: "user", seq: 0, data: split.data }).onConflictDoUpdate({ target: SessionMessageTable.id, set: { data: split.data } }).run()
      expect(yield* capture(s, f.directory, "message", messageID).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
    }
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_asset_reference`)).toEqual([])
  }),
)

it.live("editing native message files removes vanished JSON pointers and preserves the exact replacement content", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* enable(s.db, f.directory)
    const files = ["first", "second"].map((text) => ({
      data: Buffer.from(text).toString("base64"),
      mime: "text/plain",
      source: { type: "inline" as const },
    }))
    yield* s.db
      .insert(SessionMessageTable)
      .values({ session_id: id, id: messageID, type: "user", seq: 0, data: { text: "before", files, time: { created: 1 } } })
      .run()
    const before = yield* capture(s, f.directory, "message", messageID)
    const packet = yield* freeze(
      s.db,
      before.row,
      [...before.assets.changes, { op: "put", kind: "message", id: messageID, value: before.value }],
      before.assets.blobs,
    )
    yield* acknowledge(s.db, packet)
    const data = { text: "after", files: files.slice(1), time: { created: 1 } }
    yield* s.db.update(SessionMessageTable).set({ data }).where(eq(SessionMessageTable.id, messageID)).run()
    const after = yield* capture(s, f.directory, "message", messageID)
    const removedID = digest(`message:${messageID}:/message/files/1`)
    expect(after.assets.changes).toContainEqual({ op: "remove", kind: "asset", id: removedID, cause: "consumed" })
    expect(after.assets.changes.filter((change) => change.op === "put")).toHaveLength(1)
    expect(after.value).toMatchObject({ message: { id: messageID, type: "user", ...data } })
    const replacement = yield* freeze(
      s.db,
      after.row,
      [...after.assets.changes, { op: "put", kind: "message", id: messageID, value: after.value }],
      after.assets.blobs,
    )
    expect(parse(replacement.body)).toMatchObject({ changes: after.assets.changes.concat([
      { op: "put", kind: "message", id: messageID, value: after.value },
    ]) })
    expect(yield* s.db.all(sql`SELECT id FROM _kilo_sync_asset_mapping`)).toEqual([
      { id: digest(`message:${messageID}:/message/files/0`) },
    ])
  }),
)

it.live("mapping removals survive preparation retries and freeze atomically with content edits and inbox cancellation", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* enable(s.db, f.directory)
    const inboxID = SessionMessage.ID.make("msg_mapping_inbox")
    const file = { data: Buffer.from("retained cloud blob").toString("base64"), mime: "text/plain", source: { type: "inline" as const } }
    yield* s.db.insert(SessionInboxTable).values({ session_id: id, id: inboxID, type: "user", payload: { text: "pending", files: [file] }, enqueued_seq: 0, delivery: "queue" }).run()
    const initial = yield* capture(s, f.directory, "inbox", inboxID)
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_asset_mapping`)).toEqual([])
    const initialPacket = yield* freeze(s.db, initial.row, [...initial.assets.changes, { op: "put", kind: "inbox", id: inboxID, value: initial.value }], initial.assets.blobs)
    const mappingID = digest(`inbox:${inboxID}:/payload/files/0`)
    expect(yield* s.db.all(sql`SELECT id FROM _kilo_sync_asset_mapping`)).toEqual([{ id: mappingID }])
    yield* s.db.update(SessionInboxTable).set({ payload: { text: "attachment removed" } }).where(eq(SessionInboxTable.id, inboxID)).run()
    const edited = yield* capture(s, f.directory, "inbox", inboxID)
    expect(edited.assets.changes).toEqual([{ op: "remove", kind: "asset", id: mappingID, cause: "consumed" }])
    expect((yield* capture(s, f.directory, "inbox", inboxID)).assets.changes).toEqual(edited.assets.changes)
    const raced = yield* freeze(s.db, edited.row, [...edited.assets.changes, { op: "put", kind: "inbox", id: inboxID, value: edited.value }])
    expect(raced.body).toBe(initialPacket.body)
    expect(yield* s.db.all(sql`SELECT id FROM _kilo_sync_asset_mapping`)).toEqual([{ id: mappingID }])
    yield* acknowledge(s.db, initialPacket)
    const editedPacket = yield* freeze(s.db, edited.row, [...edited.assets.changes, { op: "put", kind: "inbox", id: inboxID, value: edited.value }])
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_asset_mapping`)).toEqual([])
    yield* acknowledge(s.db, editedPacket)
    yield* s.db.update(SessionInboxTable).set({ payload: { text: "restored", files: [file] } }).where(eq(SessionInboxTable.id, inboxID)).run()
    const restored = yield* capture(s, f.directory, "inbox", inboxID)
    const restoredPacket = yield* freeze(s.db, restored.row, [...restored.assets.changes, { op: "put", kind: "inbox", id: inboxID, value: restored.value }], restored.assets.blobs)
    yield* acknowledge(s.db, restoredPacket)
    yield* s.db.transaction((tx) => Effect.gen(function* () {
      yield* tx.run(sql`INSERT INTO _kilo_sync_intent(session_id,cause,target_id) VALUES(${id},'cancel',${inboxID})`)
      yield* tx.delete(SessionInboxTable).where(eq(SessionInboxTable.id, inboxID)).run()
      yield* tx.run(sql`DELETE FROM _kilo_sync_intent WHERE session_id=${id}`)
    }))
    const removed = (yield* Store.dirty(s.db, id)).find((row) => row.kind === "inbox")
    if (!removed) return yield* Effect.die("Expected captured cancellation")
    expect(removed).toMatchObject({ op: "remove", cause: "cancel" })
    const changes = yield* Assets.remove(s.db, removed)
    expect(changes).toEqual([{ op: "remove", kind: "asset", id: mappingID, cause: "cancel" }])
    const cancelled = yield* freeze(s.db, removed, [...changes, { op: "remove", kind: "inbox", id: inboxID, cause: "cancel" }])
    expect(parse(cancelled.body)).toMatchObject({ changes: [...changes, { op: "remove", kind: "inbox", id: inboxID, cause: "cancel" }] })
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_asset_mapping`)).toEqual([])
    // Only the mapping is removed. Nothing in these semantic changes requests blob deletion.
    expect(changes.every((change) => change.kind === "asset")).toBe(true)
    expect((yield* Effect.promise(() => readFile(Assets.filename(s.global, id, digest("retained cloud blob"))))).toString()).toBe("retained cloud blob")
  }),
)

for (const collected of [false, true])
  it.live(
    `native media survives local session deletion ${collected ? "after collection but before freezing" : "before its first collection"}`,
    () =>
      Effect.gen(function* () {
        const f = yield* fixture
        const bytes = Buffer.from("media must outlive native session deletion")
        const hash = digest(bytes)
        const toolID = SessionMessage.ID.make("msg_deleted_media_tool")
        const inboxID = SessionMessage.ID.make("msg_deleted_media_inbox")
        yield* Effect.scoped(Effect.gen(function* () {
          const s = yield* boot(f.root)
          yield* seed(s.db, f.directory)
          yield* enable(s.db, f.directory)
          const user = SessionBlob.split({
            text: "user",
            files: [{ data: bytes.toString("base64"), mime: "application/octet-stream", source: { type: "inline" as const } }],
            time: { created: 1 },
          })
          const tool = SessionBlob.split(toolData(`data:application/octet-stream;base64,${bytes.toString("base64")}`))
          yield* SessionBlob.save(s.db, [...user.blobs, ...tool.blobs])
          yield* s.db.insert(SessionMessageTable).values({
            session_id: id, id: messageID, type: "user", seq: 0, data: user.data,
          }).run()
          yield* s.db.insert(SessionMessageTable).values({
            session_id: id, id: toolID, type: "assistant", seq: 1, data: { ...tool.data, content: [] },
          }).run()
          const part = tool.data.content[0]
          if (!part) return yield* Effect.die("Expected native media tool part")
          yield* s.db.insert(SessionPartTable).values({
            session_id: id, message_id: toolID, ordinal: 0, type: part.type, data: part,
          }).run()
          yield* s.db.insert(SessionInboxTable).values({
            session_id: id, id: inboxID, type: "user", enqueued_seq: 2, delivery: "queue",
            payload: { text: "queued", files: user.data.files },
          }).run()
          for (const [entityID, seq, hashes] of [
            [messageID, 0, user.hashes], [toolID, 1, tool.hashes], [inboxID, 2, user.hashes],
          ] as const)
            yield* SessionBlob.recordHashes(s.db, { sessionID: id, messageID: entityID, seq }, hashes)
          if (collected)
            for (const [kind, entityID] of [["message", messageID], ["message", toolID], ["inbox", inboxID]] as const)
              yield* capture(s, f.directory, kind, entityID)
          expect(yield* Store.packet(s.db, id)).toBeUndefined()
          // The native helper uses Database.db inside its transaction context, just like the projector.
          // A rolled-back cleanup leaves no ownership snapshots.
          expect(yield* s.db.transaction(() => Effect.gen(function* () {
            yield* SessionBlob.releaseSession(s.db, id)
            return yield* Effect.fail("rollback native cleanup")
          })).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
          expect(yield* s.db.all(sql`SELECT hash FROM _kilo_sync_media`)).toEqual([])
          expect(yield* s.db.all(sql`SELECT hash FROM blob`)).toEqual([{ hash }])
          yield* s.db.transaction((tx) => Effect.gen(function* () {
            yield* SessionBlob.releaseSession(s.db, id)
            yield* tx.delete(SessionTable).where(eq(SessionTable.id, id)).run()
          }))
          expect(yield* s.db.all(sql`SELECT hash FROM blob`)).toEqual([])
          expect(yield* s.db.all(sql`SELECT hash FROM blob_ref`)).toEqual([])
          expect(yield* s.db.all(sql`SELECT hash,bytes FROM _kilo_sync_media`)).toEqual([
            { hash, bytes: bytes.byteLength },
          ])
          expect(yield* s.db.all(sql`SELECT entity_id FROM _kilo_sync_media_reference ORDER BY entity_id`)).toEqual(
            [messageID, toolID, inboxID].sort().map((entity_id) => ({ entity_id })),
          )
        }))
        const restarted = yield* boot(f.root)
        yield* Assets.prune(restarted.db, restarted.global)
        // A retained content address is not global authorization for another entity.
        const unowned: Dirty = {
          session_id: id, kind: "message", id: "msg_unowned_after_delete", position: 1,
          op: "put", value: null, cause: null,
        }
        expect(yield* Assets.collect(restarted.db, restarted.global, f.directory, unowned, {
          message: { type: "user", files: [{ uri: `media:${hash}`, mime: "text/plain", source: { type: "inline" } }] },
        }).pipe(Effect.result)).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
        for (const [kind, entityID] of [["message", messageID], ["message", toolID], ["inbox", inboxID]] as const) {
          const captured = yield* capture(restarted, f.directory, kind, entityID)
          expect(captured.assets.blobs).toEqual([{ hash, bytes: bytes.byteLength }])
          expect(JSON.stringify(captured.value)).toContain(`media:${hash}`)
          const packet = yield* freeze(
            restarted.db,
            captured.row,
            [...captured.assets.changes, { op: "put", kind, id: entityID, value: captured.value }],
            captured.assets.blobs,
          )
          expect(packet.body).toContain(`media:${hash}`)
          expect(Buffer.from(yield* Assets.read(restarted.global, id, { hash, bytes: bytes.byteLength }))).toEqual(bytes)
          yield* acknowledge(restarted.db, packet)
        }
        expect(yield* restarted.db.all(sql`SELECT hash FROM _kilo_sync_media_reference`)).toEqual([])
        expect(yield* restarted.db.all(sql`SELECT hash FROM _kilo_sync_media`)).toEqual([])
      }),
  )

it.live("native cleanup never preserves media from a workspace that has not opted in", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    const split = SessionBlob.split({
      text: "private local media",
      files: [{ data: Buffer.from("not consented").toString("base64"), mime: "text/plain", source: { type: "inline" as const } }],
      time: { created: 1 },
    })
    yield* SessionBlob.save(s.db, split.blobs)
    yield* s.db.insert(SessionMessageTable).values({
      session_id: id, id: messageID, type: "user", seq: 0, data: split.data,
    }).run()
    yield* SessionBlob.recordHashes(s.db, { sessionID: id, messageID, seq: 0 }, split.hashes)
    yield* s.db.transaction((tx) => Effect.gen(function* () {
      yield* SessionBlob.releaseSession(s.db, id)
      yield* tx.delete(SessionTable).where(eq(SessionTable.id, id)).run()
    }))
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect(yield* s.db.all(sql`SELECT hash FROM _kilo_sync_media`)).toEqual([])
    expect(yield* s.db.all(sql`SELECT hash FROM _kilo_sync_media_reference`)).toEqual([])
  }),
)

it.live("legacy asset migration reconstructs acknowledged native split parts before pruning their only byte snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* enable(s.db, f.directory)
    const file = path.join(s.global.data, "tool-output", "legacy-split.bin")
    const bytes = Buffer.from("split native output retained after source cleanup")
    yield* Effect.promise(async () => {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, bytes)
    })
    yield* Assets.owned(s.db, s.global, f.directory, file)
    const data = toolData(pathToFileURL(file).href)
    yield* s.db.insert(SessionMessageTable).values({
      session_id: id, id: messageID, type: "assistant", seq: 0, data: { ...data, content: [] },
    }).run()
    const part = data.content[0]
    if (!part) return yield* Effect.die("Expected native output part")
    yield* s.db.insert(SessionPartTable).values({
      session_id: id, message_id: messageID, ordinal: 0, type: part.type, data: part,
    }).run()
    const captured = yield* capture(s, f.directory, "message", messageID)
    const packet = yield* freeze(
      s.db,
      captured.row,
      [...captured.assets.changes, { op: "put", kind: "message", id: messageID, value: captured.value }],
      captured.assets.blobs,
    )
    yield* acknowledge(s.db, packet)
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    yield* Effect.promise(() => rm(file))
    // A pre-reference-table journal has only the per-session locator/hash snapshot.
    yield* s.db.run(sql`DELETE FROM _kilo_sync_asset_reference WHERE session_id=${id}`)
    yield* Assets.prune(s.db, s.global)
    expect(yield* s.db.all(sql`SELECT entity_id,hash FROM _kilo_sync_asset_reference WHERE session_id=${id}`)).toEqual([
      { entity_id: messageID, hash: digest(bytes) },
    ])
    expect(Buffer.from(yield* Assets.read(s.global, id, { hash: digest(bytes), bytes: bytes.byteLength }))).toEqual(bytes)
  }),
)
