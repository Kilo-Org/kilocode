import { afterEach, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { sql } from "drizzle-orm"
import { BoardStore } from "@/kilocode/board/store"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { BackgroundJob } from "@/background/job"
import { getWorkspaceRouteSessionID, isLocalWorkspaceRoute } from "@/server/shared/workspace-routing"
import { disposeAllInstances, provideInstance, TestInstance, tmpdirScoped } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { httpApiLayer, requestInDirectory } from "../../server/httpapi-layer"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Session.node, Database.node, BackgroundJob.node, SessionStatus.node])),
    httpApiLayer,
  ).pipe(
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          KILO_SERVER_PASSWORD: "",
          KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: "true",
        }),
      ),
    ),
  ),
)

const config = { experimental: { shared_agent_board: true }, formatter: false as const, lsp: false as const }
const decode = Schema.decodeUnknownSync(BoardStore.SessionBoard)

afterEach(async () => {
  await disposeAllInstances()
})

describe("shared board HTTP routes", () => {
  test("routes only the declared board paths through their owning session", () => {
    for (const suffix of ["board", "board/reset", "drain"]) {
      const path = `/kilocode/session/ses_owner/${suffix}`
      expect(String(getWorkspaceRouteSessionID(new URL(path, "http://localhost")))).toBe("ses_owner")
      expect(isLocalWorkspaceRoute("GET", path)).toBe(false)
    }
    expect(getWorkspaceRouteSessionID(new URL("http://localhost/kilocode/session/ses_owner/board/other"))).toBeNull()
  })

  it.instance(
    "observes an unused board without changing storage or conversations",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const sessions = yield* Session.Service
        const { db } = yield* Database.Service
        const root = yield* sessions.create({ title: "Unused board" })
        const child = yield* sessions.create({ parentID: root.id, title: "Unused child" })
        const response = yield* requestInDirectory(`/kilocode/session/${child.id}/board?limit=1`, instance.directory)
        const body = yield* response.json
        expect(response.status, JSON.stringify(body)).toBe(200)
        expect(body).toEqual({
          ownerSessionID: root.id,
          revision: 0,
          messages: [],
          hasMore: false,
        })
        expect(
          yield* db.get(sql`SELECT root_session_id FROM kilo_board WHERE root_session_id = ${root.id}`),
        ).toBeUndefined()
        expect(yield* sessions.messages({ sessionID: root.id })).toEqual([])
        expect(yield* sessions.messages({ sessionID: child.id })).toEqual([])
        const invalid = yield* requestInDirectory(`/kilocode/session/${root.id}/board?limit=51`, instance.directory)
        expect(invalid.status).toBe(400)
        const missing = yield* requestInDirectory("/kilocode/session/ses_missing_board/board", instance.directory)
        expect(missing.status).toBe(404)
      }),
    { git: true, config },
  )

  it.instance(
    "resets only the owning board and leaves live work and other directories intact",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const sessions = yield* Session.Service
        const jobs = yield* BackgroundJob.Service
        const status = yield* SessionStatus.Service
        const root = yield* sessions.create({ title: "Owner" })
        const child = yield* sessions.create({ parentID: root.id, title: "Active child" })
        const other = yield* tmpdirScoped({ git: true, config })
        const foreign = yield* provideInstance(other)(sessions.create({ title: "Other worktree" }))
        yield* BoardStore.post({
          sessionID: foreign.id,
          messageID: "msg_foreign_board",
          to: "ALL",
          type: "INFO",
          body: "Other board remains",
        })
        const first = yield* BoardStore.post({
          sessionID: child.id,
          messageID: "msg_board_first",
          to: "ALL",
          type: "INFO",
          body: "First",
        })
        yield* jobs.start({
          id: child.id,
          type: "task",
          metadata: { parentSessionId: root.id, sessionId: child.id },
          run: Effect.never,
        })
        yield* status.set(child.id, { type: "busy" })
        const path = `/kilocode/session/${root.id}/board`
        const response = yield* requestInDirectory(path, other)
        const body = yield* response.json
        expect(response.status, JSON.stringify(body)).toBe(200)
        const original = decode(body)
        expect(original.messages).toEqual([first])
        const next = yield* BoardStore.post({
          sessionID: child.id,
          messageID: "msg_board_next",
          to: "main",
          type: "RESULT",
          body: "Second",
        })
        const send = (id: string, revision: number) =>
          requestInDirectory(`/kilocode/session/${id}/board/reset`, instance.directory, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision }),
          })
        const stale = yield* send(root.id, original.revision)
        expect(stale.status).toBe(409)
        expect(yield* stale.json).toMatchObject({ _tag: "ConflictError" })
        const denied = yield* send(child.id, 2)
        expect(denied.status).toBe(400)
        const latest = yield* requestInDirectory(`${path}?limit=1`, instance.directory)
        const page = decode(yield* latest.json)
        expect(page.messages).toEqual([next])
        expect(page.hasMore).toBe(true)
        const older = yield* requestInDirectory(`${path}?before=${page.cursor}&limit=1`, instance.directory)
        expect(decode(yield* older.json).messages).toEqual([first])
        const cleared = yield* send(root.id, page.revision)
        expect(cleared.status).toBe(200)
        expect(decode(yield* cleared.json)).toEqual({
          ownerSessionID: root.id,
          revision: 2,
          messages: [],
          hasMore: false,
        })
        expect((yield* jobs.get(child.id))?.status).toBe("running")
        expect((yield* status.get(child.id)).type).toBe("busy")
        expect(yield* sessions.messages({ sessionID: root.id })).toEqual([])
        expect(yield* sessions.messages({ sessionID: child.id })).toEqual([])
        const untouched = yield* requestInDirectory(`/kilocode/session/${foreign.id}/board`, instance.directory)
        expect(decode(yield* untouched.json).messages.map((message) => message.body)).toEqual(["Other board remains"])
        yield* jobs.cancel(child.id)
        yield* status.set(child.id, { type: "idle" })
      }),
    { git: true, config },
  )
})
