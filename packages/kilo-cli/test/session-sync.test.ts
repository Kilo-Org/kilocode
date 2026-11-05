import { expect, spyOn } from "bun:test"
import { KiloSessionSync } from "@kilocode/kilo-plugin"
import { Context, Effect, Fiber, Layer, Schedule, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { Location } from "@opencode/core/location"
import { ToolOutput } from "@opencode/core/tool-output"
import { Workspace } from "@opencode/schema/workspace"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { storedAbsolutePath } from "@opencode/core/database/path"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { ProjectTable } from "@opencode/core/project/sql"
import {
  SessionTable,
  SessionMessageTable,
  SessionPartTable,
  InstructionEntryTable,
  InstructionStateTable,
  InstructionBlobTable,
  type SessionPartData,
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
import {
  type Receipt,
  type Tenant,
  Kind,
  digest,
  limits,
  parse,
  json,
  reconstructMessage,
  jsonNodes,
} from "../src/session-sync/protocol"

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
      tenant: Tenant
      position: number
      lastReceipt: Receipt | null
      entities: Map<string, Schema.Json>
    }
  >()
  const grants = new Map<string, { userID: string; tenant: Tenant }>()
  const blobs = new Map<string, Uint8Array>()
  const bodies: string[] = []
  const blobRequests: string[] = []
  const gate = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const control = {
    mode: "online" as "online" | "offline" | "lost-ack" | "gate" | "hang",
    sourceConflict: false,
    deleted: false,
    hangExchange: false,
    exchangeFailures: false,
    exchanges: 0,
    quota: false,
    retryAfter: false,
    gatedReads: 0,
    gatedBatches: 0,
    batchGate: false,
    batchRetryAfter: false,
    blobGateAt: 0,
    blobDelay: 0,
    stateGate: false,
    stateRetryAfter: false,
    abortBody: false,
    sessionRequests: 0,
    stateReads: 0,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 60,
    fetch: async (request) => {
      const url = new URL(request.url)
      const error = (code: string, status: number) =>
        Response.json(
          { error: { code, message: "fixture failure" } },
          {
            status,
            headers: status === 503 && control.retryAfter ? { "Retry-After": "120" } : {},
          },
        )
      const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? ""
      if (url.pathname === "/v1/auth/exchange") {
        control.exchanges++
        if (control.exchangeFailures)
          return Response.json(
            { error: { code: "auth_unavailable" } },
            { status: 503, headers: { "Retry-After": "120" } },
          )
        if (!token.startsWith("fixture:")) return error("invalid_credential", 401)
        if (control.hangExchange) {
          entered.resolve()
          await gate.promise
        }
        const userID = token.slice("fixture:".length).split("#")[0] ?? ""
        const { organizationID } = (await request.json()) as { organizationID?: string }
        const tenant: Tenant = organizationID
          ? { type: "organization", id: organizationID }
          : { type: "user", id: userID }
        const grantToken = `grant:${userID}:${organizationID ?? "personal"}`
        grants.set(grantToken, { userID, tenant })
        return Response.json({
          version: 1,
          token: grantToken,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          tenant,
          userID,
        })
      }
      control.sessionRequests++
      if (control.abortBody)
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"error":'))
              setTimeout(() => controller.error(new Error("fixture body abort")), 20)
            },
          }),
          { status: 503, headers: { "Retry-After": "120" } },
        )
      const grant = grants.get(token)
      if (!grant) return error("invalid_grant", 401)
      if (control.mode === "hang") {
        entered.resolve()
        await gate.promise
      }
      const match = /^\/v1\/sessions\/([^/]+)(?:\/(batches|blobs)(?:\/([0-9a-f]{64}))?)?$/.exec(url.pathname)
      if (!match?.[1]) return error("not_found", 404)
      const sessionID = decodeURIComponent(match[1])
      if (request.method === "GET" && !match[2]) control.stateReads++
      const userID = grant.userID
      if (match[2] === "batches") {
        const body = await request.text()
        bodies.push(body)
        const retry = control.batchRetryAfter
        if (control.batchGate) {
          entered.resolve()
          control.gatedBatches++
          await gate.promise
        }
        if (retry)
          return Response.json(
            { error: { code: "internal_error" } },
            { status: 503, headers: { "Retry-After": "120" } },
          )
        if (control.mode === "offline") return error("internal_error", 503)
        if (control.quota) return error("tenant_budget_exceeded", 413)
        const packet = readPacket(body)
        const state = states.get(sessionID)
        if (!state) return error("session_not_found", 404)
        if (control.deleted) return error("session_deleted", 410)
        if (state.creatorID !== userID) return error("creator_mismatch", 403)
        if (control.sourceConflict || state.sourceID !== packet.sourceID) return error("source_conflict", 409)
        if (state.position !== packet.after)
          return error(packet.through <= state.position ? "batch_superseded" : "position_conflict", 409)
        for (const change of packet.changes) {
          const key = `${change.kind}/${change.id}`
          if (change.op === "remove") state.entities.delete(key)
          else if (change.blob) {
            const bytes = blobs.get(`${sessionID}/${change.blob.hash}`)
            if (!bytes || bytes.byteLength !== change.blob.bytes)
              return Response.json(
                { error: { code: "blob_missing", details: { hash: change.blob.hash } } },
                { status: 409 },
              )
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
        state = {
          sourceID: value.sourceID,
          creatorID: userID,
          tenant: grant.tenant,
          position: 0,
          lastReceipt: null,
          entities: new Map(),
        }
        states.set(sessionID, state)
      }
      if (!state) return error("session_not_found", 404)
      if (control.deleted)
        return Response.json({
          version: 1,
          sessionID,
          deleted: true,
          tenant: state.tenant,
          deletedAt: Date.now(),
        })
      const response = control.stateRetryAfter
        ? Response.json({ error: { code: "internal_error" } }, { status: 503, headers: { "Retry-After": "120" } })
        : Response.json({
            version: 1,
            sessionID,
            deleted: false,
            tenant: state.tenant,
            creatorID: state.creatorID,
            sourceID: control.sourceConflict ? randomUUID() : state.sourceID,
            position: state.position,
            lastReceipt: state.lastReceipt,
          })
      if (request.method === "GET" && control.stateGate) {
        entered.resolve()
        control.gatedReads++
        await gate.promise
      }
      return response
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
    Effect.promise(async () => realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-sync-consumer-")))),
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

const boot = (
  f: { root: string; backend: { url: string } },
  options: { background?: boolean; flushTimeout?: number; organizationID?: string | null } = {},
) =>
  Effect.gen(function* () {
    const { root } = f
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
            layer: Layer.effect(
              KiloSessionSync.Service,
              SessionSync.make({ background: false, destination: f.backend.url, organizationID: null, ...options }),
            ),
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
  }).pipe(
    Effect.andThen(Store.reconcile(db, directory, true)),
    Effect.andThen(
      db.run(sql`UPDATE session_v2 SET time_updated=time_updated WHERE workspace_id IS NULL AND directory IN
      (SELECT alias FROM _kilo_sync_directory WHERE directory=${directory})`),
    ),
    Effect.andThen(Store.reconcile(db, directory, true)),
  )
const signIn = (credentials: Credential.Interface, user = "alice") =>
  credentials.create({ integrationID: IntegrationID.make("kilo"), value: { type: "key", key: `fixture:${user}` } })

// Protocol fixtures qualify preseeded native sessions through their first post-enrollment write.
// Already captured sessions are untouched, including completed sessions resumed after a pause.
const enableAfterNativeWrite = (
  s: Effect.Success<ReturnType<typeof boot>>,
  input: Parameters<typeof s.sync.enable>[0],
) =>
  Effect.gen(function* () {
    const status = yield* s.sync.enable(input)
    yield* s.db.run(sql`UPDATE session_v2 SET title=title
    WHERE directory IN (SELECT alias FROM _kilo_sync_directory WHERE directory=${input.directory}) AND workspace_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM _kilo_sync_session captured WHERE captured.id=session_v2.id)`)
    return status
  })
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
    const s = yield* boot(f)
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
      origin: { directory: storedAbsolutePath(f.directory) },
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
      const s = yield* boot(f)
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
        const s = yield* boot(f)
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
    const s = yield* boot(f)
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
      const s = yield* boot(f)
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
    const s = yield* boot(f)
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
    const s = yield* boot(f)
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
      const s = yield* boot(f)
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
          const s = yield* boot(f)
          yield* signIn(s.credentials)
          yield* seed(s.db, f.directory)
          yield* writeMessage(s.db, "offline persistent message")
          yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
      const s = yield* boot(f)
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

it.live("steady-state packets post directly after one verified state read", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    for (let index = 0; index < limits.changes * 2; index++)
      yield* writeMessage(s.db, `packet ${index}`, id, index, SessionMessage.ID.make(`msg_many_${index}`))
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.bodies.length).toBe(3)
    yield* writeMessage(s.db, "later flush", id, limits.changes * 2)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.bodies.length).toBe(4)
    expect(f.backend.control.stateReads).toBe(1)
  }),
)

