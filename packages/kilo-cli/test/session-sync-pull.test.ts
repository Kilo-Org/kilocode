import { expect } from "bun:test"
import { KiloSessionSync } from "@kilocode/kilo-plugin"
import { Context, Effect, Layer, Schema } from "effect"
import { sql } from "drizzle-orm"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { ProjectTable } from "@opencode/core/project/sql"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionProjector } from "@opencode/core/session/projector"
import { Database } from "@opencode/core/database/database"
import { Bus } from "@opencode/core/bus"
import { Credential } from "@opencode/core/credential"
import { IntegrationID } from "@opencode/schema/integration-id"
import { AbsolutePath } from "@opencode/schema/schema"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { testEffect } from "../../core/test/lib/effect"
import { SessionSync } from "../src/session-sync"
import { Store } from "../src/session-sync/store"
import { digest, deletedMessage } from "../src/session-sync/protocol"

const it = testEffect(Layer.empty)

type WireSource = { sourceID: string; client: "cli" | "mobile" | "cloud-agent"; joinedAt: number }

type PeerSession = {
  creatorID: string
  tenant: { type: "user" | "organization"; id: string }
  position: number
  revision: number
  lastReceipt: Record<string, Schema.Json> | null
  entities: Map<string, Schema.Json>
  sources: WireSource[]
  deleted: boolean
}

