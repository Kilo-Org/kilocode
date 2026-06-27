import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { provideTestInstance } from "../fixture/fixture"
import { ProjectTable } from "../../src/project/project.sql"
import { ProjectID } from "../../src/project/schema"
import { Session } from "../../src/session/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import * as Log from "@opencode-ai/core/util/log"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
})

describe("Kilo Session.list", () => {
  test("includes directory matches from legacy project ids", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await Effect.runPromise(
          Session.Service.use((svc) => svc.create({ title: "legacy-session" })).pipe(
            Effect.provide(Session.defaultLayer),
          ),
        )
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

        const sessions = await Effect.runPromise(
          Session.Service.use((svc) => svc.list({ directory: tmp.path })).pipe(Effect.provide(Session.defaultLayer)),
        )
        const ids = sessions.map((item) => item.id)

        expect(ids).toContain(session.id)
      },
    })
  })

  test("matches legacy project ids through active sandboxes", async () => {
    await using tmp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: tmp.path,
      fn: async (ctx) => {
        const session = await Effect.runPromise(
          Session.Service.use((svc) => svc.create({ title: "sandbox-session" })).pipe(
            Effect.provide(Session.defaultLayer),
          ),
        )
        const project = ProjectID.make(`sandbox-project-${Date.now()}`)
        Database.use((db) => {
          db.insert(ProjectTable)
            .values({
              id: project,
              worktree: path.join(tmp.path, "removed-worktree"),
              vcs: "git",
              time_created: Date.now(),
              time_updated: Date.now(),
              sandboxes: [tmp.path],
            })
            .run()
          db.update(SessionTable).set({ project_id: project }).where(eq(SessionTable.id, session.id)).run()
        })

        const ids = [...Session.listGlobal({ projectID: ctx.project.id, directories: [tmp.path], roots: true })].map(
          (item) => item.id,
        )
        expect(ids).toContain(session.id)
      },
    })
  })
})