it.live("a lost acknowledgement on the direct POST path recovers through state without double apply", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* writeMessage(s.db, "lost direct acknowledgement")
    f.backend.control.mode = "lost-ack"
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
    const committed = f.backend.states.get(id)?.lastReceipt
    expect(f.backend.bodies.length).toBe(2)
    expect(f.backend.control.stateReads).toBe(1)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.bodies.length).toBe(2)
    expect(f.backend.control.stateReads).toBe(2)
    expect(f.backend.states.get(id)?.lastReceipt).toEqual(committed)
  }),
)

for (const rejection of [
  "session_deleted",
  "session_not_found",
  "creator_mismatch",
  "source_conflict",
  "position_conflict",
  "batch_superseded",
] as const)
  it.live(`direct POST recovers ${rejection} through state and retains the pending packet`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      const state = f.backend.states.get(id)!
      if (rejection === "session_deleted") f.backend.control.deleted = true
      if (rejection === "creator_mismatch") state.creatorID = "bob"
      if (rejection === "source_conflict") state.sourceID = "another-producer"
      if (rejection === "position_conflict") state.position = 0
      if (rejection === "batch_superseded") state.position++
      if (rejection === "session_not_found") f.backend.states.delete(id)
      yield* writeMessage(s.db, "must not replace cloud history")
      const result = yield* s.sync.flush({ directory: f.directory })
      expect(result.pending).toBeGreaterThan(0)
      expect(result.error?.code).toBe(
        rejection === "creator_mismatch"
          ? "source_conflict"
          : rejection === "batch_superseded" || rejection === "session_not_found"
            ? "position_conflict"
            : rejection,
      )
      expect(f.backend.control.stateReads).toBe(2)
      expect(f.backend.bodies.length).toBe(2)
      expect(yield* Store.packet(s.db, id)).toBeDefined()
    }),
  )

for (const setting of ["signed-out", "off"] as const)
  it.live(`${setting} skips capture and network`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      if (setting === "off")
        yield* Effect.promise(() => writeFile(path.join(f.root, "config", "kilo2.jsonc"), '{"session_sync":false}'))
      const s = yield* boot(f)
      if (setting === "off") yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      expect((yield* s.sync.status({ directory: f.directory })).enabled).toBe(false)
      yield* writeMessage(s.db, "not captured")
      expect(yield* Store.dirty(s.db, id)).toEqual([])
      expect(yield* Store.sessions(s.db, f.directory)).toEqual([])
      expect(yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { code: "sync_disabled" },
      })
      expect(f.backend.control.sessionRequests).toBe(0)
      expect(f.backend.control.exchanges).toBe(0)
      expect(f.backend.states.size).toBe(0)
    }),
  )

it.live("default enrollment captures new sessions but leaves existing history untouched", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "history before sign in")
    yield* signIn(s.credentials)
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: true,
      userID: "alice",
      destination: f.backend.url,
    })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.has(id)).toBe(false)
    const added = Session.ID.make("ses_default_new")
    yield* seed(s.db, f.directory, added)
    yield* writeMessage(s.db, "new native session", added, 0, SessionMessage.ID.make("msg_default_new"))
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.has(added)).toBe(true)
    expect(f.backend.states.has(id)).toBe(false)
  }),
)

it.live("the first subsequent native write admits an existing session after default enrollment", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "before enrollment")
    const untouched = SessionMessage.ID.make("msg_untouched_before_enrollment")
    yield* writeMessage(s.db, "unchanged historical message", id, 1, untouched)
    yield* signIn(s.credentials)
    yield* s.sync.status({ directory: f.directory })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.has(id)).toBe(false)
    yield* writeMessage(s.db, "first write after enrollment")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "first write after enrollment" },
    })
    expect(f.backend.states.get(id)?.entities.get(`message/${untouched}`)).toMatchObject({
      message: { text: "unchanged historical message" },
    })
  }),
)

it.live("global jsonc session_sync overrides json and workspace settings cannot enable capture", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.promise(() =>
      Promise.all([
        writeFile(path.join(f.root, "config", "kilo2.json"), '{"session_sync":true}'),
        writeFile(
          path.join(f.root, "config", "kilo2.jsonc"),
          '{"session_sync":false,"destination":"https://other.invalid"}',
        ),
        writeFile(path.join(f.directory, "kilo2.jsonc"), '{"session_sync":true}'),
      ]),
    )
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    expect((yield* s.sync.status({ directory: f.directory })).enabled).toBe(false)
    yield* writeMessage(s.db, "workspace cannot override global pause")
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect(f.backend.control.sessionRequests).toBe(0)
    expect(yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })).toMatchObject({
      enabled: true,
      destination: f.backend.url,
    })
  }),
)

it.live("construction returns while persisted sign-in exchange is hanging and local work can continue", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f)
        yield* seed(s.db, f.directory)
        yield* signIn(s.credentials)
      }),
    )
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        f.backend.control.hangExchange = true
      }),
      () =>
        Effect.sync(() => {
          f.backend.control.hangExchange = false
          f.backend.gate.resolve()
        }),
    )
    const constructed = yield* boot(f, { background: true }).pipe(Effect.timeoutOption(3000))
    expect(constructed._tag).toBe("Some")
    if (constructed._tag === "None") return yield* Effect.die("Construction waited for credential exchange")
    const s = constructed.value
    expect(yield* Effect.promise(() => f.backend.entered.promise).pipe(Effect.timeoutOption(3000))).toMatchObject({
      _tag: "Some",
    })
    yield* writeMessage(s.db, "local execution is not waiting for the destination")
    expect(yield* s.db.get(sql`SELECT id FROM session_message WHERE id=${messageID}`)).toEqual({ id: messageID })
    expect(f.backend.control.sessionRequests).toBe(0)
    f.backend.control.hangExchange = false
    f.backend.gate.resolve()
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({ enabled: true, userID: "alice" })
  }),
)

it.live("retryable enrollment exchange preserves pinned capture and drains writes after recovery", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const pinned = yield* Store.consent(s.db, f.directory)
    yield* writeMessage(s.db, "frozen before exchange outage")
    f.backend.control.mode = "offline"
    yield* s.sync.flush({ directory: f.directory })
    const packet = yield* Store.packet(s.db, id)
    expect(packet).toBeDefined()
    const requests = f.backend.control.sessionRequests
    f.backend.control.mode = "online"
    f.backend.control.exchangeFailures = true
    yield* signIn(s.credentials, "alice#outage")
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: true,
      error: { code: "auth_unavailable" },
    })
    yield* writeMessage(s.db, "captured while credential exchange is unavailable")
    expect(
      (yield* Store.dirty(s.db, id)).find((row) => row.kind === "message" && row.id === messageID)?.position,
    ).toBeGreaterThan(packet!.through)
    expect(yield* Store.packet(s.db, id)).toEqual(packet)
    expect(yield* Store.consent(s.db, f.directory)).toMatchObject({
      enabled: 1,
      source_id: pinned!.source_id,
      user_id: pinned!.user_id,
      destination: pinned!.destination,
      tenant_type: pinned!.tenant_type,
      tenant_id: pinned!.tenant_id,
    })
    expect(f.backend.control.sessionRequests).toBe(requests)
    f.backend.control.exchangeFailures = false
    yield* signIn(s.credentials, "alice#recovered")
    expect(yield* s.sync.flush({ directory: f.directory })).toMatchObject({ enabled: true, pending: 0 })
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "captured while credential exchange is unavailable" },
    })
    expect(yield* Store.packet(s.db, id)).toBeUndefined()
  }),
)

it.live("a workspace enrollment failure does not pollute a healthy workspace status or flush", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    const other = Session.ID.make("ses_bad_workspace")
    yield* seed(s.db, f.excluded, other)
    yield* s.sync.status({ directory: f.directory })
    yield* s.db.run(sql`UPDATE _kilo_sync_consent SET user_id='bob',tenant_id='bob' WHERE directory=${f.excluded}`)
    expect(yield* s.sync.status({ directory: f.excluded })).toMatchObject({
      enabled: false,
      error: { code: "account_changed" },
    })
    const healthy = yield* s.sync.status({ directory: f.directory })
    expect(healthy.enabled).toBe(true)
    expect(healthy.error).toBeUndefined()
    yield* writeMessage(s.db, "healthy workspace still uploads")
    yield* writeMessage(s.db, "bad workspace remains paused", other, 0, SessionMessage.ID.make("msg_bad_workspace"))
    expect(yield* Store.dirty(s.db, other)).toEqual([])
    const flushed = yield* s.sync.flush({ directory: f.directory })
    expect(flushed).toMatchObject({ enabled: true, pending: 0 })
    expect(flushed.error).toBeUndefined()
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "healthy workspace still uploads" },
    })
    expect(f.backend.states.has(other)).toBe(false)
  }),
)