// Loopback stand-in for the session-sync service: one position stream per session, source membership,
// entity pages and tombstones. Blob bytes live in memory; nothing leaves 127.0.0.1.
const peer = () => {
  const sessions = new Map<string, PeerSession>()
  const grants = new Map<string, { userID: string; tenant: { type: "user" | "organization"; id: string } }>()
  const blobs = new Map<string, Uint8Array>()
  const bodies: string[] = []
  const control = { deleteMode: "ok" as "ok" | "forbidden" | "retryable" | "invalid" }
  const putEntities = (sessionID: string, changes: readonly Record<string, Schema.Json>[]) => {
    const state = sessions.get(sessionID)!
    for (const change of changes) {
      const key = `${String(change.kind)}/${String(change.id)}`
      if (change.op === "remove") {
        state.entities.delete(key)
        continue
      }
      const blob = change.blob as { hash?: string } | undefined
      if (blob?.hash) {
        const bytes = blobs.get(`${sessionID}/${blob.hash}`)
        state.entities.set(key, JSON.parse(Buffer.from(bytes!).toString("utf8")) as Schema.Json)
        continue
      }
      state.entities.set(key, change.value as Schema.Json)
    }
    state.revision += 1
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 60,
    fetch: async (request) => {
      const url = new URL(request.url)
      const error = (code: string, status: number) => Response.json({ error: { code, message: "fixture" } }, { status })
      const token = request.headers.get("authorization")?.replace("Bearer ", "") ?? ""
      if (url.pathname === "/v1/auth/exchange") {
        if (!token.startsWith("fixture:")) return error("invalid_credential", 401)
        const userID = token.slice("fixture:".length)
        const { organizationID } = (await request.json()) as { organizationID?: string }
        const tenant = organizationID ? { type: "organization" as const, id: organizationID } : { type: "user" as const, id: userID }
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
      const grant = grants.get(token)
      if (!grant) return error("invalid_grant", 401)
      const match = /^\/v1\/sessions\/([^/]+)(?:\/(entities|batches|blobs))?(?:\/([0-9a-f]{64}))?$/.exec(url.pathname)
      if (!match?.[1]) return error("not_found", 404)
      const sessionID = decodeURIComponent(match[1])
      const existing = sessions.get(sessionID)
      if (match[2] === "blobs" && match[3]) {
        if (request.method === "GET") {
          const bytes = blobs.get(`${sessionID}/${match[3]}`)
          if (!bytes) return error("blob_not_found", 404)
          // `Response` wants an ArrayBuffer; a byte-range slice of the stored copy is one.
          const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
          return new Response(body, { headers: { "content-type": "application/octet-stream" } })
        }
        const bytes = new Uint8Array(await request.arrayBuffer())
        if (digest(bytes) !== match[3]) return error("blob_hash_mismatch", 400)
        blobs.set(`${sessionID}/${match[3]}`, bytes)
        return Response.json({ version: 1, hash: match[3], bytes: bytes.byteLength, created: true })
      }
      if (match[2] === "batches") {
        const body = await request.text()
        bodies.push(body)
        const packet = JSON.parse(body) as {
          sourceID: string
          batchID: string
          after: number
          through: number
          changes: Record<string, Schema.Json>[]
        }
        if (!existing) return error("session_not_found", 404)
        if (existing.deleted) return error("session_deleted", 410)
        if (existing.creatorID !== grant.userID) return error("creator_mismatch", 403)
        if (!existing.sources.some((source) => source.sourceID === packet.sourceID)) return error("source_conflict", 409)
        if (existing.position !== packet.after)
          return error(packet.through <= existing.position ? "batch_superseded" : "position_conflict", 409)
        putEntities(sessionID, packet.changes)
        const receipt = {
          version: 1,
          sessionID,
          batchID: packet.batchID,
          after: packet.after,
          through: packet.through,
          revision: existing.revision,
          changes: packet.changes.length,
          digest: digest(body),
          committedAt: Date.now(),
        }
        existing.position = packet.through
        existing.lastReceipt = receipt
        return Response.json(receipt)
      }
      if (request.method === "PUT") {
        const body = (await request.json()) as { sourceID: string; client?: WireSource["client"] }
        if (existing) {
          if (existing.deleted) return error("session_deleted", 410)
          if (existing.creatorID !== grant.userID) return error("creator_mismatch", 403)
          if (!existing.sources.some((source) => source.sourceID === body.sourceID))
            existing.sources.push({ sourceID: body.sourceID, client: body.client ?? "cli", joinedAt: Date.now() })
          return Response.json(liveState(sessionID, existing))
        }
        const created = {
          creatorID: grant.userID,
          tenant: grant.tenant,
          position: 0,
          revision: 0,
          lastReceipt: null,
          entities: new Map<string, Schema.Json>(),
          sources: [{ sourceID: body.sourceID, client: body.client ?? "cli", joinedAt: Date.now() }],
          deleted: false,
        }
        sessions.set(sessionID, created)
        return Response.json(liveState(sessionID, created), { status: 201 })
      }
      if (request.method === "DELETE") {
        if (!existing) return error("session_not_found", 404)
        if (control.deleteMode === "forbidden") return error("creator_mismatch", 403)
        if (control.deleteMode === "retryable") return error("service_overloaded", 503)
        if (control.deleteMode === "invalid") return Response.json({ version: 1, sessionID })
        existing.deleted = true
        return Response.json({ version: 1, sessionID, deleted: true, deletedAt: Date.now() })
      }
      if (!existing) return error("session_not_found", 404)
      if (existing.deleted)
        return Response.json({ version: 1, sessionID, deleted: true, tenant: existing.tenant, deletedAt: Date.now() })
      if (match[2] === "entities") {
        const revision = url.searchParams.get("revision")
        if (revision !== null && Number(revision) !== existing.revision) return error("revision_changed", 409)
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100)
        const cursor = url.searchParams.get("cursor")
        let after: { kind: string; id: string } | undefined
        if (cursor) {
          const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
          if (!Array.isArray(decoded) || typeof decoded[0] !== "string" || typeof decoded[1] !== "string")
            return error("invalid_request", 400)
          after = { kind: decoded[0], id: decoded[1] }
        }
        const entries = [...existing.entities.entries()]
          .map(([key, value]) => ({ kind: key.slice(0, key.indexOf("/")), id: key.slice(key.indexOf("/") + 1), value }))
          .filter((entry) => {
            if (!after) return true
            if (entry.kind !== after.kind) return entry.kind > after.kind
            return entry.id > after.id
          })
          .sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind < b.kind ? -1 : 1))
        const page = entries.slice(0, limit)
        const next =
          entries.length > page.length
            ? Buffer.from(JSON.stringify([page[page.length - 1]!.kind, page[page.length - 1]!.id])).toString("base64url")
            : null
        return Response.json({
          version: 1,
          sessionID,
          revision: existing.revision,
          position: existing.position,
          entities: page.map((entry) => ({ kind: entry.kind, id: entry.id, revision: existing.revision, value: entry.value })),
          next,
        })
      }
      return Response.json(liveState(sessionID, existing))
    },
  })
  const liveState = (sessionID: string, state: PeerSession) => ({
    version: 1,
    sessionID,
    deleted: false,
    tenant: state.tenant,
    creatorID: state.creatorID,
    sourceID: state.sources[0]!.sourceID,
    sources: state.sources,
    position: state.position,
    revision: state.revision,
    lastReceipt: state.lastReceipt,
  })
  return {
    sessions,
    blobs,
    bodies,
    control,
    putEntities,
    url: server.url.origin,
    close: () => server.stop(true),
  }
}

const MessageData = Schema.Struct({
  content: Schema.optional(Schema.Array(Schema.Struct({ text: Schema.optional(Schema.String) }))),
  time: Schema.optional(Schema.Struct({ completed: Schema.optional(Schema.Number) })),
  outcome: Schema.optional(Schema.String),
})

