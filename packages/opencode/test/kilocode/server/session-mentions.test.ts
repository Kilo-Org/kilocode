import { afterEach, describe, expect, spyOn } from "bun:test"
import path from "path"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Effect, Layer, Schema } from "effect"
import { eq, inArray } from "drizzle-orm"
import { Session } from "../../../src/session/session"
import { Filesystem } from "../../../src/util/filesystem"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, provideInstance, TestInstance, tmpdir } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"
import { httpApiLayer, requestInDirectory } from "../../server/httpapi-layer"
import { HttpClientResponse } from "effect/unstable/http"

const it = testEffect(Layer.mergeAll(LayerNode.compile(LayerNode.group([Session.node, Database.node])), httpApiLayer))

function request(directory: string) {
  const query = new URLSearchParams({
    directory,
    worktrees: "true",
    roots: "true",
    limit: String(5_000),
  })
  return requestInDirectory(`/experimental/session?${query}`, directory)
}

function json(response: HttpClientResponse.HttpClientResponse) {
  return Effect.gen(function* () {
    const body: unknown = yield* response.json
    if (!Schema.is(Schema.Array(Session.GlobalInfo))(body)) {
      return yield* Effect.fail(new Error("Invalid session metadata"))
    }
    return body
  })
}

function updated(ids: Array<Session.Info["id"]>, time: number) {
  return Database.Service.use(({ db }) =>
    db.update(SessionTable).set({ time_updated: time }).where(inArray(SessionTable.id, ids)).run().pipe(Effect.orDie),
  )
}

function repo() {
  return Effect.acquireRelease(
    Effect.promise(() => tmpdir({ git: true })),
    (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()).pipe(Effect.ignore),
  )
}

function deny(dir: string, code: "EACCES" | "EPERM") {
  const real = Filesystem.resolve
  const spy = spyOn(Filesystem, "resolve").mockImplementation((input) => {
    if (input === dir) throw Object.assign(new Error(`cannot resolve ${dir}`), { code })
    return real(input)
  })
  return Effect.addFinalizer(() => Effect.sync(() => spy.mockRestore()))
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe.serial("Kilo session mentions", () => {
  it.instance(
    "lists more than 50 root sessions without a cursor",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessions = yield* Effect.forEach(Array.from({ length: 51 }), (_, index) =>
          Session.use.create({ title: `session ${index}` }),
        )
        yield* updated(
          sessions.map((session) => session.id),
          1,
        )

        const response = yield* request(test.directory)
        expect(response.status).toBe(200)
        expect(response.headers["x-next-cursor"]).toBeUndefined()
        const body = yield* json(response)
        expect(new Set(body.map((item) => item.id))).toEqual(new Set(sessions.map((session) => session.id)))
      }),
    { git: true },
    30_000,
  )

  it.instance(
    "ignores an inaccessible worktree from an unrelated project",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const other = yield* repo()
        const current = yield* Session.use.create({ title: "current project" })
        const unrelated = yield* Session.use.create({ title: "unrelated project" }).pipe(provideInstance(other.path))
        const denied = path.join(other.path, "denied-worktree")
        const { db } = yield* Database.Service

        yield* db
          .update(ProjectTable)
          .set({ worktree: AbsolutePath.make(denied) })
          .where(eq(ProjectTable.id, unrelated.projectID))
          .run()
          .pipe(Effect.orDie)
        yield* deny(denied, "EPERM")

        const response = yield* request(test.directory)
        expect(response.status).toBe(200)
        const body = yield* json(response)
        const ids = body.map((item) => item.id)
        expect(ids).toContain(current.id)
        expect(ids).not.toContain(unrelated.id)
      }),
    { git: true },
  )

  it.instance(
    "ignores an inaccessible saved sandbox",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const other = yield* repo()
        const current = yield* Session.use.create({ title: "current project" })
        const unrelated = yield* Session.use.create({ title: "unrelated project" }).pipe(provideInstance(other.path))
        const denied = path.join(test.directory, "denied-sandbox")
        const { db } = yield* Database.Service

        yield* db
          .update(ProjectTable)
          .set({ sandboxes: [AbsolutePath.make(denied)] })
          .where(eq(ProjectTable.id, unrelated.projectID))
          .run()
          .pipe(Effect.orDie)
        yield* deny(denied, "EACCES")

        const response = yield* request(test.directory)
        expect(response.status).toBe(200)
        const body = yield* json(response)
        expect(body.map((item) => item.id)).toEqual([current.id])
      }),
    { git: true },
  )

  it.instance(
    "keeps a legacy root chat when a denied sandbox precedes a current-worktree alias",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const legacy = yield* repo()
        const other = yield* repo()
        const current = yield* Session.use.create({ title: "current project" })
        const root = yield* Session.use.create({ title: "legacy root" })
        const unrelated = yield* Session.use.create({ title: "unrelated project" }).pipe(provideInstance(other.path))
        const denied = path.join(legacy.path, "denied-sandbox")
        const project = ProjectV2.ID.make("legacy-mentions-project")
        const { db } = yield* Database.Service

        yield* db
          .insert(ProjectTable)
          .values({
            id: project,
            worktree: AbsolutePath.make(legacy.path),
            vcs: "git",
            time_created: Date.now(),
            time_updated: Date.now(),
            sandboxes: [AbsolutePath.make(denied), AbsolutePath.make(test.directory)],
          })
          .run()
          .pipe(Effect.orDie)
        yield* db
          .update(SessionTable)
          .set({ project_id: project })
          .where(eq(SessionTable.id, root.id))
          .run()
          .pipe(Effect.orDie)
        yield* deny(denied, "EPERM")

        const response = yield* request(test.directory)
        expect(response.status).toBe(200)
        const body = yield* json(response)
        const ids = body.map((item) => item.id)
        expect(ids).toContain(current.id)
        expect(ids).toContain(root.id)
        expect(ids).not.toContain(unrelated.id)
      }),
    { git: true },
  )
})