it.live("automatic enrollment follows the active organization and switching it pauses the pinned workspace", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f, { organizationID: "org-first" })
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: true,
      tenant: { type: "organization", id: "org-first" },
      userID: "alice",
    })
    yield* writeMessage(s.db, "organization history")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const pinned = yield* Store.consent(s.db, f.directory)
    expect(pinned?.organization_id).toBe("org-first")
    const requests = f.backend.control.sessionRequests
    yield* s.sync.organization({ directory: f.directory, organizationID: "org-second" })
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: false,
      tenant: { type: "organization", id: "org-first" },
      error: { code: "account_changed" },
    })
    yield* writeMessage(s.db, "must not capture under a different organization")
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect(yield* s.sync.flush({ directory: f.directory })).toMatchObject({ error: { code: "account_changed" } })
    expect(f.backend.control.sessionRequests).toBe(requests)
    expect(yield* Store.consent(s.db, f.directory)).toMatchObject({
      source_id: pinned!.source_id,
      organization_id: "org-first",
      tenant_id: "org-first",
    })
    yield* s.sync.organization({ directory: f.directory, organizationID: "org-first" })
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: true,
      tenant: { type: "organization", id: "org-first" },
    })
    yield* writeMessage(s.db, "organization capture resumes")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "organization capture resumes" },
    })
  }),
)

it.live("an unresolved organization cannot enroll while existing capture waits safely for confirmation", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.organization({ directory: f.directory, organizationID: undefined })
    expect((yield* s.sync.status({ directory: f.directory })).enabled).toBe(false)
    expect(yield* Store.consent(s.db, f.directory)).toBeUndefined()
    expect(yield* s.sync.enable({ directory: f.directory, organizationID: null }).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "scope_unavailable", retryable: true },
    })
    expect(f.backend.control.exchanges).toBe(0)
    yield* s.sync.organization({ directory: f.directory, organizationID: "org-resolved" })
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: true,
      tenant: { type: "organization", id: "org-resolved" },
    })
    yield* writeMessage(s.db, "confirmed organization")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const requests = f.backend.control.sessionRequests
    const exchanges = f.backend.control.exchanges
    yield* s.sync.organization({ directory: f.directory, organizationID: undefined })
    yield* writeMessage(s.db, "capture retained while the organization resolves")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
    expect(f.backend.control.sessionRequests).toBe(requests)
    expect(f.backend.control.exchanges).toBe(exchanges)
    yield* s.sync.organization({ directory: f.directory, organizationID: "org-resolved" })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "capture retained while the organization resolves" },
    })
  }),
)

it.live("startup automatically enrolls every native local workspace for persisted sign in", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f)
        yield* seed(s.db, f.directory)
        yield* seed(s.db, f.excluded, Session.ID.make("ses_other_native"))
        yield* signIn(s.credentials)
      }),
    )
    const s = yield* boot(f)
    yield* s.sync.status({ directory: f.directory })
    for (const directory of [f.directory, f.excluded])
      expect(yield* Store.consent(s.db, directory)).toMatchObject({
        enabled: 1,
        destination: f.backend.url,
        user_id: "alice",
      })
    expect(f.backend.states.size).toBe(0)
  }),
)

it.live("idle passes skip reconciliation and a newly journaled directory still enrolls", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* s.db.run("CREATE TABLE _test_reconcile_count(value INTEGER NOT NULL)")
    yield* s.db.run("INSERT INTO _test_reconcile_count VALUES(0)")
    yield* s.db.run(`CREATE TRIGGER _test_reconcile_count AFTER INSERT ON _kilo_sync_directory BEGIN
      UPDATE _test_reconcile_count SET value=value+1;
    END`)
    for (let index = 0; index < 5; index++) expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(yield* s.db.get("SELECT value FROM _test_reconcile_count")).toEqual({ value: 0 })
    const child = path.join(f.directory, "new-directory")
    yield* Effect.promise(() => mkdir(child))
    const added = Session.ID.make("ses_journaled_new_directory")
    yield* seed(s.db, child, added)
    yield* s.sync.status({ directory: f.directory })
    expect((yield* s.db.get<{ value: number }>("SELECT value FROM _test_reconcile_count"))!.value).toBeGreaterThan(0)
    expect(f.backend.states.has(added)).toBe(false)
    yield* writeMessage(s.db, "new directory is included", added, 0, SessionMessage.ID.make("msg_new_directory"))
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(added)?.entities.get("message/msg_new_directory")).toMatchObject({
      message: { text: "new directory is included" },
    })
    expect((yield* s.db.get<{ value: number }>("SELECT value FROM _test_reconcile_count"))!.value).toBeGreaterThan(0)
  }),
)

it.live("idle discovery skips other workspace realpaths until the native journal changes", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* seed(s.db, f.excluded, Session.ID.make("ses_discovery_other"))
    yield* s.sync.status({ directory: f.directory })
    yield* s.sync.status({ directory: f.directory })
    const canonical = Store.canonical
    let scans = 0
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        spyOn(Store, "canonical").mockImplementation((directory) => {
          if (directory === (storedAbsolutePath(f.excluded) ?? f.excluded)) scans++
          return canonical(directory)
        }),
      ),
      (probe) => Effect.sync(() => probe.mockRestore()),
    )
    for (let index = 0; index < 3; index++) yield* s.sync.flush({ directory: f.directory })
    expect(scans).toBe(0)
    yield* seed(s.db, f.excluded, Session.ID.make("ses_discovery_added"))
    yield* s.sync.status({ directory: f.directory })
    expect(scans).toBeGreaterThan(0)
  }),
)

for (const move of ["directory", "workspace"] as const)
  it.live(`${move} moves reconcile upload scope while only native local workspaces capture`, () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      const child = path.join(f.directory, "moved-session")
      yield* Effect.promise(() => mkdir(child))
      yield* seed(s.db, f.directory, Session.ID.make("ses_move_anchor"))
      yield* seed(s.db, move === "directory" ? f.excluded : f.directory)
      if (move === "workspace")
        yield* s.db
          .update(SessionTable)
          .set({ workspace_id: Workspace.ID.make("wrk_remote") })
          .where(eq(SessionTable.id, id))
          .run()
      yield* writeMessage(s.db, "persisted before entering consent")
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.states.has(id)).toBe(false)
      const before = yield* Store.reconcileRevision(s.db)
      yield* s.db
        .update(SessionTable)
        .set(move === "directory" ? { directory: child } : { workspace_id: null })
        .where(eq(SessionTable.id, id))
        .run()
      expect(yield* Store.reconcileRevision(s.db)).toBeGreaterThan(before)
      yield* Store.reconcile(s.db, f.directory, true)
      yield* writeMessage(s.db, "persisted before entering consent")
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
        message: { text: "persisted before entering consent" },
      })
      expect((yield* Store.sessions(s.db, f.directory)).find((row) => row.id === id)?.bootstrap_complete).toBe(1)
      yield* s.db.run("CREATE TABLE _test_move_scan(value INTEGER NOT NULL)")
      yield* s.db.run("INSERT INTO _test_move_scan VALUES(0)")
      yield* s.db.run(`CREATE TRIGGER _test_move_scan AFTER INSERT ON _kilo_sync_directory BEGIN
        UPDATE _test_move_scan SET value=value+1;
      END`)
      const enrolled = yield* Store.reconcileRevision(s.db)
      yield* s.db
        .update(SessionTable)
        .set(move === "directory" ? { directory: f.excluded } : { workspace_id: Workspace.ID.make("wrk_remote") })
        .where(eq(SessionTable.id, id))
        .run()
      expect(yield* Store.reconcileRevision(s.db)).toBeGreaterThan(enrolled)
      const requests = f.backend.control.sessionRequests
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect((yield* s.db.get<{ value: number }>("SELECT value FROM _test_move_scan"))!.value).toBeGreaterThan(0)
      yield* writeMessage(s.db, "outside the capture boundary")
      expect(yield* Store.dirty(s.db, id)).toEqual([])
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.control.sessionRequests).toBe(requests)
    }),
  )