const sessionEntity = (input: {
  id: string
  title: string
  created: number
  updated: number
  model?: Schema.Json
  agent?: string
}) => ({
  id: input.id,
  title: input.title,
  metadata: {},
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: input.created, updated: input.updated },
  origin: { directory: "", client: "mobile" },
  ...(input.model === undefined ? {} : { model: input.model }),
  ...(input.agent === undefined ? {} : { agent: input.agent }),
})

const userMessage = (id: string, text: string, created: number) => ({
  id,
  type: "user" as const,
  text,
  files: [],
  agents: [],
  skills: [],
  time: { created },
})

const assistantMessage = (id: string, text: string, created: number, completed?: number) => ({
  id,
  type: "assistant" as const,
  agent: "build",
  model: { providerID: "kilo", id: "fixture-model", variant: "default" },
  content: [{ type: "text" as const, text }],
  time: { created, ...(completed === undefined ? {} : { completed }) },
})

const fixture = Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-sync-pull-")))),
    (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
  )
  const backend = yield* Effect.acquireRelease(Effect.sync(peer), (backend) => Effect.sync(() => backend.close()))
  yield* Effect.promise(() =>
    Promise.all(["workspace", "data", "cache", "config", "state", "tmp"].map((name) => mkdir(path.join(root, name), { recursive: true }))),
  )
  return { root, backend, directory: path.join(root, "workspace") }
})

const boot = (f: { root: string; backend: { url: string } }) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      AppNodeBuilder.build(LayerNode.group([SessionSync.node, Database.node, Bus.node, Credential.node, Global.node]), [
        Global.node.replace(
          Global.layerWith(
            Object.fromEntries(
              ["home", "data", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((name) => [
                name,
                path.join(f.root, name),
              ]),
            ),
          ),
        ),
        Database.node.replace(Database.configured({ path: path.join(f.root, "native.sqlite") })),
        SessionProjector.node.replace(SessionProjector.node.mapLayer(SessionSync.captureLayer)),
        SessionSync.node.replace(
          makeGlobalNode({
            service: KiloSessionSync.Service,
            layer: Layer.effect(
              KiloSessionSync.Service,
              SessionSync.make({ background: false, destination: f.backend.url, organizationID: null, flushTimeout: 5_000 }),
            ),
            deps: [Database.node, Bus.node, SessionProjector.node, Credential.node, Global.node],
          }),
        ),
      ]),
    )
    return {
      db: Context.get(context, Database.Service).db,
      sync: Context.get(context, KiloSessionSync.Service),
      credentials: Context.get(context, Credential.Service),
    }
  })

const signIn = (credentials: Credential.Interface, user = "alice") =>
  credentials.create({ integrationID: IntegrationID.make("kilo"), value: { type: "key", key: `fixture:${user}` } })

const allow = (db: Store.DB, directory: string, destination: string) =>
  Store.enable(db, {
    directory,
    destination,
    local: true,
    organizationID: null,
    tenant: { type: "user", id: "alice" },
    userID: "alice",
  })

it.live("pull imports a foreign session under the same id in sequence order and binds it to the cwd", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_import")
    const mobileSource = randomUUID()
    const state = {
      creatorID: "alice",
      tenant: { type: "user" as const, id: "alice" },
      position: 4,
      revision: 2,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: mobileSource, client: "mobile" as const, joinedAt: Date.now() }],
      deleted: false,
    }
    f.backend.sessions.set(sessionID, state)
    f.backend.putEntities(sessionID, [
      { op: "put", kind: "session", id: sessionID, value: sessionEntity({ id: sessionID, title: "quick chat", created: 100, updated: 200 }) },
      { op: "put", kind: "message", id: "msg_one", value: { seq: 1, message: userMessage("msg_one", "hello", 100) } },
      {
        op: "put",
        kind: "message",
        id: "msg_two",
        value: { seq: 2, message: assistantMessage("msg_two", "hi there", 110, 120) },
      },
      { op: "put", kind: "message", id: "msg_three", value: { seq: 3, message: userMessage("msg_three", "again", 130) } },
    ])
    state.position = 7
    state.revision = 3

    const result = yield* s.sync.pull({ directory: f.directory, sessionID })
    expect(result.outcome).toBe("imported")
    expect(result.sessionID).toBe(sessionID)

    const messages = yield* s.db
      .all<{ id: string; seq: number; type: string }>(
        sql`SELECT id,seq,type FROM session_message WHERE session_id=${sessionID} ORDER BY seq`,
      )
      .pipe(Effect.orDie)
    expect(messages.map((message) => message.id)).toEqual(["msg_one", "msg_two", "msg_three"])
    expect(messages.map((message) => message.seq)).toEqual([1, 2, 3])
    const session = yield* s.db
      .get<{ directory: string; project_id: string; title: string }>(
        sql`SELECT directory,project_id,title FROM session_v2 WHERE id=${sessionID}`,
      )
      .pipe(Effect.orDie)
    expect(session?.directory).toBe(f.directory)
    expect(session?.title).toBe("quick chat")
    const sync = yield* s.db.get<Store.SessionRow>(sql`SELECT * FROM _kilo_sync_session WHERE id=${sessionID}`).pipe(Effect.orDie)
    expect(sync?.acknowledged).toBe(7)
    expect(sync?.position).toBe(7)
  }),
)

