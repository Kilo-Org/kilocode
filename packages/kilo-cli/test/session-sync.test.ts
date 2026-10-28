import { expect } from "bun:test"
import { KiloSessionSync } from "@kilocode/kilo-plugin"
import { Context, Effect, Fiber, Layer, Schedule, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { Location } from "@opencode/core/location"
import { ToolOutput } from "@opencode/core/tool-output"
import { Workspace } from "@opencode/schema/workspace"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { ProjectTable } from "@opencode/core/project/sql"
import {
  SessionTable,
  SessionMessageTable,
  InstructionEntryTable,
  InstructionStateTable,
  InstructionBlobTable,
} from "@opencode/core/session/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionEvent } from "@opencode/core/session/event"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Instruction } from "@opencode/schema/instruction"
import { IntegrationID } from "@opencode/schema/integration-id"
import { AbsolutePath } from "@opencode/schema/schema"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { testEffect } from "../../core/test/lib/effect"
import { SessionSync } from "../src/session-sync"
import { Store } from "../src/session-sync/store"
import { Assets } from "../src/session-sync/assets"
import { SessionSyncOutput } from "../src/session-sync/tool-output"
import { type Receipt, Kind, digest, parse } from "../src/session-sync/protocol"

const it = testEffect(Layer.empty)
const id = Session.ID.make("ses_sync_consumer")
const messageID = SessionMessage.ID.make("msg_sync_consumer")
const WireChange = Schema.Struct({
  op: Schema.Literals(["put", "remove"]),
  kind: Kind,
  id: Schema.String,
  value: Schema.optional(Schema.Json),
  blob: Schema.optional(Schema.Struct({ hash: Schema.String, bytes: Schema.Number })),
})
const WirePacket = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    sourceID: Schema.String,
    batchID: Schema.String,
    after: Schema.Number,
    through: Schema.Number,
    changes: Schema.Array(WireChange),
  }),
)
const readPacket = Schema.decodeUnknownSync(WirePacket)

// This fault-injection HTTP peer is intentionally not a Worker proof. Assertions inspect durable
// native SQLite, frozen packet bytes and preserved files. The parent E2E uses the real Worker/R2.
const peer = () => {
  const states = new Map<
    string,
    {
      sourceID: string
      creatorID: string
      position: number
      lastReceipt: Receipt | null
      entities: Map<string, Schema.Json>
    }
  >()
  const blobs = new Map<string, Uint8Array>()
  const bodies: string[] = []
  const blobRequests: string[] = []
  const gate = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const control = {
    mode: "online" as "online" | "offline" | "lost-ack" | "gate" | "hang",
    sourceConflict: false,
    hangExchange: false,
    blobGateAt: 0,
    blobDelay: 0,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 60,
    fetch: async (request) => {
      const url = new URL(request.url)
      const error = (code: string, status: number) =>
        Response.json({ error: { code, message: "fixture failure" } }, { status })
      const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? ""
      if (url.pathname === "/v1/auth/exchange") {
        if (!token.startsWith("fixture:")) return error("invalid_credential", 401)
        if (control.hangExchange) {
          entered.resolve()
          await gate.promise
        }
        const userID = token.slice("fixture:".length)
        return Response.json({
          version: 1,
          token: `grant:${userID}`,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          tenant: { type: "user", id: userID },
          userID,
        })
      }
      if (!token.startsWith("grant:")) return error("invalid_grant", 401)
      if (control.mode === "hang") {
        entered.resolve()
        await gate.promise
      }
      const match = /^\/v1\/sessions\/([^/]+)(?:\/(batches|blobs)(?:\/([0-9a-f]{64}))?)?$/.exec(url.pathname)
      if (!match?.[1]) return error("not_found", 404)
      const sessionID = decodeURIComponent(match[1])
      const userID = token.slice("grant:".length)
      if (match[2] === "batches") {
        const body = await request.text()
        bodies.push(body)
        if (control.mode === "offline") return error("internal_error", 503)
        const packet = readPacket(body)
        const state = states.get(sessionID)
        if (!state) return error("session_not_found", 404)
        if (state.creatorID !== userID) return error("creator_mismatch", 403)
        if (state.sourceID !== packet.sourceID) return error("source_conflict", 409)
        if (state.position !== packet.after) return error("position_conflict", 409)
        for (const change of packet.changes) {
          const key = `${change.kind}/${change.id}`
          if (change.op === "remove") state.entities.delete(key)
          else if (change.blob) {
            const bytes = blobs.get(`${sessionID}/${change.blob.hash}`)
            if (!bytes || bytes.byteLength !== change.blob.bytes) return error("blob_missing", 409)
            state.entities.set(key, parse(Buffer.from(bytes).toString("utf8")))
          } else if (change.value !== undefined) state.entities.set(key, change.value)
        }
        const receipt = {
          version: 1 as const,
          sessionID,
          batchID: packet.batchID,
          after: packet.after,
          through: packet.through,
          revision: state.position + 1,
          changes: packet.changes.length,
          digest: digest(body),
          committedAt: Date.now(),
        }
        state.position = packet.through
        state.lastReceipt = receipt
        if (control.mode === "lost-ack") {
          control.mode = "online"
          return error("internal_error", 503)
        }
        if (control.mode === "gate") {
          entered.resolve()
          await gate.promise
        }
        return Response.json(receipt)
      }
      if (control.mode === "offline") return error("internal_error", 503)
      if (match[2] === "blobs" && match[3]) {
        blobRequests.push(match[3])
        if (blobRequests.length === control.blobGateAt) {
          entered.resolve()
          await gate.promise
        }
        if (control.blobDelay) await Bun.sleep(control.blobDelay)
        const bytes = new Uint8Array(await request.arrayBuffer())
        if (digest(bytes) !== match[3] || Number(request.headers.get("content-length")) !== bytes.byteLength)
          return error("blob_hash_mismatch", 400)
        blobs.set(`${sessionID}/${match[3]}`, bytes)
        return Response.json({ version: 1, hash: match[3], bytes: bytes.byteLength, created: true })
      }
      let state = states.get(sessionID)
      if (!state && request.method === "PUT") {
        const value = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.Literal(1), sourceID: Schema.String }))(
          await request.json(),
        )
        state = { sourceID: value.sourceID, creatorID: userID, position: 0, lastReceipt: null, entities: new Map() }
        states.set(sessionID, state)
      }
      if (!state) return error("session_not_found", 404)
      return Response.json({
        version: 1,
        sessionID,
        deleted: false,
        tenant: { type: "user", id: state.creatorID },
        creatorID: state.creatorID,
        sourceID: control.sourceConflict ? randomUUID() : state.sourceID,
        position: state.position,
        lastReceipt: state.lastReceipt,
      })
    },
  })
  return {
    states,
    blobs,
    bodies,
    blobRequests,
    control,
    gate,
    entered,
    url: server.url.origin,
    close: () => server.stop(true),
  }
}

const fixture = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "kilo-sync-consumer-"))),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  )
  const backend = yield* Effect.acquireRelease(Effect.sync(peer), (backend) =>
    Effect.sync(() => {
      backend.close()
    }),
  )
  yield* Effect.promise(() =>
    Promise.all(
      ["workspace", "excluded", "data", "cache", "config", "state", "tmp"].map((name) =>
        mkdir(path.join(root, name), { recursive: true }),
      ),
    ),
  )
  const keys = ["KILO_API_KEY", "KILOCODE_TOKEN", "KILO_AUTH_CONTENT"]
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = keys.map((key) => process.env[key])
      keys.forEach((key) => {
        delete process.env[key]
      })
      return previous
    }),
    (previous) =>
      Effect.sync(() =>
        keys.forEach((key, index) => {
          const value = previous[index]
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }),
      ),
  )
  return { root, backend, directory: path.join(root, "workspace"), excluded: path.join(root, "excluded") }
})

