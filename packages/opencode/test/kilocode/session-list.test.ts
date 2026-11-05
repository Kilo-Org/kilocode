import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect, spyOn } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { seedProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Session } from "../../src/session/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { Filesystem } from "@/util/filesystem"
import { InstanceRef } from "../../src/effect/instance-ref"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })
const layer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node]))
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

  it.instance("checks each session directory once when filtering by worktree", () =>
    Effect.gen(function* () {
      yield* seedProject
      const ctx = yield* InstanceRef
      if (!ctx) return yield* Effect.die(new Error("missing test instance"))
      const sessions = yield* Session.Service
      for (const title of ["a", "b", "c", "d"]) yield* sessions.create({ title })

      using resolve = spyOn(Filesystem, "resolve")
      const list = yield* Session.listGlobal({
        projectID: ctx.project.id,
        directories: [ctx.directory],
        currentDirectory: ctx.directory,
        limit: 2,
      })

      expect(list).toHaveLength(2)
      // Three calls set up the query. The fourth is the one directory the four sessions share.
      expect(resolve.mock.calls.filter(([dir]) => dir === ctx.directory)).toHaveLength(4)
    }),
  )

  it.instance("fills the limit past newer sessions outside the worktree family", () =>
    Effect.gen(function* () {
      yield* seedProject
      const ctx = yield* InstanceRef
      if (!ctx) return yield* Effect.die(new Error("missing test instance"))
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const inside = yield* sessions.create({ title: "inside" })
      const outside = yield* sessions.create({ title: "outside" })
      yield* db.update(SessionTable).set({ time_updated: 1 }).where(eq(SessionTable.id, inside.id))
      yield* db
        .update(SessionTable)
        .set({ time_updated: 2, directory: path.join(ctx.directory, "..", "elsewhere") })
        .where(eq(SessionTable.id, outside.id))

      const list = yield* Session.listGlobal({ projectID: ctx.project.id, directories: [ctx.directory], limit: 1 })

      expect(list.map((item) => item.id)).toEqual([inside.id])
    }),
  )
})