it.live("pull seeds the acknowledgement so imported rows are never uploaded back", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_no_reupload")
    f.backend.sessions.set(sessionID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 3,
      revision: 1,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
      deleted: false,
    })
    f.backend.putEntities(sessionID, [
      { op: "put", kind: "session", id: sessionID, value: sessionEntity({ id: sessionID, title: "mobile", created: 10, updated: 20 }) },
      { op: "put", kind: "message", id: "msg_a", value: { seq: 1, message: userMessage("msg_a", "hi", 10) } },
      { op: "put", kind: "message", id: "msg_b", value: { seq: 2, message: assistantMessage("msg_b", "hello", 11, 12) } },
    ])
    yield* s.sync.pull({ directory: f.directory, sessionID })
    expect(yield* Store.dirty(s.db, sessionID)).toEqual([])
    expect(yield* Store.foreign(s.db, sessionID)).toEqual(
      expect.arrayContaining([
        { kind: "message", id: "msg_a" },
        { kind: "message", id: "msg_b" },
      ]),
    )

    // A later native touch of an imported foreign row (here a message content update and a reconcile pass)
    // must not turn it into a CLI upload.
    yield* s.db
      .run(sql`UPDATE session_message SET time_updated=time_updated WHERE session_id=${sessionID} AND id='msg_b'`)
      .pipe(Effect.orDie)
    yield* Store.reconcile(s.db, f.directory)
    expect((yield* Store.dirty(s.db, sessionID)).filter((row) => row.kind !== "session")).toEqual([])
    expect(f.backend.bodies).toEqual([])
    const flushed = yield* s.sync.flush({ directory: f.directory })
    expect({ pending: flushed.pending, code: flushed.error?.code }).toEqual({ pending: 0, code: undefined })
    expect(f.backend.bodies).toEqual([])

    // The side's own new message is authored here and uploads normally.
    yield* s.db
      .run(
        sql`INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data)
          VALUES('msg_own',${sessionID},'user',3,30,30,${JSON.stringify(userMessage("msg_own", "local", 30))})`,
      )
      .pipe(Effect.orDie)
    const own = yield* Store.dirty(s.db, sessionID)
    expect(own.map((row) => row.id)).toContain("msg_own")
    expect((yield* s.sync.flush({ directory: f.directory })).pending).toBe(0)
    expect(f.backend.bodies.length).toBe(1)
    const packet = JSON.parse(f.backend.bodies[0]!) as { changes: { kind: string; id: string }[] }
    expect(packet.changes.map((change) => change.id)).not.toContain("msg_a")
    expect(packet.changes.map((change) => change.id)).toContain("msg_own")
  }),
)

it.live("a position conflict fast-forwards when local messages are newer than the pulled log", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_fast_forward")
    yield* s.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(f.directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    f.backend.sessions.set(sessionID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 1,
      revision: 1,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "cli", joinedAt: Date.now() }],
      deleted: false,
    })
    f.backend.putEntities(sessionID, [
      { op: "put", kind: "session", id: sessionID, value: sessionEntity({ id: sessionID, title: "cli", created: 10, updated: 20 }) },
      { op: "put", kind: "message", id: "msg_cloud", value: { seq: 1, message: userMessage("msg_cloud", "cloud", 10) } },
    ])
    // Local history acknowledges nothing and holds a message with a higher envelope sequence.
    yield* s.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        directory: AbsolutePath.make(f.directory),
        slug: "fixture",
        version: "test",
        title: "cli",
        time_created: 10,
        time_updated: 20,
      })
      .run()
      .pipe(Effect.orDie)
    yield* s.db
      .run(sql`UPDATE _kilo_sync_session SET acknowledged=0,bootstrap_complete=1 WHERE id=${sessionID}`)
      .pipe(Effect.orDie)
    yield* s.db
      .run(
        sql`INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data)
          VALUES('msg_local',${sessionID},'user',9,30,30,${JSON.stringify(userMessage("msg_local", "local", 30))})`,
      )
      .pipe(Effect.orDie)

    const flushed = yield* s.sync.flush({ directory: f.directory })
    expect({ pending: flushed.pending, code: flushed.error?.code }).toEqual({ pending: 0, code: undefined })
    const remote = f.backend.sessions.get(sessionID)!
    expect(remote.entities.has(`message/msg_cloud`)).toBe(true)
    expect(remote.entities.has(`message/msg_local`)).toBe(true)
    expect(remote.entities.has(`session/${sessionID}`)).toBe(true)
    const syncRow = yield* s.db.get<Store.SessionRow>(sql`SELECT * FROM _kilo_sync_session WHERE id=${sessionID}`).pipe(Effect.orDie)
    expect(syncRow?.error_code).toBeNull()
    expect(f.backend.bodies.length).toBe(1)
  }),
)