const boot = (root: string, options: { background?: boolean; flushTimeout?: number } = {}) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([SessionSync.node, Database.node, Bus.node, Credential.node, Global.node]), [
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
        SessionProjector.node.replace(SessionProjector.node.mapLayer(SessionSync.captureLayer)),
        SessionSync.node.replace(
          makeGlobalNode({
            service: KiloSessionSync.Service,
            layer: Layer.effect(KiloSessionSync.Service, SessionSync.make({ background: false, ...options })),
            deps: [Database.node, Bus.node, SessionProjector.node, Credential.node, Global.node],
          }),
        ),
      ]),
    )
    const db = Context.get(context, Database.Service).db
    const sync = Context.get(context, KiloSessionSync.Service)
    const global = Context.get(context, Global.Service)
    const output = (directory: string, workspaceID?: Workspace.ID) =>
      Effect.gen(function* () {
        const layers = yield* Layer.build(
          AppNodeBuilder.build(SessionSyncOutput.node, [
            Database.node.replace(Layer.succeed(Database.Service, { db })),
            Global.node.replace(Layer.succeed(Global.Service, global)),
            SessionSync.node.replace(
              makeGlobalNode({
                service: KiloSessionSync.Service,
                layer: Layer.succeed(KiloSessionSync.Service, sync),
                deps: [],
              }),
            ),
            Location.node.replace(
              Layer.succeed(
                Location.Service,
                new Location.Info({
                  directory: AbsolutePath.make(directory),
                  ...(workspaceID === undefined ? {} : { workspaceID }),
                  project: {
                    id: Project.ID.global,
                    directory: AbsolutePath.make(directory),
                    canonical: AbsolutePath.make(directory),
                  },
                }),
              ),
            ),
          ]),
        )
        return Context.get(layers, ToolOutput.Service)
      })
    return {
      db,
      sync,
      global,
      output,
      bus: Context.get(context, Bus.Service),
      credentials: Context.get(context, Credential.Service),
    }
  })

const seed = (db: Store.DB, directory: string, sessionID = id) =>
  Effect.gen(function* () {
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        directory,
        slug: "sync-consumer",
        version: "test",
        title: "before",
        time_created: 10,
        time_updated: 20,
        cost: 1.25,
        tokens_input: 17,
        tokens_output: 9,
        tokens_reasoning: 2,
        tokens_cache_read: 3,
        tokens_cache_write: 4,
      })
      .run()
  })
const writeMessage = (db: Store.DB, text: string, sessionID = id, seq = 0, message = messageID) =>
  db
    .insert(SessionMessageTable)
    .values({ session_id: sessionID, id: message, type: "user", seq, data: { text, time: { created: 10 } } })
    .onConflictDoUpdate({ target: SessionMessageTable.id, set: { data: { text, time: { created: 10 } } } })
    .run()
const allow = (db: Store.DB, directory: string, backend: { url: string }) =>
  Store.enable(db, {
    directory,
    destination: backend.url,
    local: true,
    organizationID: null,
    tenant: { type: "user", id: "alice" },
    userID: "alice",
  }).pipe(Effect.andThen(Store.reconcile(db, directory, true)))
const signIn = (credentials: Credential.Interface, user = "alice") =>
  credentials.create({ integrationID: IntegrationID.make("kilo"), value: { type: "key", key: `fixture:${user}` } })
const writeTool = (
  db: Store.DB,
  metadata: Record<string, Schema.Json> = {},
  uri?: string,
  input: Record<string, Schema.Json> = {},
) => {
  const encoded = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.Assistant))({
    id: messageID,
    type: "assistant",
    agent: "build",
    model: { id: "fixture", providerID: "fixture", variant: "default" },
    content: [
      {
        type: "tool",
        id: "call_fixture",
        name: "fixture",
        time: { created: 10, completed: 11 },
        state: {
          status: "completed",
          input,
          metadata,
          content: uri ? [{ type: "file", uri, mime: "application/octet-stream" }] : [{ type: "text", text: "output" }],
        },
      },
    ],
    time: { created: 10, completed: 11 },
  })
  const { id: message, type, ...data } = encoded
  return db
    .insert(SessionMessageTable)
    .values({ id: SessionMessage.ID.make(message), session_id: id, type, seq: 0, data })
    .run()
}

it.live("consent excludes another clone and bootstraps existing native sessions including cost and tokens", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    const excludedID = Session.ID.make("ses_excluded")
    yield* seed(s.db, f.excluded, excludedID)
    yield* writeMessage(s.db, "existing")
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    yield* allow(s.db, f.directory, f.backend)
    expect((yield* Store.dirty(s.db, id)).map((row) => row.kind)).toContain("message")
    expect(yield* Store.dirty(s.db, excludedID)).toEqual([])
    const row = (yield* Store.dirty(s.db, id)).find((row) => row.kind === "session")
    expect(row && Store.value(row)).toMatchObject({
      cost: 1.25,
      tokens: { input: 17, output: 9, reasoning: 2, cache: { read: 3, write: 4 } },
      origin: { directory: f.directory },
    })
    expect(row?.value).not.toContain("time_suspended")
    expect(row && Store.value(row)).not.toHaveProperty("location")
  }),
)

it.live(
  "direct import and instruction writes capture transactionally and roll back with their native transaction",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* allow(s.db, f.directory, f.backend)
      yield* seed(s.db, f.directory)
      yield* writeMessage(s.db, "imported direct row")
      yield* s.db
        .insert(InstructionEntryTable)
        .values({ session_id: id, key: "policy", value: { text: "native value" } })
        .run()
      const hash = Instruction.Hash.make("a".repeat(64))
      yield* s.db
        .insert(InstructionBlobTable)
        .values({ hash, value: { text: "logical body" } })
        .run()
      yield* s.db
        .insert(InstructionStateTable)
        .values({
          session_id: id,
          epoch_start: 0,
          through_seq: 0,
          initial_values: { "test/policy": hash },
          current_values: { "test/policy": hash },
        })
        .run()
      expect((yield* Store.dirty(s.db, id)).map((row) => row.kind)).toEqual(
        expect.arrayContaining(["session", "message", "instruction-entry", "instruction-state", "instruction-blob"]),
      )
      const before = yield* Store.dirty(s.db, id)
      yield* s.db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(InstructionEntryTable)
              .set({ value: { text: "must roll back" } })
              .where(eq(InstructionEntryTable.session_id, id))
              .run()
            return yield* Effect.fail("rollback")
          }),
        )
        .pipe(Effect.result)
      expect(yield* Store.dirty(s.db, id)).toEqual(before)
    }),
)

it.live("immutable outbox survives a real SQLite close/reopen and ACK preserves a newer dirty version", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    let frozen: Store.Packet | undefined
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f.root)
        yield* seed(s.db, f.directory)
        yield* allow(s.db, f.directory, f.backend)
        const session = (yield* Store.sessions(s.db, f.directory))[0]
        const row = (yield* Store.dirty(s.db, id))[0]
        if (!session || !row) return yield* Effect.die("Missing consumer seed")
        frozen = yield* Store.freeze(
          s.db,
          session,
          [{ op: "put", kind: row.kind, id: row.id, value: Store.value(row) }],
          row.position,
          [],
        )
        yield* s.db.update(SessionTable).set({ title: "newer" }).where(eq(SessionTable.id, id)).run()
      }),
    )
    const s = yield* boot(f.root)
    const pending = yield* Store.packet(s.db, id)
    expect(pending).toEqual(frozen)
    if (!pending) return yield* Effect.die("Pending packet disappeared")
    expect(digest(pending.body)).toBe(pending.digest)
    yield* Store.acknowledge(s.db, pending, {
      version: 1,
      sessionID: id,
      batchID: pending.batch_id,
      after: pending.after,
      through: pending.through,
      digest: pending.digest,
      revision: 1,
      changes: 1,
      committedAt: Date.now(),
    })
    expect((yield* Store.dirty(s.db, id)).map((row) => row.value).join()).toContain("newer")
    expect(yield* Store.packet(s.db, id)).toBeUndefined()
  }),
)