it.live(
  "verification is capped at 256 sessions and idle local deletion releases its cache entry",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
      const ids = Array.from({ length: 258 }, (_, index) =>
        Session.ID.make(`ses_verified_${index.toString().padStart(3, "0")}`),
      )
      for (const sessionID of ids.slice(0, 256)) {
        yield* seed(s.db, f.directory, sessionID)
        expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      }
      expect(f.backend.control.stateReads).toBe(256)
      const beforeDelete = yield* Store.reconcileRevision(s.db)
      yield* s.db.delete(SessionTable).where(eq(SessionTable.id, ids[255]!)).run()
      expect(yield* Store.reconcileRevision(s.db)).toBeGreaterThan(beforeDelete)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      yield* seed(s.db, f.directory, ids[256]!)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.control.stateReads).toBe(257)
      // Removing the newest entry leaves room without evicting the oldest live session.
      yield* writeMessage(
        s.db,
        "oldest retained after deletion",
        ids[0]!,
        0,
        SessionMessage.ID.make("msg_verified_oldest"),
      )
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.control.stateReads).toBe(257)
      yield* seed(s.db, f.directory, ids[257]!)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.control.stateReads).toBe(258)
      // One more live session evicts the oldest remaining verification.
      yield* writeMessage(
        s.db,
        "evicted session checks state again",
        ids[1]!,
        0,
        SessionMessage.ID.make("msg_verified_evicted"),
      )
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.control.stateReads).toBe(259)
      yield* writeMessage(s.db, "newest remains verified", ids[257]!, 0, SessionMessage.ID.make("msg_verified_newest"))
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(f.backend.control.stateReads).toBe(259)
    }),
  20_000,
)

it.live("mutation during actual HTTP upload survives ACK and subsequently reaches the cloud peer", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "first")
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "second while upload awaits ACK" },
    })
  }),
)
it.live("a stale uploader cannot park the receipt acknowledged by another native producer", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const first = yield* boot(f)
    yield* signIn(first.credentials)
    yield* seed(first.db, f.directory)
    yield* writeMessage(first.db, "initial")
    yield* enableAfterNativeWrite(first, { directory: f.directory, organizationID: null })
    expect((yield* first.sync.flush({ directory: f.directory })).pending).toBe(0)
    const second = yield* boot(f)
    yield* writeMessage(first.db, "pending while first producer posts its packet")
    f.backend.control.batchGate = true
    f.backend.control.batchRetryAfter = true
    const stale = yield* first.sync.flush({ directory: f.directory }).pipe(Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    f.backend.control.batchGate = false
    f.backend.control.batchRetryAfter = false
    expect((yield* second.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* writeMessage(second.db, "a newer receipt")
    expect((yield* second.sync.flush({ directory: f.directory })).pending).toBe(0)
    f.backend.gate.resolve()
    expect((yield* Fiber.join(stale)).error).toBeUndefined()
    expect((yield* Store.sessions(first.db, f.directory))[0]).toMatchObject({
      error_code: null,
      retry_at: 0,
      server_retry_at: 0,
    })
    yield* writeMessage(first.db, "continues after concurrent acknowledgement")
    expect((yield* first.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "continues after concurrent acknowledgement" },
    })
  }),
)

it.live("a stale upload failure cannot park a newer native capture", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "initial")
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* writeMessage(s.db, "selected for upload")
    f.backend.control.sourceConflict = true
    f.backend.control.stateGate = true
    const stale = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    yield* writeMessage(s.db, "a newer native capture")
    f.backend.control.sourceConflict = false
    f.backend.control.stateGate = false
    f.backend.gate.resolve()
    expect((yield* Fiber.join(stale)).error).toBeUndefined()
    expect((yield* Store.sessions(s.db, f.directory))[0]).toMatchObject({ error_code: null, retry_at: 0 })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "a newer native capture" },
    })
  }),
)

it.live("source conflicts and an actual stored credential switch pause pinned workspace uploads", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    const alice = yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
          const s = yield* boot(f)
          yield* signIn(s.credentials)
          yield* seed(s.db, f.directory)
          yield* writeTool(s.db, { truncated: true, outputPath: output })
          yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null, assets: [output] })
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
      const s = yield* boot(f)
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
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const outside = path.join(f.excluded, "private.txt")
      const link = path.join(f.directory, "escape.txt")
      yield* Effect.promise(() => writeFile(outside, "must not leave excluded workspace"))
      yield* Effect.promise(() => symlink(outside, link))
      yield* writeTool(s.db, { truncated: true, outputPath: link })
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
      const s = yield* boot(f)
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
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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

it.live("disable stops capture and transport, and resume does not recapture completed history", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "first admitted message")
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* s.sync.disable({ directory: f.directory })
    const requests = f.backend.control.sessionRequests
    yield* writeMessage(s.db, "edited while disabled")
    const pending = yield* s.sync.status({ directory: f.directory })
    expect(pending.enabled).toBe(false)
    expect(pending.pending).toBe(0)
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect(f.backend.control.sessionRequests).toBe(requests)
    const rejected = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result)
    expect(rejected).toMatchObject({ _tag: "Failure", failure: { code: "sync_disabled" } })
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "first admitted message" },
    })
    expect(yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })).toMatchObject({
      pending: 0,
    })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "first admitted message" },
    })
  }),
)

it.live("oversized or missing assets remain visibly pending with an injected HTTP peer", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    expect(yield* Assets.spool(s.global, id, new Uint8Array(8 * 1024 * 1024 + 1)).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "asset_error" },
    })
    yield* writeTool(s.db, { truncated: true, outputPath: path.join(f.directory, "never-existed.txt") })
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    const s = yield* boot(f)
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
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    const s = yield* boot(f)
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
        const s = yield* boot(f)
        yield* signIn(s.credentials)
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
        yield* s.db.run(
          sql`INSERT INTO _kilo_sync_directory(alias,directory) VALUES(${storedAbsolutePath(f.directory) ?? f.directory},${f.directory})`,
        )
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
    const s = yield* boot(f)
    yield* s.sync.status({ directory: f.directory })
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
    const s = yield* boot(f)
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
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "original cloud history")
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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

it.live("identity reuse while paused stays visible without journaling paused changes", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    yield* writeMessage(s.db, "acknowledged original identity")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const original = (yield* Store.sessions(s.db, f.directory))[0]
    const requests = f.backend.control.sessionRequests
    yield* s.sync.disable({ directory: f.directory })
    yield* s.bus.publish(SessionEvent.Deleted, { sessionID: id })
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "reimported while capture is paused")
    yield* s.db.update(SessionTable).set({ title: "paused identity reuse" }).where(eq(SessionTable.id, id)).run()
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: false,
      pending: 0,
      error: { code: "identity_conflict" },
    })
    expect(yield* s.sync.enable({ directory: f.directory, organizationID: null })).toMatchObject({
      enabled: true,
      error: { code: "identity_conflict" },
    })
    expect(yield* s.sync.flush({ directory: f.directory })).toMatchObject({ error: { code: "identity_conflict" } })
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect((yield* Store.sessions(s.db, f.directory))[0]).toMatchObject({
      acknowledged: original!.acknowledged,
      local_deleted: 1,
      error_code: "identity_conflict",
    })
    expect(f.backend.control.sessionRequests).toBe(requests)
    expect(f.backend.states.get(id)?.entities.get(`message/${messageID}`)).toMatchObject({
      message: { text: "acknowledged original identity" },
    })
  }),
)

it.live("a missing logical instruction blob is not JSON null, while an actual native null remains valid", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    const enabled = yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect(enabled).toMatchObject({ enabled: true, sessions: 0, pending: 0 })
    yield* seed(s.db, f.directory)
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
          const s = yield* boot(f)
          const alice = yield* signIn(s.credentials)
          yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
          yield* seed(s.db, f.directory)
          yield* writeMessage(s.db, "restart auth recovery")
          yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
          yield* signIn(s.credentials, "bob")
          expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("account_changed")
          yield* s.credentials.activate(alice.id)
        }),
      )
      const s = yield* boot(f, { background: true })
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
    const s = yield* boot(f, { flushTimeout: 200 })
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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

it.live("account switching pauses the pinned workspace without capture or upload and switching back resumes", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    const alice = yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.sync.status({ directory: f.directory })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const before = yield* Store.consent(s.db, f.directory)
    const requests = f.backend.control.sessionRequests
    yield* signIn(s.credentials, "bob")
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: false,
      userID: "alice",
      error: { code: "account_changed" },
    })
    yield* writeMessage(s.db, "must not capture under bob")
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect(yield* s.sync.flush({ directory: f.directory })).toMatchObject({ error: { code: "account_changed" } })
    expect(f.backend.control.sessionRequests).toBe(requests)
    expect(yield* Store.consent(s.db, f.directory)).toMatchObject({
      user_id: before!.user_id,
      destination: before!.destination,
      source_id: before!.source_id,
    })
    yield* s.credentials.activate(alice.id)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live("native save and new truncation output acquire provenance and remain portable after source cleanup", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    const s = yield* boot(f)
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
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null, assets: [file] })
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
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const pipe = path.join(f.directory, "named-pipe")
      yield* Effect.sync(() => execFileSync("mkfifo", [pipe]))
      const result = yield* enableAfterNativeWrite(s, {
        directory: f.directory,
        organizationID: null,
        assets: [pipe],
      }).pipe(Effect.result, Effect.timeoutOption(1000))
      expect(result).toMatchObject({ _tag: "Some", value: { _tag: "Failure", failure: { code: "asset_error" } } })
      expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)).toEqual([])
      expect(f.backend.blobs.size).toBe(0)
    }),
)

