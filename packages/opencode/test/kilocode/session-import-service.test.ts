import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { SessionImportService } from "../../src/devilcode/session-import/service"

// Use the real database (test preload configures an isolated tmpdir) instead of
// mock.module("@/storage/db") which pollutes the global module cache and breaks
// parallel test files.

const PROJECT_ID = "proj_test"
const SESSION_ID = "ses_migrated_test"

function input(force?: boolean) {
  return {
    id: SESSION_ID,
    projectID: PROJECT_ID,
    slug: "legacy-task",
    directory: "/workspace/testing",
    title: force ? "Reimported task" : "Legacy task",
    version: "v2",
    timeCreated: 1,
    timeUpdated: 1,
    ...(force ? { force: true } : {}),
  }
}

describe("SessionImportService.session", () => {
  beforeEach(() => {
    // Clean up any existing rows
    Database.use((db) => {
      db.delete(SessionTable).where(eq(SessionTable.id, SESSION_ID)).run()
      db.delete(ProjectTable).where(eq(ProjectTable.id, PROJECT_ID)).run()
    })
    // Create the project row that sessions reference via foreign key
    Database.use((db) => {
      db.insert(ProjectTable)
        .values({
          id: PROJECT_ID,
          worktree: "/workspace/testing",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoNothing()
        .run()
    })
  })

  afterEach(() => {
    Database.use((db) => {
      db.delete(SessionTable).where(eq(SessionTable.id, SESSION_ID)).run()
      db.delete(ProjectTable).where(eq(ProjectTable.id, PROJECT_ID)).run()
    })
  })

  test("returns skipped when the session already exists and force is false", async () => {
    // Pre-insert a session row
    Database.use((db) => {
      db.insert(SessionTable)
        .values({
          id: SESSION_ID,
          project_id: PROJECT_ID,
          slug: "legacy-task",
          directory: "/workspace/testing",
          title: "Legacy task",
          version: "v2",
          time_created: 1,
          time_updated: 1,
        })
        .run()
    })

    const result = await SessionImportService.session(input())

    expect(result).toEqual({ ok: true, id: SESSION_ID, skipped: true })
  })

  test("deletes and recreates the session when force is true", async () => {
    // Pre-insert a session row
    Database.use((db) => {
      db.insert(SessionTable)
        .values({
          id: SESSION_ID,
          project_id: PROJECT_ID,
          slug: "legacy-task",
          directory: "/workspace/testing",
          title: "Legacy task",
          version: "v2",
          time_created: 1,
          time_updated: 1,
        })
        .run()
    })

    const result = await SessionImportService.session(input(true))

    expect(result).toEqual({ ok: true, id: SESSION_ID })

    // Verify the session was recreated with the new title
    const row = Database.use((db) =>
      db.select().from(SessionTable).where(eq(SessionTable.id, SESSION_ID)).get(),
    )
    expect(row).toBeTruthy()
    expect(row!.title).toBe("Reimported task")
  })
})