it.live(
  "native delivery is consumed, committed revert is revert, and cleared revert never authorizes maintenance erase",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      yield* allow(s.db, f.directory, f.backend)
      const pending = SessionMessage.ID.make("msg_pending_sync")
      yield* s.bus.publish(SessionEvent.InboxEnqueued, {
        sessionID: id,
        inboxID: pending,
        item: { type: "user", payload: { text: "delivered" }, delivery: "queue" },
      })
      yield* s.bus.publish(SessionEvent.InboxDelivered, { sessionID: id, inboxID: pending })
      expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "inbox" && row.id === pending)).toMatchObject({
        op: "remove",
        cause: "consumed",
      })
      const boundary = SessionMessage.ID.make("msg_revert_sync")
      yield* writeMessage(s.db, "boundary", id, 2, boundary)
      yield* s.bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: id,
        revert: { messageID: boundary, files: [] },
      })
      yield* s.bus.publish(SessionEvent.RevertEvent.Cleared, { sessionID: id })
      yield* s.db.delete(SessionMessageTable).where(eq(SessionMessageTable.id, pending)).run()
      expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "message" && row.id === pending)).toMatchObject({
        op: "remove",
        cause: null,
      })
      yield* s.bus.publish(SessionEvent.RevertEvent.Staged, {
        sessionID: id,
        revert: { messageID: boundary, files: [] },
      })
      yield* s.bus.publish(SessionEvent.RevertEvent.Committed, { sessionID: id, to: boundary })
      expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "message" && row.id === boundary)).toMatchObject(
        { op: "remove", cause: "revert" },
      )
      expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "message" && row.id === pending)).toMatchObject({
        cause: null,
      })
      expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_intent`)).toEqual([])
    }),
)

it.live("fork copies and direct instruction removal enter the same native capture boundary", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "parent history")
    yield* allow(s.db, f.directory, f.backend)
    const fork = Session.ID.make("ses_native_fork_sync")
    yield* s.bus.publish(SessionEvent.Forked, {
      sessionID: fork,
      parentID: id,
      boundary: { type: "through", messageID },
    })
    const copied = yield* Store.dirty(s.db, fork)
    expect(copied.find((row) => row.kind === "message")?.value).toContain("parent history")
    expect(copied.find((row) => row.kind === "session")?.value).toContain(id)
    yield* s.db
      .insert(InstructionEntryTable)
      .values({ session_id: fork, key: "policy", value: { text: "remove this" } })
      .run()
    yield* s.db
      .update(InstructionEntryTable)
      .set({ removed: true })
      .where(eq(InstructionEntryTable.session_id, fork))
      .run()
    expect((yield* Store.dirty(s.db, fork)).find((row) => row.kind === "instruction-entry")).toMatchObject({
      op: "remove",
      cause: "instruction-removed",
    })
  }),
)

it.live("semantic marker and native deletion roll back together when a later projector fails", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    const pending = SessionMessage.ID.make("msg_cancel_rollback_sync")
    yield* s.bus.publish(SessionEvent.InboxEnqueued, {
      sessionID: id,
      inboxID: pending,
      item: { type: "user", payload: { text: "keep pending" }, delivery: "queue" },
    })
    const before = yield* Store.dirty(s.db, id)
    yield* s.bus.project(SessionEvent.InboxCancelled, () => Effect.die("late projector refuses cancellation"))
    yield* s.bus.publish(SessionEvent.InboxCancelled, { sessionID: id, inboxID: pending }).pipe(Effect.exit)
    expect(yield* Store.dirty(s.db, id)).toEqual(before)
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_intent`)).toEqual([])
    expect(yield* s.db.get(sql`SELECT id FROM session_inbox WHERE id=${pending}`)).toMatchObject({ id: pending })
  }),
)

it.live(
  "local session deletion retains frozen intent and never creates cloud session or cascade removal operations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      yield* writeMessage(s.db, "preserved before local delete")
      yield* allow(s.db, f.directory, f.backend)
      const before = yield* Store.dirty(s.db, id)
      yield* s.bus.publish(SessionEvent.Deleted, { sessionID: id })
      expect(yield* Store.dirty(s.db, id)).toEqual(before)
      expect((yield* Store.sessions(s.db, f.directory))[0]).toMatchObject({ local_deleted: 1 })
      expect(before.every((row) => row.op !== "remove")).toBe(true)
    }),
)

it.live(
  "real HTTP retries the identical frozen bytes after restart and recovers a committed lost ACK without reapplying",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const body = yield* Effect.scoped(
        Effect.gen(function* () {
          const s = yield* boot(f.root)
          yield* signIn(s.credentials)
          yield* seed(s.db, f.directory)
          yield* writeMessage(s.db, "offline persistent message")
          yield* s.sync.enable({
            directory: f.directory,
            destination: f.backend.url,
            local: true,
            organizationID: null,
          })
          f.backend.control.mode = "offline"
          expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
          const packet = yield* Store.packet(s.db, id)
          if (!packet) throw new Error("The failed upload must retain its immutable packet")
          for (let attempt = 0; attempt < 10; attempt++) {
            expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
            expect((yield* Store.packet(s.db, id))?.body).toBe(packet.body)
          }
          return packet.body
        }),
      )
      const s = yield* boot(f.root)
      expect((yield* Store.packet(s.db, id))?.body).toBe(body)
      f.backend.control.mode = "lost-ack"
      const lost = yield* s.sync.flush({ directory: f.directory })
      expect(lost.pending).toBeGreaterThan(0)
      expect(f.backend.bodies).toEqual([body])
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.bodies).toEqual([body])
      expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
        message: { text: "offline persistent message" },
      })
    }),
)

it.live("mutation during actual HTTP upload survives ACK and subsequently reaches the cloud peer", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "first")
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    f.backend.control.mode = "gate"
    const uploading = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    yield* writeMessage(s.db, "second while upload awaits ACK")
    expect((yield* s.sync.disable({ directory: f.directory })).enabled).toBe(false)
    f.backend.control.mode = "offline"
    f.backend.gate.resolve()
    expect((yield* Fiber.join(uploading)).pending).toBeGreaterThan(0)
    expect((yield* Store.dirty(s.db, id)).map((row) => row.value).join()).toContain("second while upload awaits ACK")
    f.backend.control.mode = "online"
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "second while upload awaits ACK" },
    })
  }),
)

it.live("source conflicts and an actual stored credential switch pause pinned workspace uploads", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    const alice = yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    f.backend.control.sourceConflict = true
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("source_conflict")
    expect(f.backend.bodies).toEqual([])
    f.backend.control.sourceConflict = false
    yield* signIn(s.credentials, "bob")
    const changed = yield* s.sync.flush({ directory: f.directory })
    expect(changed.error?.code).toBe("account_changed")
    expect(changed.userID).toBe("alice")
    expect(f.backend.bodies).toEqual([])
    yield* s.credentials.activate(alice.id)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live(
  "accepted output bytes survive source cleanup and restart, with actual blobs uploaded before their references",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const output = path.join(f.directory, "output.txt")
      const bytes = Buffer.from("required retained native output\n")
      yield* Effect.promise(() => writeFile(output, bytes))
      yield* Effect.scoped(
        Effect.gen(function* () {
          const s = yield* boot(f.root)
          yield* signIn(s.credentials)
          yield* seed(s.db, f.directory)
          yield* writeTool(s.db, { truncated: true, outputPath: output })
          yield* s.sync.enable({
            directory: f.directory,
            destination: f.backend.url,
            local: true,
            organizationID: null,
            assets: [output],
          })
          f.backend.control.mode = "offline"
          yield* s.sync.flush({ directory: f.directory })
          const packet = yield* Store.packet(s.db, id)
          expect(packet).toBeDefined()
          expect(
            Buffer.from(yield* Effect.promise(() => readFile(Assets.filename(s.global, id, digest(bytes))))).toString(),
          ).toBe(bytes.toString())
        }),
      )
      yield* Effect.promise(() => unlink(output))
      const s = yield* boot(f.root)
      f.backend.control.mode = "online"
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(Buffer.from(f.backend.blobs.get(`${id}/${digest(bytes)}`) ?? []).toString()).toBe(bytes.toString())
      expect([...(f.backend.states.get(id)?.entities.keys() ?? [])].some((key) => key.startsWith("asset/"))).toBe(true)
    }),
)

it.live(
  "asset discovery refuses foreign paths and escaping symlinks instead of reading private bytes or claiming completion",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const outside = path.join(f.excluded, "private.txt")
      const link = path.join(f.directory, "escape.txt")
      yield* Effect.promise(() => writeFile(outside, "must not leave excluded workspace"))
      yield* Effect.promise(() => symlink(outside, link))
      yield* writeTool(s.db, { truncated: true, outputPath: link })
      yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
      const result = yield* s.sync.flush({ directory: f.directory })
      expect(result.error?.code).toBe("asset_error")
      expect(result.pending).toBeGreaterThan(0)
      expect(f.backend.blobs.size).toBe(0)
      expect(f.backend.bodies).toEqual([])
      expect(yield* Store.packet(s.db, id)).toBeUndefined()
    }),
)

it.live(
  "large logical instruction values retain their native identity while serialized bytes use a distinct R2 digest",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const hash = Instruction.Hash.make("b".repeat(64))
      const value = { text: "required instruction body ".repeat(4000) }
      yield* s.db.insert(InstructionBlobTable).values({ hash, value }).run()
      yield* s.db
        .insert(InstructionStateTable)
        .values({
          session_id: id,
          epoch_start: 0,
          through_seq: 0,
          initial_values: { "test/policy": hash },
          current_values: { "test/policy": hash },
        })
        .run()
      yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      const wireHash = digest(JSON.stringify(value))
      expect(wireHash).not.toBe(hash)
      expect(Buffer.from(f.backend.blobs.get(`${id}/${wireHash}`) ?? []).toString()).toBe(JSON.stringify(value))
      expect(f.backend.states.get(id)?.entities.get(`instruction-blob/${hash}`)).toEqual(value)
      expect(f.backend.states.get(id)?.entities.get(`instruction-state/${id}`)).toMatchObject({
        currentValues: { "test/policy": hash },
      })
    }),
)