it.live(
  "failed exact-file preflight or approval commit leaves no partial consent and permits a corrected account",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* writeMessage(s.db, "before consent")
      const file = path.join(f.directory, "approved.txt")
      yield* Effect.promise(() => writeFile(file, "exact approved bytes"))
      expect(
        yield* enableAfterNativeWrite(s, {
          directory: f.directory,
          organizationID: null,
          assets: [file, path.join(f.directory, "missing")],
        }).pipe(Effect.result),
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
        yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null, assets: [file] }).pipe(
          Effect.exit,
        ),
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
      yield* signIn(s.credentials, "bob")
      const enabled = yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null, assets: [file] })
      expect(enabled).toMatchObject({ enabled: true, destination: f.backend.url, userID: "bob" })
      if (enabled.sourceID === undefined) return yield* Effect.die("Enabled sync status omitted its source")
      const before = yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)
      const replacement = path.join(f.directory, "new-approval.txt")
      yield* Effect.promise(() => writeFile(replacement, "a new approval must roll back too"))
      expect(
        yield* enableAfterNativeWrite(s, {
          directory: f.directory,
          organizationID: null,
          assets: [replacement, path.join(f.directory, "missing")],
        }).pipe(Effect.result),
      ).toMatchObject({ _tag: "Failure", failure: { code: "asset_error" } })
      expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_allowed_asset`)).toEqual(before)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect((yield* Store.sessions(s.db, f.directory))[0]?.source_id).toBe(enabled.sourceID)
      expect(f.backend.states.get(id)?.creatorID).toBe("bob")
    }),
)

it.live("concurrent enables for separate workspaces both succeed without a disable", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    const other = Session.ID.make("ses_concurrent_enable")
    yield* seed(s.db, f.excluded, other)
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        f.backend.control.hangExchange = true
      }),
      () =>
        Effect.sync(() => {
          f.backend.control.hangExchange = false
          f.backend.gate.resolve()
        }),
    )
    const enabling = yield* Effect.all(
      [f.directory, f.excluded].map((directory) =>
        s.sync.enable({ directory, organizationID: null }).pipe(Effect.result),
      ),
      { concurrency: "unbounded" },
    ).pipe(Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    f.backend.control.hangExchange = false
    f.backend.gate.resolve()
    const results = yield* Fiber.join(enabling)
    expect(results).toHaveLength(2)
    for (const result of results)
      expect(result).toMatchObject({ _tag: "Success", success: { enabled: true, userID: "alice" } })
    for (const directory of [f.directory, f.excluded])
      expect(yield* Store.consent(s.db, directory)).toMatchObject({ enabled: 1, user_id: "alice" })
    yield* writeMessage(s.db, "first concurrent workspace")
    yield* writeMessage(s.db, "second concurrent workspace", other, 0, SessionMessage.ID.make("msg_concurrent_enable"))
    for (const directory of [f.directory, f.excluded]) expect((yield* s.sync.flush({ directory })).pending).toBe(0)
    expect(f.backend.states.has(id)).toBe(true)
    expect(f.backend.states.has(other)).toBe(true)
  }),
)

it.live("disable from a nonexistent directory still pauses all capture and uploads globally", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const requests = f.backend.control.sessionRequests
    const exchanges = f.backend.control.exchanges
    const missing = path.join(f.root, "deleted-workspace")
    expect(yield* s.sync.disable({ directory: missing })).toMatchObject({ directory: missing, enabled: false })
    yield* writeMessage(s.db, "must stay local after global disable from a deleted cwd")
    expect(yield* Store.dirty(s.db, id)).toEqual([])
    expect((yield* s.sync.status({ directory: f.directory })).enabled).toBe(false)
    expect(yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result)).toMatchObject({
      _tag: "Failure",
      failure: { code: "sync_disabled" },
    })
    expect(f.backend.control.sessionRequests).toBe(requests)
    expect(f.backend.control.exchanges).toBe(exchanges)
  }),
)

it.live("disable fences an earlier enable awaiting first account exchange without waiting for the network", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    f.backend.control.hangExchange = true
    const enabling = yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null }).pipe(
      Effect.result,
      Effect.forkScoped,
    )
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
      const s = yield* boot(f, { background: true })
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* writeMessage(s.db, "background resumes")
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
      yield* s.db.run(`CREATE TRIGGER _test_sync_alias_abort BEFORE INSERT ON _kilo_sync_directory
      BEGIN SELECT RAISE(ABORT,'transient background defect'); END`)
      yield* seed(s.db, f.directory, Session.ID.make("ses_background_reconcile_trigger"))
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
        const s = yield* boot(f, { flushTimeout: 500 })
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
        yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    const s = yield* boot(f)
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
      const s = yield* boot(f, { flushTimeout: 40_000 })
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
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
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const child = path.join(f.directory, "nested")
    yield* Effect.promise(() => mkdir(child))
    const childID = Session.ID.make("ses_nested_scope")
    yield* seed(s.db, child, childID)
    yield* Store.enable(s.db, {
      directory: child,
      destination: "https://child.invalid",
      local: false,
      organizationID: null,
      tenant: { type: "user", id: "bob" },
      userID: "bob",
    })
    yield* writeMessage(s.db, "first native child write", childID, 0, SessionMessage.ID.make("msg_nested_initial"))
    yield* Store.reconcile(s.db, child, true)
    yield* Store.reconcile(s.db, f.directory)
    yield* writeMessage(s.db, "child retains capture", childID, 1, SessionMessage.ID.make("msg_nested_scope"))
    const newChild = Session.ID.make("ses_nested_new")
    yield* seed(s.db, child, newChild)
    expect((yield* Store.sessions(s.db, child)).map((row) => row.id)).toEqual([childID, newChild].sort())
    expect((yield* Store.dirty(s.db, childID)).map((row) => row.value).join()).toContain("child retains capture")
    expect(
      yield* s.db.get(
        sql`SELECT directory FROM _kilo_sync_directory WHERE alias=${storedAbsolutePath(child) ?? child}`,
      ),
    ).toEqual({
      directory: child,
    })
    expect(f.backend.states.has(childID)).toBe(false)
    yield* Store.disable(s.db, child)
    yield* Store.reconcile(s.db, f.directory)
    const disabledChild = Session.ID.make("ses_nested_disabled")
    yield* seed(s.db, child, disabledChild)
    expect(yield* s.db.get(sql`SELECT directory FROM _kilo_sync_session WHERE id=${disabledChild}`)).toBeUndefined()
    yield* writeMessage(
      s.db,
      "disabled child must not journal",
      childID,
      2,
      SessionMessage.ID.make("msg_nested_disabled"),
    )
    expect((yield* Store.dirty(s.db, childID)).map((row) => row.value).join()).not.toContain(
      "disabled child must not journal",
    )
    expect((yield* Store.sessions(s.db, f.directory)).map((row) => row.id)).toEqual([id])
  }),
)

it.live(
  "never-enabled native output records metadata without blob reads and initial backfill admits only unchanged allocations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
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
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(Buffer.from(f.backend.blobs.get(`${id}/${digest("native before opt-in")}`) ?? []).toString()).toBe(
        "native before opt-in",
      )
    }),
)

it.live("unconsented provenance identity rejects same-size output rewrites even when mtime is restored", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
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
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("asset_error")
    expect(f.backend.blobs.size).toBe(0)
  }),
)

it.live("unused provenance is bounded while dirty native references keep their exact allocation authority", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
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
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      const approved = path.join(f.directory, "approved-unused.txt")
      const approvedBytes = Buffer.from("workspace approval survives without a transcript")
      yield* Effect.promise(() => writeFile(approved, approvedBytes))
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null, assets: [approved] })
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
      const s = yield* boot(f)
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
    const s = yield* boot(f)
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
    expect(
      yield* s.db.get(
        sql`SELECT directory FROM _kilo_sync_directory WHERE alias=${storedAbsolutePath(child) ?? child}`,
      ),
    ).toEqual({
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
    const s = yield* boot(f)
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
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null, assets: [file] })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live(
  "replaced preparation refs cannot freeze reclaimed bytes while immutable packets retain previous generations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
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
      const s = yield* boot(f)
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

it.live("persists one exchange outage cooldown across sessions, restart, flush and enable", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f)
        yield* signIn(s.credentials)
        for (let n = 0; n < 40; n++)
          yield* seed(s.db, f.directory, Session.ID.make(`ses_outage_${String(n).padStart(2, "0")}`))
        yield* allow(s.db, f.directory, f.backend)
        f.backend.control.exchangeFailures = true
        expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
        expect(f.backend.control.exchanges).toBe(1)
        expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_exchange_cooldown`)).toHaveLength(1)
        expect(f.backend.control.sessionRequests).toBe(0)
        expect(yield* Store.sessions(s.db, f.directory)).toHaveLength(40)
      }),
    )
    const s = yield* boot(f)
    yield* s.sync.flush({ directory: f.directory })
    expect(
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null }).pipe(Effect.result),
    ).toMatchObject({ _tag: "Failure", failure: { code: "auth_unavailable", retryable: true } })
    yield* s.sync.flush({ directory: f.directory })
    expect(f.backend.control.exchanges).toBe(1)
    expect(yield* s.db.all(sql`SELECT * FROM _kilo_sync_exchange_cooldown`)).toHaveLength(1)
    expect(f.backend.control.sessionRequests).toBe(0)
    expect((yield* s.sync.status({ directory: f.directory })).pending).toBe(40)
    // A refreshed token for the same account must both exchange and drain old sessions.
    yield* signIn(s.credentials, "alice#refreshed")
    f.backend.control.exchangeFailures = false
    const enabled = yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect(enabled.enabled).toBe(true)
    expect(f.backend.control.exchanges).toBe(2)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect((yield* Store.sessions(s.db, f.directory)).every((row) => row.server_retry_at === 0)).toBe(true)
  }),
)