it.live("a position conflict with overlapping message sequences parks the session as diverged", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_diverged")
    yield* s.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(f.directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    f.backend.sessions.set(sessionID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 1,
      revision: 1,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "cli", joinedAt: Date.now() }],
      deleted: false,
    })
    f.backend.putEntities(sessionID, [
      { op: "put", kind: "session", id: sessionID, value: sessionEntity({ id: sessionID, title: "cli", created: 10, updated: 20 }) },
      { op: "put", kind: "message", id: "msg_cloud", value: { seq: 5, message: userMessage("msg_cloud", "cloud", 10) } },
    ])
    yield* s.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        directory: AbsolutePath.make(f.directory),
        slug: "fixture",
        version: "test",
        title: "cli",
        time_created: 10,
        time_updated: 20,
      })
      .run()
      .pipe(Effect.orDie)
    yield* s.db
      .run(
        sql`UPDATE _kilo_sync_session SET position=1,acknowledged=0,bootstrap_complete=1 WHERE id=${sessionID}`,
      )
      .pipe(Effect.orDie)
    yield* s.db
      .run(sql`UPDATE _kilo_sync_session SET acknowledged=0,bootstrap_complete=1 WHERE id=${sessionID}`)
      .pipe(Effect.orDie)
    yield* s.db
      .run(
        sql`INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data)
          VALUES('msg_local',${sessionID},'user',3,30,30,${JSON.stringify(userMessage("msg_local", "local", 30))})`,
      )
      .pipe(Effect.orDie)

    const result = yield* s.sync.flush({ directory: f.directory })
    expect(result.pending).toBeGreaterThan(0)
    expect(result.error?.code).toBe("diverged")
    expect(result.error?.message).toContain(`kilo2 sync pull ${sessionID} --replace-local`)
    const syncRow = yield* s.db.get<Store.SessionRow>(sql`SELECT * FROM _kilo_sync_session WHERE id=${sessionID}`).pipe(Effect.orDie)
    expect(syncRow?.error_code).toBe("diverged")
    const pull = yield* s.sync.pull({ directory: f.directory, sessionID, replaceLocal: true })
    expect(pull.outcome).toBe("updated")
    const remaining = yield* Store.dirty(s.db, sessionID)
    expect(remaining.filter((row) => row.id === "msg_local")).toEqual([])
    const kept = yield* s.db
      .all<{ id: string }>(sql`SELECT id FROM session_message WHERE session_id=${sessionID} ORDER BY seq`)
      .pipe(Effect.orDie)
    expect(kept.map((message) => message.id)).toEqual(["msg_cloud"])
  }),
)

it.live("sync delete validates the tombstone and maps each failure state to a clear message", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const live = Session.ID.make("ses_delete_live")
    f.backend.sessions.set(live, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 0,
      revision: 0,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
      deleted: false,
    })
    const deleted = yield* s.sync.deleteSession({ directory: f.directory, sessionID: live })
    expect(deleted.deleted).toBe(true)
    expect(deleted.message).toContain("deleted everywhere")
    expect(f.backend.sessions.get(live)?.deleted).toBe(true)

    // Already gone in the cloud: a second delete is a success, not a failure.
    const again = yield* s.sync.deleteSession({ directory: f.directory, sessionID: live })
    expect(again.deleted).toBe(true)

    const missing = yield* s.sync
      .deleteSession({ directory: f.directory, sessionID: Session.ID.make("ses_delete_absent") })
      .pipe(Effect.result)
    expect(missing).toMatchObject({
      _tag: "Failure",
      failure: { code: "session_not_found", message: expect.stringContaining("no synced copy") },
    })

    for (const [mode, code, text] of [
      ["forbidden", "creator_mismatch", "belongs to another account"],
      ["retryable", "service_overloaded", "cannot delete this session right now"],
      ["invalid", "invalid_response", "did not confirm the session tombstone"],
    ] as const) {
      const sessionID = Session.ID.make(`ses_delete_${mode}`)
      f.backend.sessions.set(sessionID, {
        creatorID: "alice",
        tenant: { type: "user", id: "alice" },
        position: 0,
        revision: 0,
        lastReceipt: null,
        entities: new Map<string, Schema.Json>(),
        sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
        deleted: false,
      })
      f.backend.control.deleteMode = mode
      const result = yield* s.sync.deleteSession({ directory: f.directory, sessionID }).pipe(Effect.result)
      if (result._tag === "Success") return yield* Effect.die("delete unexpectedly succeeded")
      expect(result.failure).toMatchObject({ code, message: expect.stringContaining(text) })
      f.backend.control.deleteMode = "ok"
    }
  }),
)

