import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { SessionImportService } from "../../src/kilocode/session-import/service"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const projectID = ProjectV2.ID.make("proj_test")

const runtime = makeRuntime(Database.Service, Database.defaultLayer)
const db = <A, E>(effect: Effect.Effect<A, E, Database.Service>) => runtime.runPromise(() => effect)

async function prepare() {
  await db(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      yield* db.delete(SessionTable).where(eq(SessionTable.id, SessionID.make(input().id))).run()
      yield* db.delete(ProjectTable).where(eq(ProjectTable.id, projectID)).run()
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/workspace/testing"), sandboxes: [] })
        .run()
    }),
  )
}

function input(force?: boolean) {
  return {
    id: "ses_migrated_test",
    projectID: "proj_test",
    slug: "legacy-task",
    directory: "/workspace/testing",
    title: force ? "Reimported task" : "Legacy task",
    version: "v2",
    timeCreated: 1,
    timeUpdated: 1,
    ...(force ? { force: true } : {}),
  }
}

function project(worktree: string) {
  return {
    id: "legacy_project",
    worktree,
    timeCreated: 1,
    timeUpdated: 1,
    sandboxes: [],
  }
}

describe("SessionImportService.project", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("rejects an empty legacy worktree", async () => {
    await expect(SessionImportService.project(project("  "))).rejects.toThrow(
      "Legacy project import requires a non-empty worktree",
    )
  })

  test("resolves a valid legacy project through Project.Service", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await SessionImportService.project(project(tmp.path))

    expect(result.ok).toBe(true)
    expect(result.id).not.toBe("global")
  })
})

describe("SessionImportService.session", () => {
  beforeEach(prepare)
  afterEach(prepare)

  test("returns skipped when the session already exists and force is false", async () => {
    await SessionImportService.session(input())

    const result = await SessionImportService.session(input())

    expect(result).toEqual({ ok: true, id: "ses_migrated_test", skipped: true })
  })

  test("deletes and recreates the session when force is true", async () => {
    await SessionImportService.session(input())

    // The forced delete must cascade to dependent messages and parts, not just replace the session row.
    const sessionID = SessionID.make(input().id)
    const messageID = MessageID.make("msg_forced_cleanup")
    await db(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db
          .insert(MessageTable)
          .values({ id: messageID, session_id: sessionID, data: { role: "user" } as never })
          .run()
        yield* db
          .insert(PartTable)
          .values({
            id: PartID.make("prt_forced_cleanup"),
            message_id: messageID,
            session_id: sessionID,
            data: { type: "text", text: "seed" } as never,
          })
          .run()
      }),
    )

    const result = await SessionImportService.session(input(true))
    const [row, messages, parts] = await db(
      Database.Service.use(({ db }) =>
        Effect.all([
          db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
          db.select().from(MessageTable).where(eq(MessageTable.session_id, sessionID)).all(),
          db.select().from(PartTable).where(eq(PartTable.session_id, sessionID)).all(),
        ]),
      ),
    )

    expect(result).toEqual({ ok: true, id: "ses_migrated_test" })
    expect(row?.title).toBe("Reimported task")
    expect(messages).toEqual([])
    expect(parts).toEqual([])
  })
})