it.live("rotates session 33 ahead of continuously dirty sessions", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    const last = Session.ID.make("ses_fair_32")
    for (let n = 0; n < 33; n++)
      yield* seed(s.db, f.directory, Session.ID.make(`ses_fair_${String(n).padStart(2, "0")}`))
    yield* allow(s.db, f.directory, f.backend)
    yield* s.db.run(`CREATE TRIGGER _test_keep_dirty AFTER DELETE ON _kilo_sync_dirty
      WHEN OLD.session_id<>'ses_fair_32' BEGIN
      UPDATE session_v2 SET time_updated=time_updated+1 WHERE id=OLD.session_id; END`)
    const flushing = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.result, Effect.forkScoped)
    yield* Effect.sync(() => f.backend.states.get(last)?.position ?? 0).pipe(
      Effect.repeat({ while: (position) => position === 0, schedule: Schedule.spaced(10) }),
      Effect.timeout(5000),
    )
    yield* Fiber.interrupt(flushing)
    expect(f.backend.states.get(last)?.position).toBeGreaterThan(0)
    expect((yield* Store.sessions(s.db, f.directory)).every((row) => row.last_attempt > 0)).toBe(true)
  }),
)

it.live("reuses acknowledged blob knowledge across packets and reuploads an expired hint", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    const output = yield* s.output(f.directory)
    const file = yield* output.save(Buffer.from("immutable attachment"), ".txt")
    yield* writeTool(s.db, {}, pathToFileURL(file).href)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const hash = digest("immutable attachment")
    expect(f.backend.blobRequests.filter((item) => item === hash)).toHaveLength(1)
    yield* s.db.update(SessionMessageTable).set({ time_updated: 21 }).where(eq(SessionMessageTable.id, messageID)).run()
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.blobRequests.filter((item) => item === hash)).toHaveLength(1)
    // Lose a server-side body hint after ACK, then reference identical bytes again.
    const text = "large immutable body ".repeat(5000)
    const bodyID = SessionMessage.ID.make("msg_known_body")
    yield* writeMessage(s.db, text, id, 1, bodyID)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    const bodyHash = f.backend.blobRequests.at(-1)!
    f.backend.blobs.delete(`${id}/${bodyHash}`)
    yield* s.db.update(SessionMessageTable).set({ time_updated: 22 }).where(eq(SessionMessageTable.id, bodyID)).run()
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("blob_missing")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.blobRequests.filter((item) => item === bodyHash)).toHaveLength(2)
  }),
)

it.live("dirty materialization stops at its byte budget and permits one externalized entity", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    yield* s.db.run(sql`DELETE FROM _kilo_sync_dirty WHERE session_id=${id}`)
    for (let n = 0; n < 64; n++)
      yield* writeMessage(s.db, "x".repeat(1024), id, n, SessionMessage.ID.make(`msg_budget_${n}`))
    const rows = yield* Store.dirty(s.db, id, 2300)
    expect(rows).toHaveLength(2)
    expect(rows.reduce((bytes, row) => bytes + Buffer.byteLength(row.value ?? ""), 0)).toBeLessThanOrEqual(2300)
    expect(yield* Store.dirty(s.db, id, 1)).toHaveLength(1)
    expect(yield* s.db.all(sql`SELECT id FROM _kilo_sync_dirty WHERE session_id=${id}`)).toHaveLength(64)
  }),
)

it.live("tenant quota pauses until an explicit retry", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    f.backend.control.quota = true
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("tenant_budget_exceeded")
    expect((yield* Store.sessions(s.db, f.directory))[0]?.retry_at).toBe(Number.MAX_SAFE_INTEGER)
    f.backend.control.quota = false
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live("ACK cleanup visits only its session namespace and preserves current preparation pins", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    const obsolete = yield* Assets.spool(s.global, id, Buffer.from("obsolete acknowledged body"))
    const pinned = yield* Assets.spool(s.global, id, Buffer.from("active preparation"))
    const other = yield* Assets.spool(s.global, "other-session", Buffer.from("another session"))
    const approval = yield* Assets.spool(s.global, `workspace:${f.directory}`, Buffer.from("exact approval"))
    yield* s.db.run(sql`INSERT INTO _kilo_sync_preparation(token,namespace,hash,bytes,deadline)
      VALUES('test-pin',${digest(id)},${pinned.hash},${pinned.bytes},${Date.now() + 60_000})`)
    yield* Assets.prune(s.db, s.global, id)
    expect(yield* Assets.read(s.global, id, obsolete).pipe(Effect.result)).toMatchObject({ _tag: "Failure" })
    expect(yield* Assets.read(s.global, id, pinned).pipe(Effect.result)).toMatchObject({ _tag: "Success" })
    expect(yield* Assets.read(s.global, "other-session", other).pipe(Effect.result)).toMatchObject({ _tag: "Success" })
    expect(yield* Assets.read(s.global, `workspace:${f.directory}`, approval).pipe(Effect.result)).toMatchObject({
      _tag: "Success",
    })
  }),
)

it.live("four sessions progress concurrently while each retains one immutable packet", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    const sessions = Array.from({ length: 8 }, (_, n) => Session.ID.make(`ses_parallel_${n}`))
    for (const session of sessions) yield* seed(s.db, f.directory, session)
    yield* allow(s.db, f.directory, f.backend)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* s.db.run(sql`UPDATE session_v2 SET time_updated=time_updated+1`)
    f.backend.control.batchGate = true
    const flushing = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.forkScoped)
    yield* Effect.sync(() => f.backend.control.gatedBatches).pipe(
      Effect.repeat({ while: (reads) => reads < 4, schedule: Schedule.spaced(10) }),
      Effect.timeout(5000),
    )
    expect(f.backend.control.gatedBatches).toBe(4)
    expect(yield* s.db.all(sql`SELECT session_id FROM _kilo_sync_packet`)).toHaveLength(4)
    f.backend.gate.resolve()
    expect((yield* Fiber.join(flushing)).pending).toBe(0)
  }),
)

it.live("flush and enable cannot bypass a session's server-imposed retry deadline", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    f.backend.control.mode = "offline"
    f.backend.control.retryAfter = true
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
    expect((yield* Store.sessions(s.db, f.directory))[0]?.server_retry_at).toBeGreaterThan(Date.now() + 119_000)
    f.backend.control.mode = "online"
    yield* writeMessage(s.db, "newer capture cannot bypass the server deadline")
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
    expect(f.backend.states.size).toBe(0)
  }),
)

it.live("an aborted retry response retains its deadline and prevents the next flush request", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    f.backend.control.abortBody = true
    expect((yield* s.sync.flush({ directory: f.directory })).error?.code).toBe("network_error")
    expect((yield* Store.sessions(s.db, f.directory))[0]?.server_retry_at).toBeGreaterThan(Date.now() + 119_000)
    const requests = f.backend.control.sessionRequests
    yield* s.sync.flush({ directory: f.directory })
    expect(f.backend.control.sessionRequests).toBe(requests)
  }),
)