it.live("--replace-local keeps the local row identity, parent and fork linkage", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const parentID = Session.ID.make("ses_replace_parent")
    const childID = Session.ID.make("ses_replace_child")
    yield* s.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(f.directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    for (const id of [parentID, childID])
      yield* s.db
        .insert(SessionTable)
        .values({
          id,
          project_id: Project.ID.global,
          directory: AbsolutePath.make(f.directory),
          slug: `fixture-${id}`,
          version: "test",
          title: "local",
          time_created: 10,
          time_updated: 20,
        })
        .run()
        .pipe(Effect.orDie)
    // Fork ancestry is raw SQL: the boundary brand is not constructible from a plain literal here.
    yield* s.db
      .run(
        sql`UPDATE session_v2 SET parent_id=${parentID},fork_session_id=${parentID},
          fork_boundary=${JSON.stringify({ messageID: "msg_parent", seq: 1 })} WHERE id=${childID}`,
      )
      .pipe(Effect.orDie)
    yield* s.db
      .run(
        sql`INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data)
          VALUES('msg_stale',${childID},'user',1,10,10,${JSON.stringify(userMessage("msg_stale", "stale", 10))})`,
      )
      .pipe(Effect.orDie)
    yield* s.db
      .run(sql`UPDATE _kilo_sync_session SET acknowledged=0,bootstrap_complete=1 WHERE id=${childID}`)
      .pipe(Effect.orDie)
    f.backend.sessions.set(childID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 2,
      revision: 1,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
      deleted: false,
    })
    f.backend.putEntities(childID, [
      { op: "put", kind: "session", id: childID, value: sessionEntity({ id: childID, title: "cloud", created: 10, updated: 40 }) },
      { op: "put", kind: "message", id: "msg_cloud", value: { seq: 1, message: userMessage("msg_cloud", "cloud", 40) } },
    ])

    const pulled = yield* s.sync.pull({ directory: f.directory, sessionID: childID, replaceLocal: true })
    expect(pulled.outcome).toBe("updated")
    const row = yield* s.db
      .get<{ parent_id: string | null; fork_session_id: string | null; fork_boundary: unknown; title: string }>(
        sql`SELECT parent_id,fork_session_id,fork_boundary,title FROM session_v2 WHERE id=${childID}`,
      )
      .pipe(Effect.orDie)
    expect(row?.parent_id).toBe(parentID)
    expect(row?.fork_session_id).toBe(parentID)
    expect(row?.title).toBe("cloud")
    const messages = yield* s.db
      .all<{ id: string }>(sql`SELECT id FROM session_message WHERE session_id=${childID} ORDER BY seq`)
      .pipe(Effect.orDie)
    expect(messages.map((message) => message.id)).toEqual(["msg_cloud"])
  }),
)

it.live("a tombstoned session refuses a pull with the exact message and --as-new copies locally", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_tombstone")
    yield* s.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(f.directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* s.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        directory: AbsolutePath.make(f.directory),
        slug: "fixture",
        version: "test",
        title: "kept locally",
        time_created: 10,
        time_updated: 20,
      })
      .run()
      .pipe(Effect.orDie)
    yield* s.db
      .run(
        sql`INSERT INTO session_message(id,session_id,type,seq,time_created,time_updated,data)
          VALUES('msg_kept',${sessionID},'user',1,10,10,${JSON.stringify(userMessage("msg_kept", "kept", 10))})`,
      )
      .pipe(Effect.orDie)
    f.backend.sessions.set(sessionID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 1,
      revision: 1,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
      deleted: true,
    })

    const refused = yield* s.sync.pull({ directory: f.directory, sessionID }).pipe(Effect.result)
    expect(refused).toMatchObject({ _tag: "Failure", failure: { code: "session_deleted", message: deletedMessage } })

    const copied = yield* s.sync.pull({ directory: f.directory, sessionID, asNew: true })
    expect(copied.outcome).toBe("as-new")
    expect(copied.sessionID).not.toBe(sessionID)
    const copiedMessages = yield* s.db
      .all<{ id: string }>(sql`SELECT id FROM session_message WHERE session_id=${copied.sessionID}`)
      .pipe(Effect.orDie)
    expect(copiedMessages.length).toBe(1)
    const original = f.backend.sessions.get(sessionID)!
    expect(original.deleted).toBe(true)
    expect(f.backend.sessions.has(copied.sessionID)).toBe(true)
  }),
)