it.live("disable stops transport immediately but retains semantic journal updates for a later explicit enable", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "first admitted message")
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* s.sync.disable({ directory: f.directory })
    yield* writeMessage(s.db, "edited while disabled")
    const pending = yield* s.sync.status({ directory: f.directory })
    expect(pending.enabled).toBe(false)
    expect(pending.pending).toBeGreaterThan(0)
    const rejected = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result)
    expect(rejected).toMatchObject({ _tag: "Failure", failure: { code: "sync_disabled" } })
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "first admitted message" },
    })
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "edited while disabled" },
    })
  }),
)

it.live("HTTP requires explicit local consent and oversized or missing assets remain visibly pending", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    expect(
      yield* s.sync
        .enable({ directory: f.directory, destination: f.backend.url, local: false, organizationID: null })
        .pipe(Effect.result),
    ).toMatchObject({ _tag: "Failure", failure: { code: "invalid_destination" } })
    expect((yield* s.sync.status({ directory: f.directory })).enabled).toBe(false)
    expect(yield* Assets.spool(s.global, id, new Uint8Array(8 * 1024 * 1024 + 1)).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "asset_error" },
    })
    yield* writeTool(s.db, { truncated: true, outputPath: path.join(f.directory, "never-existed.txt") })
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect(yield* s.sync.flush({ directory: f.directory })).toMatchObject({
      enabled: true,
      error: { code: "asset_error" },
    })
    expect((yield* s.sync.status({ directory: f.directory })).pending).toBeGreaterThan(0)
    expect(f.backend.bodies).toEqual([])
    expect(f.backend.blobs.size).toBe(0)
  }),
)

it.live("native admitted attachment bytes remain verbatim and have an explicit private asset mapping", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    const bytes = Buffer.from([0, 17, 255, 128, 42])
    const file = {
      data: bytes.toString("base64"),
      mime: "application/octet-stream",
      source: { type: "inline" as const },
      name: "native.bin",
    }
    yield* s.db
      .insert(SessionMessageTable)
      .values({
        id: messageID,
        session_id: id,
        type: "user",
        seq: 0,
        data: { text: "admitted attachment", files: [file], time: { created: 10 } },
      })
      .run()
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({ message: { files: [file] } })
    const mapping = f.backend.states.get(id)?.entities.get(`asset/${digest(`message:${messageID}:/message/files/0`)}`)
    expect(mapping).toMatchObject({
      entity: { kind: "message", id: messageID },
      pointer: "/message/files/0",
      reference: "inline",
      blob: { hash: digest(bytes), bytes: bytes.byteLength },
    })
    expect(f.backend.blobs.get(`${id}/${digest(bytes)}`)).toEqual(new Uint8Array(bytes))
  }),
)

it.live("transcript hash strings cannot dereference another workspace's global instruction blobs", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    const excluded = Session.ID.make("ses_private_instruction_workspace")
    yield* seed(s.db, f.excluded, excluded)
    const hash = Instruction.Hash.make("c".repeat(64))
    yield* s.db
      .insert(InstructionBlobTable)
      .values({ hash, value: { text: "private excluded instruction" } })
      .run()
    yield* s.db
      .insert(InstructionStateTable)
      .values({
        session_id: excluded,
        epoch_start: 0,
        through_seq: 0,
        initial_values: { "private/policy": hash },
        current_values: { "private/policy": hash },
      })
      .run()
    yield* writeMessage(s.db, hash)
    yield* allow(s.db, f.directory, f.backend)
    expect((yield* Store.dirty(s.db, id)).some((row) => row.kind === "instruction-blob")).toBe(false)
    expect(yield* Store.dirty(s.db, excluded)).toEqual([])
  }),
)

it.live("restart completes an enrolled-but-incomplete bootstrap and commits its marker with the full snapshot", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f.root)
        yield* seed(s.db, f.directory)
        yield* writeMessage(s.db, "history predating consent")
        yield* s.db
          .insert(InstructionStateTable)
          .values({ session_id: id, epoch_start: 0, through_seq: 0, initial_values: {}, current_values: {} })
          .run()
        // Consent committed, then native mutation enrolls the session before the initial scan.
        yield* s.db
          .run(sql`INSERT INTO _kilo_sync_consent(directory,enabled,destination,local,organization_id,tenant_type,tenant_id,user_id,source_id)
      VALUES(${f.directory},1,${f.backend.url},1,NULL,'user','alice','alice',${randomUUID()})`)
        yield* s.db.run(sql`INSERT INTO _kilo_sync_directory(alias,directory) VALUES(${f.directory},${f.directory})`)
        yield* s.db
          .update(SessionTable)
          .set({ title: "mutation during initial scan" })
          .where(eq(SessionTable.id, id))
          .run()
        expect((yield* Store.sessions(s.db, f.directory))[0]?.bootstrap_complete).toBe(0)
        expect((yield* Store.dirty(s.db, id)).some((row) => row.kind === "message")).toBe(false)
        yield* s.db.run(
          `CREATE TRIGGER _test_sync_bootstrap_abort BEFORE UPDATE ON instruction_state BEGIN SELECT RAISE(ABORT,'bootstrap interrupted'); END`,
        )
        yield* Store.reconcile(s.db).pipe(Effect.exit)
        expect((yield* Store.sessions(s.db, f.directory))[0]?.bootstrap_complete).toBe(0)
        expect((yield* Store.dirty(s.db, id)).some((row) => row.kind === "message")).toBe(false)
        yield* s.db.run(`DROP TRIGGER _test_sync_bootstrap_abort`)
      }),
    )
    const s = yield* boot(f.root)
    expect((yield* Store.sessions(s.db, f.directory))[0]?.bootstrap_complete).toBe(1)
    expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "message")?.value).toContain(
      "history predating consent",
    )
    expect((yield* Store.dirty(s.db, id)).some((row) => row.kind === "instruction-state")).toBe(true)
  }),
)

it.live("directory consent includes local descendants but excludes sibling clones and explicit workspace drivers", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    const child = path.join(f.directory, "child")
    yield* Effect.promise(() => mkdir(child))
    yield* seed(s.db, child)
    yield* writeMessage(s.db, "local descendant")
    const excluded = Session.ID.make("ses_sibling_clone")
    const remote = Session.ID.make("ses_remote_driver")
    yield* seed(s.db, f.excluded, excluded)
    yield* s.db
      .insert(SessionTable)
      .values({
        id: remote,
        project_id: Project.ID.global,
        directory: child,
        workspace_id: Workspace.ID.make("wrk_remote"),
        slug: "remote",
        version: "test",
      })
      .run()
    yield* allow(s.db, f.directory, f.backend)
    expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "message")?.value).toContain("local descendant")
    expect(yield* Store.dirty(s.db, excluded)).toEqual([])
    expect(yield* Store.dirty(s.db, remote)).toEqual([])
    const remoteOutput = yield* s.output(child, Workspace.ID.make("wrk_remote"))
    const remoteFile = yield* remoteOutput.save(Buffer.from("remote driver bytes"), ".txt")
    expect(yield* s.db.get(sql`SELECT * FROM _kilo_sync_owned_asset WHERE path=${remoteFile}`)).toBeUndefined()
  }),
)

it.live("reimport of a locally deleted identity pauses visibly and preserves the previous cloud acknowledgement", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "original cloud history")
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const original = (yield* Store.sessions(s.db, f.directory))[0]
    const requests = f.backend.bodies.length
    yield* s.bus.publish(SessionEvent.Deleted, { sessionID: id })
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "ambiguous partial backup")
    yield* s.db.update(SessionTable).set({ title: "edited after reimport" }).where(eq(SessionTable.id, id)).run()
    const status = yield* s.sync.flush({ directory: f.directory })
    expect(status.error?.code).toBe("identity_conflict")
    expect(status.pending).toBeGreaterThan(0)
    expect((yield* Store.sessions(s.db, f.directory))[0]?.acknowledged).toBe(original?.acknowledged)
    expect(f.backend.bodies.length).toBe(requests)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "original cloud history" },
    })
  }),
)

