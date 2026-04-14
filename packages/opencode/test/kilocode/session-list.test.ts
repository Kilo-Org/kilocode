import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("Kilo Session.list", () => {
  test("includes directory matches from legacy project ids", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "legacy-session" })
        const project = ProjectID.make("legacy-project")
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: project,
              worktree: tmp.path,
              vcs: "git",
              time_created: Date.now(),
              time_updated: Date.now(),
              sandboxes: [],
            })
            .run()
          db.update(SessionTable).set({ project_id: project }).where(eq(SessionTable.id, session.id)).run()
        })

        const sessions = [...Session.list({ directory: tmp.path })]
        const ids = sessions.map((item) => item.id)

        expect(ids).toContain(session.id)
      },
    })
  })
})