it.live(
  "bounds distinct externalized revision hints and clears them on disable and local deletion",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* allow(s.db, f.directory, f.backend)
      const text = "x".repeat(65 * 1024)
      for (let revision = 0; revision < 260; revision++) {
        yield* writeMessage(s.db, `${revision}:${text}`)
        expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
        expect(
          (yield* s.db.get<{ count: number }>(
            sql`SELECT count(*) AS count FROM _kilo_sync_known_blob WHERE session_id=${id}`,
          ))?.count,
        ).toBeLessThanOrEqual(256)
      }
      expect(
        (yield* s.db.get<{ count: number }>(
          sql`SELECT count(*) AS count FROM _kilo_sync_known_blob WHERE session_id=${id}`,
        ))?.count,
      ).toBe(256)
      const oldest = f.backend.blobRequests[0]!
      const newest = f.backend.blobRequests.at(-1)!
      expect(
        yield* s.db.get(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id=${id} AND hash=${oldest}`),
      ).toBeUndefined()
      expect(
        yield* s.db.get(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id=${id} AND hash=${newest}`),
      ).toBeDefined()
      yield* s.sync.disable({ directory: f.directory })
      expect(yield* s.db.all(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id=${id}`)).toEqual([])
      yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
      yield* writeMessage(s.db, `after-enable:${text}`)
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      expect(yield* s.db.all(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id=${id}`)).toHaveLength(1)
      yield* s.bus.publish(SessionEvent.Deleted, { sessionID: id })
      expect(yield* s.db.all(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id=${id}`)).toEqual([])
    }),
  90_000,
)

it.live("upgrades an unbounded hint table to its newest per-session entries", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* s.db.run("DROP TRIGGER _kilo_sync_hint_limit")
    yield* s.db.run(`WITH RECURSIVE sequence(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM sequence WHERE n<300)
      INSERT INTO _kilo_sync_known_blob(session_id,hash,bytes)
      SELECT 'legacy-session',printf('%064x',n),n FROM sequence`)
    yield* Store.initialize(s.db)
    expect(
      (yield* s.db.get<{ count: number }>(
        sql`SELECT count(*) AS count FROM _kilo_sync_known_blob WHERE session_id='legacy-session'`,
      ))?.count,
    ).toBe(256)
    expect(
      yield* s.db.get(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id='legacy-session' AND bytes=1`),
    ).toBeUndefined()
    expect(
      yield* s.db.get(sql`SELECT hash FROM _kilo_sync_known_blob WHERE session_id='legacy-session' AND bytes=300`),
    ).toBeDefined()
  }),
)

it.live("a restarted producer preserves the same credential deadline but accepts a refreshed credential", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f)
        yield* signIn(s.credentials)
        yield* seed(s.db, f.directory)
        yield* allow(s.db, f.directory, f.backend)
        f.backend.control.mode = "offline"
        f.backend.control.retryAfter = true
        expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
        expect((yield* Store.sessions(s.db, f.directory))[0]?.retry_credential).toBe(digest("fixture:alice"))
      }),
    )
    const s = yield* boot(f)
    f.backend.control.mode = "online"
    const requests = f.backend.control.sessionRequests
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
    expect(f.backend.control.sessionRequests).toBe(requests)
    yield* signIn(s.credentials, "alice#refreshed")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect((yield* Store.sessions(s.db, f.directory))[0]).toMatchObject({
      server_retry_at: 0,
      retry_credential: null,
    })
  }),
)

it.live("an expired exchange cooldown permits a request and is removed after success", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    yield* s.db.run(sql`INSERT INTO _kilo_sync_exchange_cooldown
      (destination,organization_id,credential_digest,retry_at,attempts,error_code)
      VALUES(${f.backend.url},'',${digest("fixture:alice")},${Date.now() - 1},3,'auth_unavailable')`)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.control.exchanges).toBe(1)
    expect(yield* Store.exchangeCooldown(s.db, f.backend.url, null, digest("fixture:alice"))).toBeUndefined()
  }),
)