it.live("a missing logical instruction blob is not JSON null, while an actual native null remains valid", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    const enabled = yield* s.sync.enable({
      directory: f.directory,
      destination: f.backend.url,
      local: true,
      organizationID: null,
    })
    expect(enabled).toMatchObject({ sessions: 1, pending: 1 })
    const hash = Instruction.Hash.make("d".repeat(64))
    yield* s.db
      .insert(InstructionStateTable)
      .values({
        session_id: id,
        epoch_start: 0,
        through_seq: 0,
        initial_values: { "test/missing": hash },
        current_values: { "test/missing": hash },
      })
      .run()
    expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "instruction-blob")?.value).toBeNull()
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("missing_instruction_blob")
    expect(f.backend.bodies).toEqual([])
    yield* s.db.insert(InstructionBlobTable).values({ hash, value: null }).run()
    expect((yield* Store.dirty(s.db, id)).find((row) => row.kind === "instruction-blob")?.value).toBe("null")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`instruction-blob/${hash}`)).toBeNull()
  }),
)

it.live(
  "the first background tick rechecks a persisted authentication pause after credentials changed while stopped",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      yield* Effect.scoped(
        Effect.gen(function* () {
          const s = yield* boot(f.root)
          const alice = yield* signIn(s.credentials)
          yield* seed(s.db, f.directory)
          yield* writeMessage(s.db, "restart auth recovery")
          yield* s.sync.enable({
            directory: f.directory,
            destination: f.backend.url,
            local: true,
            organizationID: null,
          })
          yield* signIn(s.credentials, "bob")
          expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("account_changed")
          yield* s.credentials.activate(alice.id)
        }),
      )
      const s = yield* boot(f.root, { background: true })
      const settled = yield* s.sync
        .status({ directory: f.directory })
        .pipe(
          Effect.repeat({ schedule: Schedule.spaced(10), until: (status) => status.pending === 0 }),
          Effect.timeoutOption(5000),
        )
      expect(settled._tag).toBe("Some")
      expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
        message: { text: "restart auth recovery" },
      })
    }),
)

it.live("the flush deadline aborts a hanging HTTP pass without changing its frozen packet", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root, { flushTimeout: 200 })
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    f.backend.control.mode = "offline"
    yield* s.sync.flush({ directory: f.directory })
    const before = yield* Store.packet(s.db, id)
    expect(before).toBeDefined()
    f.backend.control.mode = "hang"
    const start = Date.now()
    expect(yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "flush_timeout" },
    })
    expect(Date.now() - start).toBeLessThan(3000)
    expect(yield* Store.packet(s.db, id)).toEqual(before)
    f.backend.control.mode = "online"
    f.backend.gate.resolve()
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live("the flush deadline starts after another operation releases the synchronization semaphore", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root, { flushTimeout: 200 })
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    yield* signIn(s.credentials, "bob")
    f.backend.control.hangExchange = true
    const holder = yield* s.sync
      .enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
      .pipe(Effect.result, Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    yield* signIn(s.credentials)
    const flush = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result, Effect.forkScoped)
    yield* Effect.sleep(300)
    f.backend.control.hangExchange = false
    f.backend.gate.resolve()
    expect(yield* Fiber.join(holder)).toMatchObject({ _tag: "Failure", failure: { code: "consent_conflict" } })
    expect(yield* Fiber.join(flush)).toMatchObject({ _tag: "Success", success: { pending: 0 } })
    expect((yield* s.sync.status({ directory: f.directory })).userID).toBe("alice")
  }),
)

it.live("native save and new truncation output acquire provenance and remain portable after source cleanup", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    const output = yield* s.output(f.directory)
    const bytes = Buffer.from("owned native binary output")
    const file = yield* output.save(bytes, ".bin")
    yield* writeTool(s.db, {}, pathToFileURL(file).href)
    yield* Effect.promise(() => unlink(file))
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(Buffer.from(f.backend.blobs.get(`${id}/${digest(bytes)}`) ?? []).toString()).toBe(bytes.toString())
    yield* output.transform((editor) => editor.configure({ maxLines: 1, maxBytes: 100 }))
    const truncated = yield* output.truncate({ content: [{ type: "text", text: "first\nsecond" }] })
    const created = truncated.metadata?.outputPath
    if (typeof created !== "string") return yield* Effect.die("Native truncation failed to create its output")
    expect(yield* s.db.get(sql`SELECT path FROM _kilo_sync_owned_asset WHERE path=${created}`)).toEqual({
      path: created,
    })
    const forged = {
      content: [{ type: "text" as const, text: "opaque caller content" }],
      metadata: { truncated: true, outputPath: path.join(f.excluded, "forged.txt") },
    }
    expect(yield* output.truncate(forged)).toBe(forged)
    expect(
      yield* s.db.get(sql`SELECT path FROM _kilo_sync_owned_asset WHERE path=${forged.metadata.outputPath}`),
    ).toBeUndefined()
  }),
)

it.live("sync pin failure never breaks the native tool or claims oversized output was synchronized", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    const output = yield* s.output(f.directory)
    const file = yield* output.save(new Uint8Array(8 * 1024 * 1024 + 1), ".bin")
    expect((yield* Effect.promise(() => readFile(file))).byteLength).toBe(8 * 1024 * 1024 + 1)
    yield* writeTool(s.db, {}, pathToFileURL(file).href)
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("asset_error")
    expect(f.backend.blobs.size).toBe(0)
  }),
)

it.live("forged user metadata and tool inputs stay opaque, and another workspace's output needs exact approval", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    const foreignOutput = yield* s.output(f.excluded)
    const file = yield* foreignOutput.save(Buffer.from("excluded workspace secret"), ".txt")
    const cache = path.join(s.global.cache, "foreign-cache.txt")
    yield* Effect.promise(() => writeFile(cache, "private shared cache"))
    yield* writeTool(s.db, {}, undefined, {
      outputPath: file,
      fake: { type: "file", uri: pathToFileURL(cache).href, mime: "text/plain" },
    })
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.blobs.size).toBe(0)
    yield* s.db
      .update(SessionMessageTable)
      .set({
        data: {
          text: "opaque metadata",
          metadata: { outputPath: cache, file: { type: "file", uri: pathToFileURL(file).href, mime: "text/plain" } },
          time: { created: 10 },
        },
        type: "user",
      })
      .where(eq(SessionMessageTable.id, messageID))
      .run()
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.blobs.size).toBe(0)
    yield* s.db.delete(SessionMessageTable).where(eq(SessionMessageTable.id, messageID)).run()
    yield* writeTool(s.db, {}, pathToFileURL(file).href)
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("asset_error")
    expect(f.backend.blobs.size).toBe(0)
    yield* s.sync.enable({
      directory: f.directory,
      destination: f.backend.url,
      local: true,
      organizationID: null,
      assets: [file],
    })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(Buffer.from(f.backend.blobs.get(`${id}/${digest("excluded workspace secret")}`) ?? []).toString()).toBe(
      "excluded workspace secret",
    )
  }),
)

it.live(
  "an explicitly listed FIFO is rejected before open without a writer, rather than blocking synchronization",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const pipe = path.join(f.directory, "named-pipe")
      yield* Effect.sync(() => execFileSync("mkfifo", [pipe]))
      const result = yield* s.sync
        .enable({
          directory: f.directory,
          destination: f.backend.url,
          local: true,
          organizationID: null,
          assets: [pipe],
        })
        .pipe(Effect.result, Effect.timeoutOption(1000))
      expect(result).toMatchObject({ _tag: "Some", value: { _tag: "Failure", failure: { code: "asset_error" } } })
      expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)).toEqual([])
      expect(f.backend.blobs.size).toBe(0)
    }),
)