it.live("deleting locally then pulling restores the session from the synced copy with a message", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_restore")
    yield* s.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(f.directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    yield* s.db
      .insert(SessionTable)
      .values({
        id: sessionID,
        project_id: Project.ID.global,
        directory: AbsolutePath.make(f.directory),
        slug: "fixture",
        version: "test",
        title: "synced",
        time_created: 10,
        time_updated: 20,
      })
      .run()
      .pipe(Effect.orDie)
    f.backend.sessions.set(sessionID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 2,
      revision: 1,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "cli", joinedAt: Date.now() }],
      deleted: false,
    })
    f.backend.putEntities(sessionID, [
      { op: "put", kind: "session", id: sessionID, value: sessionEntity({ id: sessionID, title: "synced", created: 10, updated: 20 }) },
      { op: "put", kind: "message", id: "msg_synced", value: { seq: 1, message: userMessage("msg_synced", "synced", 10) } },
    ])
    // Local delete marks the identity deleted and freezes it; an explicit pull clears that.
    yield* s.db.run(sql`PRAGMA foreign_keys=OFF`).pipe(Effect.orDie)
    yield* s.db.run(sql`DELETE FROM session_message WHERE session_id=${sessionID}`).pipe(Effect.orDie)
    yield* s.db.run(sql`DELETE FROM session_v2 WHERE id=${sessionID}`).pipe(Effect.orDie)
    const frozen = yield* s.db.get<Store.SessionRow>(sql`SELECT * FROM _kilo_sync_session WHERE id=${sessionID}`).pipe(Effect.orDie)
    expect(frozen?.local_deleted).toBe(1)

    const pulled = yield* s.sync.pull({ directory: f.directory, sessionID })
    expect(pulled.outcome).toBe("restored")
    expect(pulled.message).toContain("restored from the synced copy")
    const stored = yield* s.db.get<{ id: string }>(sql`SELECT id FROM session_v2 WHERE id=${sessionID}`).pipe(Effect.orDie)
    expect(stored?.id).toBe(sessionID)
    const messages = yield* s.db
      .all<{ id: string }>(sql`SELECT id FROM session_message WHERE session_id=${sessionID} ORDER BY seq`)
      .pipe(Effect.orDie)
    expect(messages.map((message) => message.id)).toEqual(["msg_synced"])
  }),
)

it.live("pull folds message parts into inline content and normalizes a stale unfinished tail", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const sessionID = Session.ID.make("ses_pull_parts")
    f.backend.sessions.set(sessionID, {
      creatorID: "alice",
      tenant: { type: "user", id: "alice" },
      position: 9,
      revision: 4,
      lastReceipt: null,
      entities: new Map<string, Schema.Json>(),
      sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
      deleted: false,
    })
    f.backend.putEntities(sessionID, [
      { op: "put", kind: "session", id: sessionID, value: sessionEntity({ id: sessionID, title: "parts", created: 10, updated: 20 }) },
      { op: "put", kind: "message", id: "msg_u", value: { seq: 1, message: userMessage("msg_u", "ask", 10) } },
      {
        op: "put",
        kind: "message",
        id: "msg_a",
        value: {
          seq: 2,
          message: (({ content: _content, ...rest }) => rest)(assistantMessage("msg_a", "", 11)),
          parts: { count: 2, through: 6 },
        },
      },
      {
        op: "put",
        kind: "message-part",
        id: "msg_a/0",
        value: { messageID: "msg_a", ordinal: 0, position: 5, part: { type: "text", text: "streamed" } },
      },
      {
        op: "put",
        kind: "message-part",
        id: "msg_a/1",
        value: { messageID: "msg_a", ordinal: 1, position: 6, part: { type: "text", text: " more" } },
      },
    ])
    const pulled = yield* s.sync.pull({ directory: f.directory, sessionID })
    expect(pulled.outcome).toBe("imported")
    const assistant = yield* s.db
      .get<{ data: unknown }>(
        sql`SELECT data FROM session_message WHERE session_id=${sessionID} AND id='msg_a'`,
      )
      .pipe(Effect.orDie)
    const assistantData = MessageData.make(
      Schema.decodeUnknownSync(MessageData)(typeof assistant?.data === "string" ? JSON.parse(assistant.data) : assistant?.data),
    )
    expect(assistantData.content?.map((part) => part.text)).toEqual(["streamed", " more"])
    const [syncRow, rows] = yield* Effect.all([
      s.db.get<Store.SessionRow>(sql`SELECT * FROM _kilo_sync_session WHERE id=${sessionID}`).pipe(Effect.orDie),
      s.db
        .all<{ id: string; type: string }>(sql`SELECT id,seq,type FROM session_message WHERE session_id=${sessionID} ORDER BY seq`)
        .pipe(Effect.orDie),
    ])
    expect(syncRow?.acknowledged).toBe(9)
    if (syncRow?.error_code) expect(syncRow.error_code).not.toBe("identity_conflict")
    expect(rows.map((row) => row.type)).toEqual(["user", "assistant", "idle"])
    const idle = yield* s.db
      .get<{ data: unknown }>(sql`SELECT data FROM session_message WHERE session_id=${sessionID} AND type='idle'`)
      .pipe(Effect.orDie)
    const idleData = Schema.decodeUnknownSync(MessageData)(
      typeof idle?.data === "string" ? JSON.parse(idle.data) : idle?.data,
    )
    expect(idleData.outcome).toBe("interrupted")
    const completed = yield* s.db
      .get<{ data: unknown }>(sql`SELECT data FROM session_message WHERE session_id=${sessionID} AND id='msg_a'`)
      .pipe(Effect.orDie)
    const completedData = Schema.decodeUnknownSync(MessageData)(
      typeof completed?.data === "string" ? JSON.parse(completed.data) : completed?.data,
    )
    expect(completedData.time?.completed).toBe(11)
    expect(yield* Store.foreign(s.db, sessionID)).toEqual(
      expect.arrayContaining([
        { kind: "message-part", id: "msg_a/0" },
        { kind: "message-part", id: "msg_a/1" },
      ]),
    )
  }),
)

