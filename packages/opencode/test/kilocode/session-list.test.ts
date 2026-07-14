import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { seedProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Session } from "../../src/session/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { InstanceRef } from "../../src/effect/instance-ref"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })
const layer = Layer.mergeAll(Session.defaultLayer, Database.defaultLayer)
const it = testEffect(layer)

describe("Kilo Session.list", () => {
  it.instance(
    "includes directory matches from legacy project ids",
    () =>
      Effect.gen(function* () {
        yield* seedProject
        const ctx = yield* InstanceRef
        if (!ctx) return yield* Effect.die(new Error("missing test instance"))
        const sessions = yield* Session.Service
        const { db } = yield* Database.Service
        const session = yield* sessions.create({ title: "legacy-session" })
        const project = ProjectV2.ID.make("legacy-project")
        yield* db.insert(ProjectTable).values({
          id: project,
          worktree: AbsolutePath.make(ctx.directory),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [],
        })
        yield* db.update(SessionTable).set({ project_id: project }).where(eq(SessionTable.id, session.id))
        const list = yield* sessions.list({ directory: ctx.directory })
        expect(list.map((item) => item.id)).toContain(session.id)
      }),
  )

  it.instance(
    "matches legacy project ids through active sandboxes",
    () =>
      Effect.gen(function* () {
        yield* seedProject
        const ctx = yield* InstanceRef
        if (!ctx) return yield* Effect.die(new Error("missing test instance"))
        const sessions = yield* Session.Service
        const { db } = yield* Database.Service
        const session = yield* sessions.create({ title: "sandbox-session" })
        const project = ProjectV2.ID.make(`sandbox-project-${Date.now()}`)
        yield* db.insert(ProjectTable).values({
          id: project,
          worktree: AbsolutePath.make(path.join(ctx.directory, "removed-worktree")),
          vcs: "git",
          time_created: Date.now(),
          time_updated: Date.now(),
          sandboxes: [AbsolutePath.make(ctx.directory)],
        })
        yield* db.update(SessionTable).set({ project_id: project }).where(eq(SessionTable.id, session.id))
        const list = yield* Session.listGlobal({
          projectID: ctx.project.id,
          directories: [ctx.directory],
          roots: true,
        })
        expect(list.map((item) => item.id)).toContain(session.id)
      }),
  )
})
