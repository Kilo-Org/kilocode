import { afterAll, afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { EventSequenceTable, EventTable } from "@opencode-ai/core/event/sql"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ProjectV2 } from "@opencode-ai/core/project"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { SessionID } from "../../../src/session/schema"

const bodies = new Map<string, unknown>()
const ingest = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (request.method !== "GET" || url.pathname !== "/api/session/ses_cloud/export" || url.search) {
      return Response.json({ error: "Unexpected test request" }, { status: 503 })
    }
    const auth = request.headers.get("authorization")
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined
    if (!token || !bodies.has(token)) {
      return Response.json({ error: "Unexpected test token" }, { status: 503 })
    }
    const body = bodies.get(token)
    bodies.delete(token)
    return Response.json(body)
  },
})
afterAll(async () => {
  bodies.clear()
  await ingest.stop(true)
})

const [runtime, gateway, server, fixture] = await (async () => {
  const disabled = process.env.KILO_DISABLE_SESSION_INGEST
  const base = process.env.KILO_SESSION_INGEST_URL
  process.env.KILO_DISABLE_SESSION_INGEST = "1"
  process.env.KILO_SESSION_INGEST_URL = ingest.url.origin
  try {
    return await Promise.all([
      import("../../../src/effect/app-runtime"),
      import("../../../src/kilocode/server/httpapi/groups/kilo-gateway"),
      import("../../../src/server/routes/instance/httpapi/server"),
      import("../../fixture/fixture"),
    ])
  } finally {
    if (disabled === undefined) delete process.env.KILO_DISABLE_SESSION_INGEST
    else process.env.KILO_DISABLE_SESSION_INGEST = disabled
    if (base === undefined) delete process.env.KILO_SESSION_INGEST_URL
    else process.env.KILO_SESSION_INGEST_URL = base
  }
})()
const { AppRuntime } = runtime
const { KiloGatewayPaths } = gateway
const HttpApiApp = server
const { disposeAllInstances, tmpdir } = fixture

const created: string[] = []
const Imported = Schema.Struct({
  id: Schema.String,
  projectID: Schema.String,
  workspaceID: Schema.String,
  directory: Schema.String,
  path: Schema.String,
})

function data(diff = false) {
  return {
    info: {
      id: "ses_cloud",
      slug: "cloud-session",
      projectID: "proj_cloud",
      directory: "/cloud/workspace",
      title: "Cloud session",
      version: "7.4.11",
      time: { created: 10, updated: 20 },
    },
    messages: [
      {
        info: {
          id: "msg_cloud",
          sessionID: "ses_cloud",
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          time: { created: 11 },
        },
        parts: [
          {
            id: "prt_cloud",
            messageID: "msg_cloud",
            sessionID: "ses_cloud",
            type: "text",
            text: "hello",
          },
        ],
      },
    ],
    ...(diff ? { sessionDiff: [{ file: "restored.txt", after: "restored\n", status: "added" }] } : {}),
  }
}