it.live("pull drops an unknown model and agent and keeps a resolvable one", () =>
  Effect.gen(function* () {
    const f = yield* fixture
    const s = yield* boot(f)
    yield* signIn(s.credentials)
    yield* allow(s.db, f.directory, f.backend.url)
    const unknownID = Session.ID.make("ses_pull_unknown_model")
    const providerOnlyID = Session.ID.make("ses_pull_provider_only_model")
    const knownID = Session.ID.make("ses_pull_known_model")
    yield* s.db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make(f.directory), sandboxes: [] })
      .onConflictDoNothing()
      .run()
    for (const [sessionID, model, agent] of [
      [unknownID, { providerID: "kilo-mobile-local", id: "on-device", variant: "default" }, "mobile-agent"],
      [providerOnlyID, { providerID: "kilo", id: "mobile-only-model", variant: "default" }, "build"],
      [knownID, { providerID: "kilo", id: "fixture-model", variant: "default" }, "build"],
    ] as const) {
      f.backend.sessions.set(sessionID, {
        creatorID: "alice",
        tenant: { type: "user", id: "alice" },
        position: 1,
        revision: 1,
        lastReceipt: null,
        entities: new Map<string, Schema.Json>(),
        sources: [{ sourceID: randomUUID(), client: "mobile", joinedAt: Date.now() }],
        deleted: false,
      })
      f.backend.putEntities(sessionID, [
        {
          op: "put",
          kind: "session",
          id: sessionID,
          value: sessionEntity({ id: sessionID, title: String(sessionID), created: 10, updated: 20, model, agent }),
        },
      ])
      yield* s.sync.pull({ directory: f.directory, sessionID, models: [{ providerID: "kilo", id: "fixture-model" }] })
    }
    const unknown = yield* s.db
      .get<{ model: unknown; agent: string | null }>(
        sql`SELECT model,agent FROM session_v2 WHERE id=${unknownID}`,
      )
      .pipe(Effect.orDie)
    expect(unknown?.model).toBeNull()
    expect(unknown?.agent).toBeNull()
    const providerOnly = yield* s.db
      .get<{ model: unknown; agent: string | null }>(sql`SELECT model,agent FROM session_v2 WHERE id=${providerOnlyID}`)
      .pipe(Effect.orDie)
    expect(providerOnly?.model).toBeNull()
    expect(providerOnly?.agent).toBe("build")
    const known = yield* s.db
      .get<{ model: unknown; agent: string | null }>(sql`SELECT model,agent FROM session_v2 WHERE id=${knownID}`)
      .pipe(Effect.orDie)
    const knownModel = Schema.decodeUnknownSync(
      Schema.Struct({ providerID: Schema.String, id: Schema.String }),
    )(typeof known?.model === "string" ? JSON.parse(known.model) : known?.model)
    expect(knownModel).toMatchObject({ providerID: "kilo", id: "fixture-model" })
    expect(known?.agent).toBe("build")
  }),
)