it.live(
  "failed exact-file preflight or approval commit leaves no partial consent and permits corrected account and destination",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* writeMessage(s.db, "before consent")
      const file = path.join(f.directory, "approved.txt")
      yield* Effect.promise(() => writeFile(file, "exact approved bytes"))
      expect(
        yield* s.sync
          .enable({
            directory: f.directory,
            destination: f.backend.url,
            local: true,
            organizationID: null,
            assets: [file, path.join(f.directory, "missing")],
          })
          .pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
      for (const table of [
        "_kilo_sync_consent",
        "_kilo_sync_directory",
        "_kilo_sync_session",
        "_kilo_sync_dirty",
        "_kilo_sync_allowed_asset",
      ])
        expect(yield* s.db.all(`SELECT * FROM ${table}`)).toEqual([])
      yield* s.db.run(`CREATE TRIGGER _test_sync_approval_abort BEFORE INSERT ON _kilo_sync_allowed_asset
      BEGIN SELECT RAISE(ABORT,'approval commit interrupted'); END`)
      expect(
        yield* s.sync
          .enable({
            directory: f.directory,
            destination: f.backend.url,
            local: true,
            organizationID: null,
            assets: [file],
          })
          .pipe(Effect.exit),
      ).toMatchObject({ _tag: "Failure" })
      for (const table of [
        "_kilo_sync_consent",
        "_kilo_sync_directory",
        "_kilo_sync_session",
        "_kilo_sync_dirty",
        "_kilo_sync_allowed_asset",
      ])
        expect(yield* s.db.all(`SELECT * FROM ${table}`)).toEqual([])
      yield* s.db.run(`DROP TRIGGER _test_sync_approval_abort`)
      const other = yield* Effect.acquireRelease(Effect.sync(peer), (backend) =>
        Effect.sync(() => {
          backend.close()
        }),
      )
      yield* signIn(s.credentials, "bob")
      const enabled = yield* s.sync.enable({
        directory: f.directory,
        destination: other.url,
        local: true,
        organizationID: null,
        assets: [file],
      })
      expect(enabled).toMatchObject({ enabled: true, destination: other.url, userID: "bob" })
      if (enabled.sourceID === undefined) return yield* Effect.die("Enabled sync status omitted its source")
      const before = yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)
      const replacement = path.join(f.directory, "new-approval.txt")
      yield* Effect.promise(() => writeFile(replacement, "a new approval must roll back too"))
      expect(
        yield* s.sync
          .enable({
            directory: f.directory,
            destination: other.url,
            local: true,
            organizationID: null,
            assets: [replacement, path.join(f.directory, "missing")],
          })
          .pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
      expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)).toEqual(before)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect((yield* Store.sessions(s.db, f.directory))[0]?.source_id).toBe(enabled.sourceID)
      expect(other.states.get(id)?.creatorID).toBe("bob")
      expect(f.backend.states.size).toBe(0)
    }),
)