it.live("post-consent cleanup failure reports enabled state and retries cleanup on the next pass", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* s.db.run(`INSERT INTO _kilo_sync_preparation(token,namespace,hash,bytes,deadline)
      VALUES('expired-cleanup','cleanup-proof','unused',1,0)`)
    yield* s.db.run(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON _kilo_sync_preparation
      BEGIN SELECT RAISE(FAIL,'synthetic cleanup failure'); END`)
    const enabled = yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect(enabled).toMatchObject({ enabled: true, error: { code: "background_error" } })
    expect((yield* Store.consent(s.db, f.directory))?.enabled).toBe(1)
    yield* s.db.run("DROP TRIGGER fail_cleanup")
    const flushed = yield* s.sync.flush({ directory: f.directory })
    expect(flushed.pending).toBe(0)
    expect(flushed.error).toBeUndefined()
    expect(yield* s.db.all(sql`SELECT token FROM _kilo_sync_preparation`)).toEqual([])
  }),
)

it.live("startup cleanup defects preserve native service availability and retry after repair", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    yield* Effect.scoped(
      Effect.gen(function* () {
        const s = yield* boot(f)
        yield* signIn(s.credentials)
        yield* seed(s.db, f.directory)
        yield* allow(s.db, f.directory, f.backend)
        yield* s.db.run(`INSERT INTO _kilo_sync_preparation(token,namespace,hash,bytes,deadline)
        VALUES('startup-cleanup','cleanup-proof','unused',1,0)`)
        yield* s.db.run(`CREATE TRIGGER fail_cleanup BEFORE DELETE ON _kilo_sync_preparation
        BEGIN SELECT RAISE(FAIL,'synthetic startup cleanup failure'); END`)
      }),
    )
    const s = yield* boot(f)
    expect(yield* s.sync.status({ directory: f.directory })).toMatchObject({
      enabled: true,
      error: { code: "background_error" },
    })
    yield* s.db.run("DROP TRIGGER fail_cleanup")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(yield* s.db.all(sql`SELECT token FROM _kilo_sync_preparation`)).toEqual([])
  }),
)

it.live("a server deadline still covers a native capture made while its response was in flight", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* writeMessage(s.db, "initial")
    yield* enableAfterNativeWrite(s, { directory: f.directory, organizationID: null })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    yield* writeMessage(s.db, "selected capture")
    f.backend.control.batchGate = true
    f.backend.control.batchRetryAfter = true
    const response = yield* s.sync.flush({ directory: f.directory }).pipe(Effect.forkScoped)
    yield* Effect.promise(() => f.backend.entered.promise)
    yield* writeMessage(s.db, "newer capture still honors the service deadline")
    f.backend.control.batchGate = false
    f.backend.control.batchRetryAfter = false
    f.backend.gate.resolve()
    expect((yield* Fiber.join(response)).pending).toBeGreaterThan(0)
    expect((yield* Store.sessions(s.db, f.directory))[0]?.server_retry_at).toBeGreaterThan(Date.now() + 119_000)
    const requests = f.backend.control.sessionRequests
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBeGreaterThan(0)
    expect(f.backend.control.sessionRequests).toBe(requests)
    yield* s.db.run(sql`UPDATE _kilo_sync_session SET server_retry_at=0 WHERE id=${id}`)
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
  }),
)

it.live(
  "real producer streams 1000 native parts with linear transmitted bytes and exact reconstruction",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const s = yield* boot(f)
      yield* signIn(s.credentials)
      yield* seed(s.db, f.directory)
      yield* allow(s.db, f.directory, f.backend)
      const {
        id: _,
        type,
        ...data
      } = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.Assistant))({
        id: messageID,
        type: "assistant",
        agent: "build",
        model: { providerID: "fixture", id: "model", variant: "default" },
        metadata: { opaque: { nil: null } },
        native: { signature: "exact" },
        content: [],
        time: { created: 10 },
      })
      yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: messageID, type, seq: 0, data }).run()
      const content = Array.from({ length: 1000 }, (_, ordinal) => ({
        type: "text" as const,
        text: `${ordinal}:` + "x".repeat(1024),
        native: { nil: null },
      }))
      const emptyBytes = Buffer.byteLength(JSON.stringify({ seq: 0, message: { ...data, id: messageID, type } }))
      let partBytes = 0
      let replacementPayloadBytes = 0
      for (const [ordinal, part] of content.entries()) {
        partBytes += Buffer.byteLength(JSON.stringify(part))
        replacementPayloadBytes += emptyBytes + partBytes + ordinal
        yield* s.db
          .insert(SessionPartTable)
          .values({
            session_id: id,
            message_id: messageID,
            ordinal,
            type: part.type,
            data: part,
          })
          .run()
        const status = yield* s.sync.flush({ directory: f.directory })
        expect(status.error).toBeUndefined()
        expect(status.pending).toBe(0)
        const state = f.backend.states.get(id)!
        expect(
          reconstructMessage(
            state.entities.get(`message/${messageID}`)!,
            [...state.entities.entries()].filter(([key]) => key.startsWith("message-part/")).map(([, value]) => value),
            state.position,
          ),
        ).toEqual({ complete: false })
      }
      yield* s.db
        .update(SessionMessageTable)
        .set({ data: { ...data, time: { created: 10, completed: 20 } } })
        .where(eq(SessionMessageTable.id, messageID))
        .run()
      expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
      const state = f.backend.states.get(id)!
      const restored = reconstructMessage(
        state.entities.get(`message/${messageID}`)!,
        [...state.entities.entries()].filter(([key]) => key.startsWith("message-part/")).map(([, value]) => value),
        state.position,
      )
      expect(restored).toEqual({
        complete: true,
        value: json({
          seq: 0,
          message: { ...data, id: messageID, type, content, time: { created: 10, completed: 20 } },
        }),
      })
      const bytes =
        f.backend.bodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0) +
        f.backend.blobRequests.reduce((sum, hash) => sum + f.backend.blobs.get(`${id}/${hash}`)!.byteLength, 0)
      const finalBytes = Buffer.byteLength(JSON.stringify(restored.complete ? restored.value : null))
      expect(bytes).toBeLessThan(finalBytes * 4)
      expect(f.backend.blobRequests).toHaveLength(0)
      console.log(
        JSON.stringify({
          scenario: "1000-native-parts",
          afterBatchAndBlobBytes: bytes,
          finalPayloadBytes: finalBytes,
          beforeFullMessagePayloadBytes: replacementPayloadBytes + finalBytes,
          baselineScope: "native JSON payload only; excludes batch metadata",
        }),
      )
    }),
  120_000,
)

for (const partType of ["text", "reasoning", "tool"] as const)
  it.live(
    `real producer defers a 200KiB mutable ${partType} body for 100 revisions and uploads it once settled`,
    () =>
      Effect.gen(function* () {
        const f = yield* fixture
        const s = yield* boot(f)
        yield* signIn(s.credentials)
        yield* seed(s.db, f.directory)
        yield* allow(s.db, f.directory, f.backend)
        const {
          id: _,
          type,
          ...data
        } = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.Assistant))({
          id: messageID,
          type: "assistant",
          agent: "build",
          model: { providerID: "fixture", id: "model", variant: "default" },
          content: [],
          time: { created: 10 },
        })
        yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: messageID, type, seq: 0, data }).run()
        const body = "x".repeat(200 * 1024)
        let replacementPayloadBytes = 0
        for (let revision = 0; revision < 100; revision++) {
          const part =
            partType === "tool"
              ? {
                  type: "tool" as const,
                  id: "call_large",
                  name: "fixture",
                  time: { created: 10 },
                  state: { status: "running" as const, input: {}, metadata: { output: `${revision}:${body}` } },
                }
              : { type: partType, text: `${revision}:${body}` }
          replacementPayloadBytes += Buffer.byteLength(
            JSON.stringify({ seq: 0, message: { ...data, id: messageID, type, content: [part] } }),
          )
          yield* s.db
            .insert(SessionPartTable)
            .values({
              session_id: id,
              message_id: messageID,
              ordinal: 0,
              type: part.type,
              data: part,
            })
            .onConflictDoUpdate({
              target: [SessionPartTable.message_id, SessionPartTable.ordinal],
              set: { data: part },
            })
            .run()
          expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
          expect(f.backend.blobRequests).toHaveLength(0)
          expect(f.backend.states.get(id)?.entities.get(`message-part/${messageID}/0`)).toMatchObject({
            deferred: true,
          })
        }
        const finalPart: SessionPartData =
          partType === "tool"
            ? {
                type: "tool" as const,
                id: "call_large",
                name: "fixture",
                time: { created: 10, completed: 20 },
                state: {
                  status: "completed" as const,
                  input: {},
                  content: [{ type: "text" as const, text: `99:${body}` }],
                },
              }
            : { type: partType, text: `99:${body}` }
        if (partType === "tool")
          yield* s.db
            .update(SessionPartTable)
            .set({ data: finalPart })
            .where(eq(SessionPartTable.message_id, messageID))
            .run()
        yield* s.db
          .update(SessionMessageTable)
          .set({ data: { ...data, time: { created: 10, completed: 20 } } })
          .where(eq(SessionMessageTable.id, messageID))
          .run()
        expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
        const state = f.backend.states.get(id)!
        expect(
          reconstructMessage(
            state.entities.get(`message/${messageID}`)!,
            [state.entities.get(`message-part/${messageID}/0`)!],
            state.position,
          ),
        ).toEqual({
          complete: true,
          value: json({
            seq: 0,
            message: { ...data, id: messageID, type, content: [finalPart], time: { created: 10, completed: 20 } },
          }),
        })
        expect(f.backend.blobRequests).toHaveLength(1)
        const bytes =
          f.backend.bodies.reduce((sum, value) => sum + Buffer.byteLength(value), 0) +
          f.backend.blobRequests.reduce((sum, hash) => sum + f.backend.blobs.get(`${id}/${hash}`)!.byteLength, 0)
        expect(bytes).toBeLessThan(body.length * 2)
        replacementPayloadBytes += Buffer.byteLength(
          JSON.stringify({
            seq: 0,
            message: { ...data, id: messageID, type, content: [finalPart], time: { created: 10, completed: 20 } },
          }),
        )
        console.log(
          JSON.stringify({
            scenario: `200KiB-${partType}-100-revisions`,
            afterBatchAndBlobBytes: bytes,
            bodyBytes: body.length,
            beforeFullMessagePayloadBytes: replacementPayloadBytes,
            baselineScope: "native JSON payload only; excludes batch metadata",
          }),
        )
      }),
    60_000,
  )

it.live("producer externalizes node-heavy and deep values and splits aggregate JSON nodes below the byte limit", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    const wide = Array.from({ length: 8192 }, () => 0)
    let deep: Schema.Json = null
    for (let level = 0; level < 65; level++) deep = [deep]
    for (const [seq, metadata] of [wide, deep].entries()) {
      const message = SessionMessage.ID.make(`msg_budget_blob_${seq}`)
      yield* writeMessage(s.db, "externalized structured metadata", id, seq, message)
      yield* s.db.run(
        sql`UPDATE session_message SET data=json_set(data,'$.metadata',json_object('fixture',json(${JSON.stringify(metadata)}))) WHERE id=${message}`,
      )
    }
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.blobRequests).toHaveLength(2)
    const start = f.backend.bodies.length
    for (let seq = 2; seq < 12; seq++) {
      const message = SessionMessage.ID.make(`msg_budget_inline_${seq}`)
      yield* writeMessage(s.db, "bounded structured metadata", id, seq, message)
      yield* s.db.run(
        sql`UPDATE session_message SET data=json_set(data,'$.metadata',json_object('fixture',json(${JSON.stringify(wide.slice(0, 4000))}))) WHERE id=${message}`,
      )
    }
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.bodies.length - start).toBeGreaterThan(1)
    for (const body of f.backend.bodies) {
      const packet = readPacket(body)
      expect(jsonNodes(packet, limits.jsonBatchDepth, limits.jsonBatchNodes)).toBeDefined()
      expect(Buffer.byteLength(body)).toBeLessThanOrEqual(limits.batch)
      for (const change of packet.changes) if (change.value !== undefined) expect(jsonNodes(change.value)).toBeDefined()
    }
    expect(f.backend.blobRequests).toHaveLength(2)
    expect(f.backend.states.get(id)?.entities.size).toBe(13)
  }),
)

it.live("semantic revert removes independent native parts with the same cause as their message", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* seed(s.db, f.directory)
    yield* allow(s.db, f.directory, f.backend)
    yield* writeMessage(s.db, "retained boundary")
    const assistantID = SessionMessage.ID.make("msg_revert_split")
    const {
      id: _,
      type,
      ...data
    } = Schema.decodeUnknownSync(Schema.toEncoded(SessionMessage.Assistant))({
      id: assistantID,
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "model", variant: "default" },
      content: [],
      time: { created: 10, completed: 20 },
    })
    yield* s.db.insert(SessionMessageTable).values({ session_id: id, id: assistantID, type, seq: 1, data }).run()
    yield* s.db
      .insert(SessionPartTable)
      .values({
        session_id: id,
        message_id: assistantID,
        ordinal: 3,
        type: "text",
        data: { type: "text", text: "reverted output" },
      })
      .run()
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.has(`message-part/${assistantID}/3`)).toBe(true)
    yield* s.bus.publish(SessionEvent.RevertEvent.Committed, { sessionID: id, to: assistantID })
    const dirty = yield* Store.dirty(s.db, id)
    expect(dirty.find((row) => row.kind === "message" && row.id === assistantID)).toMatchObject({
      op: "remove",
      cause: "revert",
    })
    expect(dirty.find((row) => row.kind === "message-part" && row.id === `${assistantID}/3`)).toMatchObject({
      op: "remove",
      cause: "revert",
    })
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.states.get(id)?.entities.has(`message/${assistantID}`)).toBe(false)
    expect(f.backend.states.get(id)?.entities.has(`message-part/${assistantID}/3`)).toBe(false)
    expect(f.backend.states.get(id)?.entities.has(`message/${messageID}`)).toBe(true)
  }),
)
