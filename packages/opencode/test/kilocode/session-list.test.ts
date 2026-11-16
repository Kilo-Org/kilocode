import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
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
import fs from "fs/promises"
import { spyOn } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"
import { InstanceRef } from "../../src/effect/instance-ref"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })
const layer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node]))
const it = testEffect(layer)

describe("Kilo Session.list", () => {
  it.instance("includes directory matches from legacy project ids", () =>
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

  it.instance("matches legacy project ids through active sandboxes", () =>
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

  it.instance("resolves each distinct directory once and keeps limit, order and cursor", () =>
    Effect.gen(function* () {
      yield* seedProject
      const ctx = yield* InstanceRef
      if (!ctx) return yield* Effect.die(new Error("missing test instance"))
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const base = yield* sessions.create({ title: "base" })
      const [row] = yield* db.select().from(SessionTable).where(eq(SessionTable.id, base.id)).all()
      const outside = path.join(path.dirname(ctx.directory), `${path.basename(ctx.directory)}-outside`)
      const dirs = [ctx.directory, path.join(ctx.directory, "a"), path.join(ctx.directory, "b"), outside]
      yield* Effect.promise(() => Promise.all(dirs.slice(1).map((dir) => fs.mkdir(dir, { recursive: true }))))
      const total = 80
      const now = Date.now()
      yield* db.delete(SessionTable).where(eq(SessionTable.id, base.id))
      yield* db.insert(SessionTable).values(
        Array.from({ length: total }, (_, i) => ({
          ...row,
          id: `ses_${String(i).padStart(4, "0")}` as typeof row.id,
          directory: dirs[i % dirs.length] as typeof row.directory,
          path: null,
          time_created: now,
          time_updated: now - Math.floor(i / 2), // ties exercise the id tiebreak
          time_archived: null,
          parent_id: null,
        })),
      )
      // Sessions in the root, a and b match; sessions in the outside dir do not.
      const expected = Array.from({ length: total }, (_, i) => i)
        .filter((i) => i % dirs.length !== 3)
        .sort((a, b) => Math.floor(a / 2) - Math.floor(b / 2) || (a < b ? 1 : -1))
        .map((i) => `ses_${String(i).padStart(4, "0")}`)

      const resolve = spyOn(Filesystem, "resolve")
      const run = (input: { limit: number; cursor?: number }) =>
        Session.listGlobal({
          projectID: ctx.project.id,
          directories: [ctx.directory],
          roots: true,
          ...input,
        })
      const first = yield* run({ limit: 21 })
      const calls = resolve.mock.calls.length
      resolve.mockRestore()

      expect(first.map((item) => String(item.id))).toEqual(expected.slice(0, 21))
      // Cost is bounded by distinct directories, not by session count.
      expect(calls).toBeLessThanOrEqual(dirs.length * 3 + 4)

      const cursor = first[first.length - 1]!.time.updated
      const next = yield* run({ limit: 21, cursor })
      const rest = expected.filter((id) => !first.some((item) => item.id === id))
      const after = expected.filter((id) => {
        const n = Number(id.slice(4))
        return now - Math.floor(n / 2) < cursor
      })
      expect(next.map((item) => String(item.id))).toEqual(after.slice(0, 21))
      expect(rest.length).toBeGreaterThan(0)
    }),
  )
})