it.live("disable fences an earlier enable awaiting first account exchange without waiting for the network", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    f.backend.control.hangExchange = true
    const enabling = yield* s.sync
      .enable({
        directory: f.directory,
        destination: f.backend.url,
        local: true,
        organizationID: null,
      })
      .pipe(Effect.result, Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    expect(yield* s.sync.disable({ directory: f.directory }).pipe(Effect.timeoutOption(500))).toMatchObject({
      _tag: "Some",
      value: { enabled: false },
    })
    f.backend.control.hangExchange = false
    f.backend.gate.resolve()
    expect(yield* Fiber.join(enabling)).toMatchObject({ _tag: "Failure", failure: { code: "sync_disabled" } })
    expect((yield* s.sync.status({ directory: f.directory })).enabled).toBe(false)
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_consent`)).toEqual([])
    expect(yield* Store.sessions(s.db, f.directory)).toEqual([])
  }),
)

it.live(
  "the background supervisor reports a SQLite defect and resumes after repair without explicit flush",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root, { background: true })
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* writeMessage(s.db, "background resumes")
      yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
      yield* s.db.run(`CREATE TRIGGER _test_sync_alias_abort BEFORE INSERT ON _kilo_sync_directory
      BEGIN SELECT RAISE(ABORT,'transient background defect'); END`)
      const unhealthy = yield* s.sync.status({ directory: f.directory }).pipe(
        Effect.repeat({
          while: (status) => status.error?.code !== "background_error",
          schedule: Schedule.spaced(10),
        }),
        Effect.timeoutOption(5000),
      )
      expect(unhealthy).toMatchObject({ _tag: "Some", value: { enabled: true, error: { code: "background_error" } } })
      yield* s.db.run(`DROP TRIGGER _test_sync_alias_abort`)
      const recovered = yield* s.sync.status({ directory: f.directory }).pipe(
        Effect.repeat({
          while: (status) => Boolean(status.error) || status.pending > 0 || !f.backend.states.get(id),
          schedule: Schedule.spaced(10),
        }),
        Effect.timeoutOption(5000),
      )
      expect(recovered).toMatchObject({ _tag: "Some", value: { enabled: true, pending: 0 } })
      expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
        message: { text: "background resumes" },
      })
    }),
  12_000,
)

it.live("verified blob upload progress survives a cancelled later blob and restart without changing the packet", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const packet = yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f.root, { flushTimeout: 500 })
        yield* signIn(s.credentials)
        yield* seed(s.db, f.directory)
        const bytes = [Buffer.from("first attachment"), Buffer.from("second attachment")]
        yield* s.db
          .insert(SessionMessageTable)
          .values({
            id: messageID,
            session_id: id,
            type: "user",
            seq: 0,
            data: {
              text: "two files",
              time: { created: 10 },
              files: bytes.map((file, index) => ({
                data: file.toString("base64"),
                mime: "application/octet-stream",
                name: `${index}.bin`,
                source: { type: "inline" as const },
              })),
            },
          })
          .run()
        yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
        f.backend.control.blobGateAt = 2
        const uploading = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result, Effect.forkScoped)
        yield* Effect.promise(() => f.backend.entered.promise)
        const before = yield* Store.packet(s.db, id)
        expect(before).toBeDefined()
        expect(yield* Fiber.join(uploading)).toMatchObject({ _tag: "Failure", failure: { code: "flush_timeout" } })
        expect(yield* Store.packet(s.db, id)).toEqual(before)
        return before
      }),
    )
    f.backend.control.blobGateAt = 0
    f.backend.gate.resolve()
    const s = yield* boot(f.root)
    expect(yield* Store.packet(s.db, id)).toEqual(packet)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const first = digest("first attachment")
    expect(f.backend.blobRequests.filter((hash) => hash === first)).toHaveLength(1)
    expect(f.backend.blobRequests.filter((hash) => hash === digest("second attachment"))).toHaveLength(2)
    expect(f.backend.bodies).toHaveLength(1)
  }),
)

it.live(
  "a real slow blob transfer can exceed thirty seconds without the pass discarding its packet",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root, { flushTimeout: 40_000 })
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
      const output = yield* s.output(f.directory)
      const file = yield* output.save(Buffer.alloc(8 * 1024 * 1024, 7), ".bin")
      yield* writeTool(s.db, {}, pathToFileURL(file).href)
      // Real HTTP cancellation/deadlines use the platform clock; advancing a fake clock would not
      // exercise the former thirty-second abort while a socket upload remains live.
      f.backend.control.blobDelay = 31_000
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.bodies).toHaveLength(1)
    }),
  45_000,
)

it.live("parent-only reconciliation cannot steal enabled or disabled nested account scope", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* signIn(s.credentials)
    const child = path.join(f.directory, "nested")
    yield* Effect.promise(() => mkdir(child))
    const childID = Session.ID.make("ses_nested_scope")
    yield* seed(s.db, child, childID)
    yield* seed(s.db, f.directory)
    yield* Store.enable(s.db, {
      directory: child,
      destination: "https://child.invalid",
      local: false,
      organizationID: null,
      tenant: { type: "user", id: "bob" },
      userID: "bob",
    })
    yield* Store.reconcile(s.db, child, true)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* Store.reconcile(s.db, f.directory)
    yield* writeMessage(s.db, "child retains capture", childID, 0, SessionMessage.ID.make("msg_nested_scope"))
    const newChild = Session.ID.make("ses_nested_new")
    yield* seed(s.db, child, newChild)
    expect((yield* Store.sessions(s.db, child)).map((row) => row.id)).toEqual([childID, newChild].sort())
    expect((yield* Store.dirty(s.db, childID)).map((row) => row.value).join()).toContain("child retains capture")
    expect(yield* s.db.get(sql`SELECT directory FROM _kilo_sync_directory WHERE alias=${child}`)).toEqual({
      directory: child,
    })
    expect(f.backend.states.has(childID)).toBe(false)
    yield* s.sync.disable({ directory: child })
    yield* Store.reconcile(s.db, f.directory)
    const disabledChild = Session.ID.make("ses_nested_disabled")
    yield* seed(s.db, child, disabledChild)
    expect(yield* s.db.get(sql`SELECT directory FROM _kilo_sync_session WHERE id=${disabledChild}`)).toBeUndefined()
    yield* writeMessage(
      s.db,
      "disabled child still journals",
      childID,
      1,
      SessionMessage.ID.make("msg_nested_disabled"),
    )
    expect((yield* Store.dirty(s.db, childID)).map((row) => row.value).join()).toContain(
      "disabled child still journals",
    )
    expect((yield* Store.sessions(s.db, f.directory)).map((row) => row.id)).toEqual([id])
  }),
)

it.live(
  "never-enabled native output records metadata without blob reads and initial backfill admits only unchanged allocations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      const output = yield* s.output(f.directory)
      const large = yield* output.save(Buffer.alloc(8 * 1024 * 1024 + 1, 3), ".bin")
      expect(
        yield* s.db.get(sql`SELECT hash,bytes,identity,error_message FROM _kilo_sync_owned_asset WHERE path=${large}`),
      ).toMatchObject({ hash: null, bytes: 8 * 1024 * 1024 + 1, identity: expect.any(String), error_message: null })
      expect(
        yield* Effect.promise(() => readdir(path.join(s.global.data, "session-sync", "spool")).catch(() => [])),
      ).toEqual([])
      const file = yield* output.save(Buffer.from("native before opt-in"), ".bin")
      yield* writeTool(s.db, {}, pathToFileURL(file).href)
      yield* signIn(s.credentials)
      yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(Buffer.from(f.backend.blobs.get(`${id}/${digest("native before opt-in")}`) ?? []).toString()).toBe(
        "native before opt-in",
      )
    }),
)

it.live("unconsented provenance identity rejects same-size output rewrites even when mtime is restored", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    const output = yield* s.output(f.directory)
    const file = yield* output.save(Buffer.from("original"), ".txt")
    const owner = yield* s.db.get<{ identity: string }>(
      sql`SELECT identity FROM _kilo_sync_owned_asset WHERE path=${file}`,
    )
    if (!owner) return yield* Effect.die("Native allocation did not record identity")
    const identity = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ mtime: Schema.Number })))(
      owner.identity,
    )
    yield* Effect.promise(async () => {
      await writeFile(file, "tampered")
      await utimes(file, new Date(identity.mtime), new Date(identity.mtime))
    })
    yield* writeTool(s.db, {}, pathToFileURL(file).href)
    yield* signIn(s.credentials)
    yield* s.sync.enable({ directory: f.directory, destination: f.backend.url, local: true, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("asset_error")
    expect(f.backend.blobs.size).toBe(0)
  }),
)

it.live("unused provenance is bounded while dirty native references keep their exact allocation authority", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    const output = yield* s.output(f.directory)
    const file = yield* output.save(Buffer.from("pending allocation"), ".txt")
    yield* writeTool(s.db, {}, pathToFileURL(file).href)
    yield* s.db.run(sql`UPDATE _kilo_sync_owned_asset SET observed_at=1 WHERE path=${file}`)
    yield* s.db.run(sql`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<4200)
      INSERT INTO _kilo_sync_owned_asset(path,directory,observed_at)
      SELECT 'unused-'||i,${f.directory},${Date.now()} FROM n`)
    yield* output.save(Buffer.from("new unused allocation"), ".txt")
    expect(yield* s.db.get(sql`SELECT count(*) AS count FROM _kilo_sync_owned_asset`)).toEqual({ count: 4096 })
    expect(yield* s.db.get(sql`SELECT path FROM _kilo_sync_owned_asset WHERE path=${file}`)).toEqual({ path: file })
    yield* s.db.run(sql`UPDATE _kilo_sync_owned_asset SET observed_at=1 WHERE path LIKE 'unused-%'`)
    yield* Assets.prune(s.db, s.global)
    expect(
      yield* s.db.get(sql`SELECT count(*) AS count FROM _kilo_sync_owned_asset WHERE path LIKE 'unused-%'`),
    ).toEqual({ count: 0 })
    yield* signIn(s.credentials)
    yield* Effect.promise(() => unlink(file))
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live(
  "GC keeps current cleaned-up assets, frozen entity bodies and approval namespaces while removing obsolete snapshots",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const approved = path.join(f.directory, "approved-unused.txt")
      const approvedBytes = Buffer.from("workspace approval survives without a transcript")
      yield* Effect.promise(() => writeFile(approved, approvedBytes))
      yield* s.sync.enable({
        directory: f.directory,
        destination: f.backend.url,
        local: true,
        organizationID: null,
        assets: [approved],
      })
      const output = yield* s.output(f.directory)
      const bytes = Buffer.from("current native snapshot")
      const file = yield* output.save(bytes, ".bin")
      yield* writeTool(s.db, {}, pathToFileURL(file).href)
      yield* Effect.promise(() => unlink(file))
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      yield* s.db.run(sql`DELETE FROM _kilo_sync_owned_asset WHERE path=${file}`)
      // Simulate a pre-reference-table journal. Migration must preserve the only remaining bytes.
      yield* s.db.run(sql`DELETE FROM _kilo_sync_asset_reference WHERE session_id=${id}`)
      yield* Assets.prune(s.db, s.global)
      expect(
        Buffer.from(yield* Assets.read(s.global, id, { hash: digest(bytes), bytes: bytes.byteLength })).toString(),
      ).toBe(bytes.toString())
      expect(yield* s.db.get(sql`SELECT entity_id FROM _kilo_sync_asset_reference WHERE session_id=${id}`)).toEqual({
        entity_id: messageID,
      })
      yield* Store.reconcile(s.db, f.directory, true)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      yield* s.db
        .update(SessionMessageTable)
        .set({
          type: "user",
          data: { text: "replacement".repeat(10_000), time: { created: 10 } },
        })
        .where(eq(SessionMessageTable.id, messageID))
        .run()
      f.backend.control.mode = "offline"
      yield* s.sync.flush({ directory: f.directory })
      const pending = yield* Store.packet(s.db, id)
      if (!pending) return yield* Effect.die("Expected a frozen replacement body")
      const replacement = readPacket(pending.body).changes.find((change) => change.kind === "message")?.blob
      if (!replacement) return yield* Effect.die("Expected an out-of-line replacement body")
      yield* Assets.spool(s.global, id, approvedBytes)
      const orphan = yield* Assets.spool(s.global, "unused-session", Buffer.from("crash orphan"))
      const temporary = `${Assets.filename(s.global, "unused-session", orphan.hash)}.${randomUUID()}.tmp`
      yield* Effect.promise(() => writeFile(temporary, "unfinished crash write"))
      yield* Effect.promise(() => utimes(temporary, 1, 1))
      yield* Assets.prune(s.db, s.global)
      expect(yield* Assets.read(s.global, id, replacement).pipe(Effect.result)).toMatchObject({ _tag: "Success" })
      expect(
        yield* Assets.read(s.global, id, { hash: digest(bytes), bytes: bytes.byteLength }).pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure" })
      expect(
        yield* Assets.read(s.global, id, { hash: digest(approvedBytes), bytes: approvedBytes.byteLength }).pipe(
          Effect.result,
        ),
      ).toMatchObject({ _tag: "Failure" })
      expect(
        Buffer.from(
          yield* Assets.read(s.global, `workspace:${f.directory}`, {
            hash: digest(approvedBytes),
            bytes: approvedBytes.byteLength,
          }),
        ).toString(),
      ).toBe(approvedBytes.toString())
      expect(yield* Effect.promise(() => readdir(path.dirname(temporary)))).toEqual([])
      expect(yield* Store.packet(s.db, id)).toEqual(pending)
      f.backend.control.mode = "online"
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(yield* Assets.read(s.global, id, replacement).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
    }),
)

it.live(
  "ACK reclamation allows more than 256 MiB of historical entity bodies without exhausting the current spool",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      yield* allow(s.db, f.directory, f.backend)
      let total = 0
      for (let revision = 0; revision < 34; revision++) {
        yield* writeMessage(s.db, `revision ${revision}`)
        const session = (yield* Store.sessions(s.db, f.directory))[0]
        const row = (yield* Store.dirty(s.db, id)).find((row) => row.kind === "message")
        if (!session || !row) return yield* Effect.die("Expected a captured message revision")
        const bytes = Buffer.from(JSON.stringify({ text: `${revision}${"x".repeat(8 * 1024 * 1024 - 128)}` }))
        const blob = yield* Assets.body(s.db, s.global, row, bytes)
        total += blob.bytes
        const packet = yield* Store.freeze(
          s.db,
          session,
          [{ op: "put", kind: "message", id: messageID, blob }],
          row.position,
          [blob],
        )
        yield* Assets.prune(s.db, s.global)
        expect((yield* Assets.read(s.global, id, blob)).byteLength).toBe(bytes.byteLength)
        yield* Store.acknowledge(s.db, packet, {
          version: 1,
          sessionID: id,
          batchID: packet.batch_id,
          after: packet.after,
          through: packet.through,
          revision: revision + 1,
          changes: 1,
          digest: packet.digest,
          committedAt: Date.now(),
        })
        yield* Assets.prune(s.db, s.global)
        expect(yield* Effect.promise(() => readdir(path.dirname(Assets.filename(s.global, id, blob.hash))))).toEqual([])
      }
      expect(total).toBeGreaterThan(256 * 1024 * 1024)
    }),
  60_000,
)

it.live("a new nested permission cannot steal a previously enrolled ancestor history", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    const child = path.join(f.directory, "already-enrolled")
    yield* Effect.promise(() => mkdir(child))
    yield* seed(s.db, child)
    yield* allow(s.db, f.directory, f.backend)
    const before = yield* Store.consent(s.db, f.directory)
    expect(
      yield* Store.enable(s.db, {
        directory: child,
        destination: "https://child.invalid",
        local: false,
        organizationID: null,
        tenant: { type: "user", id: "bob" },
        userID: "bob",
      }).pipe(Effect.result),
    ).toMatchObject({ _tag: "Failure", failure: { code: "consent_conflict" } })
    expect(yield* Store.consent(s.db, child)).toBeUndefined()
    expect(yield* Store.consent(s.db, f.directory)).toEqual(before)
    expect(yield* s.db.get(sql`SELECT directory FROM _kilo_sync_directory WHERE alias=${child}`)).toEqual({
      directory: f.directory,
    })
    yield* writeMessage(s.db, "still parent capture")
    expect((yield* Store.dirty(s.db, id)).map((row) => row.value).join()).toContain("still parent capture")
    expect((yield* Store.sessions(s.db, f.directory))[0]?.directory).toBe(f.directory)
  }),
)

it.live("durable approval preparation pins survive GC and expired pins cannot commit consent to missing bytes", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f.root)
    yield* seed(s.db, f.directory)
    const file = path.join(f.directory, "staged.txt")
    const bytes = Buffer.from("durable preparation")
    yield* Effect.promise(() => writeFile(file, bytes))
    yield* Effect.scoped(
      Effect.gen(function* () {
        const prepared = yield* Assets.prepareApproval(s.db, s.global, f.directory, [file])
        yield* Assets.prune(s.db, s.global)
        expect(
          Buffer.from(
            yield* Assets.read(s.global, `workspace:${f.directory}`, {
              hash: digest(bytes),
              bytes: bytes.byteLength,
            }),
          ).toString(),
        ).toBe(bytes.toString())
        yield* s.db.run(sql`UPDATE _kilo_sync_preparation SET deadline=1`)
        yield* Assets.prune(s.db, s.global)
        expect(
          yield* Assets.read(s.global, `workspace:${f.directory}`, {
            hash: digest(bytes),
            bytes: bytes.byteLength,
          }).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure" })
        expect(
          yield* Store.enable(
            s.db,
            {
              directory: f.directory,
              destination: f.backend.url,
              local: true,
              organizationID: null,
              tenant: { type: "user", id: "alice" },
              userID: "alice",
            },
            prepared,
          ).pipe(Effect.result),
        ).toMatchObject({ _tag: "Failure", failure: { code: "capture_changed" } })
        expect(yield* Store.consent(s.db, f.directory)).toBeUndefined()
        expect(yield* Store.sessions(s.db, f.directory)).toEqual([])
        expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)).toEqual([])
      }),
    )
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_preparation`)).toEqual([])
    yield* signIn(s.credentials)
    yield* s.sync.enable({
      directory: f.directory,
      destination: f.backend.url,
      local: true,
      organizationID: null,
      assets: [file],
    })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live(
  "replaced preparation refs cannot freeze reclaimed bytes while immutable packets retain previous generations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      yield* allow(s.db, f.directory, f.backend)
      yield* writeMessage(s.db, "first")
      const session = (yield* Store.sessions(s.db, f.directory))[0]
      const row = (yield* Store.dirty(s.db, id)).find((row) => row.kind === "message")
      if (!session || !row) return yield* Effect.die("Expected a captured native message")
      const stale = yield* Assets.body(s.db, s.global, row, Buffer.from('{"text":"stale preparation"}'))
      const current = yield* Assets.body(s.db, s.global, row, Buffer.from('{"text":"current preparation"}'))
      yield* Assets.prune(s.db, s.global)
      expect(yield* Assets.read(s.global, id, stale).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
      expect(
        yield* Store.freeze(
          s.db,
          session,
          [
            {
              op: "put",
              kind: "message",
              id: messageID,
              blob: stale,
            },
          ],
          row.position,
          [stale],
        ).pipe(Effect.result),
      ).toMatchObject({
        _tag: "Failure",
        failure: { code: "capture_changed" },
      })
      expect(yield* Store.packet(s.db, id)).toBeUndefined()
      const packet = yield* Store.freeze(
        s.db,
        session,
        [
          {
            op: "put",
            kind: "message",
            id: messageID,
            blob: current,
          },
        ],
        row.position,
        [current],
      )
      yield* writeMessage(s.db, "newer mutation")
      const newer = (yield* Store.dirty(s.db, id)).find((row) => row.kind === "message")
      if (!newer) return yield* Effect.die("Expected a newer dirty message")
      const replacement = yield* Assets.body(s.db, s.global, newer, Buffer.from('{"text":"newer mutation"}'))
      yield* Assets.prune(s.db, s.global)
      expect(yield* Assets.read(s.global, id, current).pipe(Effect.result)).toMatchObject({ _tag: "Success" })
      expect(yield* Assets.read(s.global, id, replacement).pipe(Effect.result)).toMatchObject({ _tag: "Success" })
      expect(yield* Store.packet(s.db, id)).toEqual(packet)
      yield* Store.acknowledge(s.db, packet, {
        version: 1,
        sessionID: id,
        batchID: packet.batch_id,
        after: packet.after,
        through: packet.through,
        revision: 1,
        changes: 1,
        digest: packet.digest,
        committedAt: Date.now(),
      })
      yield* Assets.prune(s.db, s.global)
      expect(yield* Assets.read(s.global, id, current).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
      expect(yield* Assets.read(s.global, id, replacement).pipe(Effect.result)).toMatchObject({ _tag: "Success" })
      expect((yield* Store.dirty(s.db, id)).find((dirty) => dirty.kind === "message")?.position).toBe(newer.position)
    }),
)