async function request(directory: string, body: unknown) {
  const auth = process.env.KILO_AUTH_CONTENT
  const token = `test-${crypto.randomUUID()}`
  bodies.set(token, body)
  process.env.KILO_AUTH_CONTENT = JSON.stringify({ kilo: { type: "api", key: token } })
  try {
    return await HttpApiApp.webHandler().handler(
      new Request(`http://localhost${KiloGatewayPaths.cloudSessionImport}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-kilo-directory": directory },
        body: JSON.stringify({ sessionId: "ses_cloud" }),
      }),
      HttpApiApp.context,
    )
  } finally {
    bodies.delete(token)
    if (auth === undefined) delete process.env.KILO_AUTH_CONTENT
    else process.env.KILO_AUTH_CONTENT = auth
  }
}

async function routed<T>(id: string, run: () => Promise<T>) {
  const workspace = Flag.KILO_WORKSPACE_ID
  Flag.KILO_WORKSPACE_ID = id
  try {
    return await run()
  } finally {
    Flag.KILO_WORKSPACE_ID = workspace
  }
}

function counts() {
  return AppRuntime.runPromise(
    Database.Service.use(({ db }) =>
      Effect.all([
        db.select().from(SessionTable).all(),
        db.select().from(MessageTable).all(),
        db.select().from(PartTable).all(),
        db.select().from(EventTable).all(),
        db.select().from(EventSequenceTable).all(),
      ]).pipe(Effect.map((rows) => rows.map((items) => items.length))),
    ),
  )
}

afterEach(async () => {
  await AppRuntime.runPromise(
    Database.Service.use(({ db }) =>
      Effect.gen(function* () {
        yield* db.run("DROP TRIGGER IF EXISTS fail_cloud_import")
        for (const id of created.splice(0)) {
          yield* db.delete(EventTable).where(eq(EventTable.aggregate_id, id)).run()
          yield* db.delete(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, id)).run()
          yield* db
            .delete(SessionTable)
            .where(eq(SessionTable.id, SessionID.make(id)))
            .run()
        }
      }),
    ),
  )
  await disposeAllInstances()
})

describe("cloud session import", () => {
  test("rejects an invalid export before persistence", async () => {
    await using dir = await tmpdir({ git: true })
    const response = await request(dir.path, {
      info: { id: "ses_invalid", title: "Invalid", time: { created: 10, updated: 20 } },
      messages: [],
    })

    expect(response.status).toBe(400)
  })

  test("rejects a mixed malformed transcript before persistence or file restoration", async () => {
    await using dir = await tmpdir({ git: true })
    const restored = path.join(dir.path, "restored.txt")
    const before = await counts()
    const source = data(true)
    const msg = source.messages[0]!
    const response = await request(dir.path, {
      ...source,
      messages: [{ ...msg, parts: [...msg.parts, { type: "text", text: "discarded" }] }],
    })

    expect(response.status).toBe(400)
    expect(existsSync(restored)).toBe(false)
    expect(await counts()).toEqual(before)
  })

  test("commits the imported transcript and creation event atomically", async () => {
    await using dir = await tmpdir({ git: true })
    const nested = path.join(dir.path, "nested", "target")
    await mkdir(nested, { recursive: true })
    const response = await routed("wrk_local", () => request(nested, data()))
    expect(response.status).toBe(200)
    const imported = Schema.decodeUnknownSync(Imported)(await response.json())
    created.push(imported.id)
    expect(imported.id).not.toBe("ses_cloud")
    expect(imported.workspaceID).toBe("wrk_local")
    expect(imported.directory).toBe(nested)
    expect(imported.path).toBe("nested/target")

    const [session, messages, parts, events, sequence] = await AppRuntime.runPromise(
      Database.Service.use(({ db }) =>
        Effect.all([
          db
            .select()
            .from(SessionTable)
            .where(eq(SessionTable.id, SessionID.make(imported.id)))
            .get(),
          db
            .select()
            .from(MessageTable)
            .where(eq(MessageTable.session_id, SessionID.make(imported.id)))
            .all(),
          db
            .select()
            .from(PartTable)
            .where(eq(PartTable.session_id, SessionID.make(imported.id)))
            .all(),
          db.select().from(EventTable).where(eq(EventTable.aggregate_id, imported.id)).all(),
          db.select().from(EventSequenceTable).where(eq(EventSequenceTable.aggregate_id, imported.id)).get(),
        ]),
      ),
    )

    expect(session).toMatchObject({
      project_id: ProjectV2.ID.make(imported.projectID),
      workspace_id: "wrk_local",
      directory: nested,
      path: "nested/target",
    })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ session_id: imported.id, data: { role: "user" } })
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      message_id: messages[0]?.id,
      session_id: imported.id,
      data: { type: "text" },
    })
    expect(events.map((event) => ({ seq: event.seq, type: event.type }))).toEqual([
      { seq: 0, type: "session.created.1" },
    ])
    expect(sequence?.seq).toBe(0)
  })

  test("rolls back persistence before restoring files", async () => {
    await using dir = await tmpdir({ git: true })
    const restored = path.join(dir.path, "restored.txt")
    const before = await counts()
    await AppRuntime.runPromise(
      Database.Service.use(({ db }) =>
        db.run(
          'CREATE TRIGGER fail_cloud_import BEFORE INSERT ON message BEGIN SELECT RAISE(ABORT, "failed import"); END',
        ),
      ),
    )

    const response = await request(dir.path, data(true))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Internal error" })
    expect(existsSync(restored)).toBe(false)
    expect(await counts()).toEqual(before)
  })
})