it.live(
  "obsolete native pool pins do not consume the workspace budget after their portable revisions are ACKed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f.root)
      yield* seed(s.db, f.directory)
      yield* allow(s.db, f.directory, f.backend)
      const output = yield* s.output(f.directory)
      let total = 0
      for (let revision = 0; revision < 34; revision++) {
        const bytes = Buffer.alloc(8 * 1024 * 1024, revision)
        const file = yield* output.save(bytes, ".bin")
        const uri = pathToFileURL(file).href
        if (revision === 0) yield* writeTool(s.db, {}, uri)
        else
          yield* s.db.run(sql`UPDATE session_message SET
        data=json_set(data,'$.content[0].state.content[0].uri',${uri}) WHERE id=${messageID}`)
        yield* Effect.promise(() => unlink(file))
        const session = (yield* Store.sessions(s.db, f.directory))[0]
        const row = (yield* Store.dirty(s.db, id)).find((row) => row.kind === "message")
        if (!session || !row) return yield* Effect.die("Expected a native output revision")
        const value = Store.value(row)
        const assets = yield* Assets.collect(s.db, s.global, f.directory, row, value)
        const packet = yield* Store.freeze(
          s.db,
          session,
          [...assets.changes, { op: "put", kind: "message", id: messageID, value }],
          row.position,
          assets.blobs,
        )
        yield* Store.acknowledge(s.db, packet, {
          version: 1,
          sessionID: id,
          batchID: packet.batch_id,
          after: packet.after,
          through: packet.through,
          revision: revision + 1,
          changes: assets.changes.length + 1,
          digest: packet.digest,
          committedAt: Date.now(),
        })
        yield* Assets.prune(s.db, s.global)
        total += bytes.byteLength
        const hash = digest(bytes)
        expect(yield* Effect.promise(() => readdir(path.dirname(Assets.filename(s.global, id, hash))))).toEqual([hash])
        expect(
          yield* Effect.promise(() =>
            readdir(path.dirname(Assets.filename(s.global, `workspace:${f.directory}`, hash))),
          ),
        ).toEqual([hash])
      }
      expect(total).toBeGreaterThan(256 * 1024 * 1024)
    }),
  90_000,
)
