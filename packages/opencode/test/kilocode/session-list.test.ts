import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { seedProject, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { ProjectV2 } from "@opencode-ai/core/project"
import { Session, type GlobalInfo } from "../../src/session/session"
import { KiloSession } from "../../src/kilocode/session"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq, sql } from "drizzle-orm"
import fs from "fs/promises"
import { spyOn } from "bun:test"
import { Filesystem } from "../../src/util/filesystem"
import { InstanceRef } from "../../src/effect/instance-ref"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })
const layer = LayerNode.compile(
  LayerNode.group([Session.node, SessionProjector.node, Database.node, CrossSpawnSpawner.node]),
)
const it = testEffect(layer)

type Db = Database.Interface["db"]
type Row = typeof SessionTable.$inferSelect

const ids = (items: readonly { id: unknown }[]) => items.map((item) => String(item.id))
const sid = (i: number, width = 4) => `ses_${String(i).padStart(width, "0")}`

// Replaces the default session with `total` generated rows and returns the template row.
const seedRows = (
  db: Db,
  total: number,
  make: (i: number) => { directory: string; time_updated: number },
  width = 4,
  chunk = 3000,
) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const base = yield* sessions.create({ title: "base" })
    const [row] = yield* db.select().from(SessionTable).where(eq(SessionTable.id, base.id)).all()
    yield* db.delete(SessionTable).where(eq(SessionTable.id, base.id))
    const now = Date.now()
    for (let start = 0; start < total; start += chunk) {
      yield* db.insert(SessionTable).values(
        Array.from({ length: Math.min(chunk, total - start) }, (_, k): Row => {
          const i = start + k
          const item = make(i)
          return {
            ...row,
            id: sid(i, width) as Row["id"],
            directory: item.directory as Row["directory"],
            path: null,
            time_created: now,
            time_updated: item.time_updated,
            time_archived: null,
            parent_id: null,
          }
        }),
      )
    }
    return { row, now }
  })

const instance = Effect.gen(function* () {
  yield* seedProject
  const ctx = yield* InstanceRef
  if (!ctx) return yield* Effect.die(new Error("missing test instance"))
  const { db } = yield* Database.Service
  return { ctx, db }
})

type Captured = { sql: string; params: unknown[] }

// Runs `effect` with every select issued through `db.transaction` recorded as SQL text and params.
const captureQueries = <A, E, R>(db: Db, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const original = db.transaction.bind(db)
    const sql: Captured[] = []
    // Wraps a query builder chain so `.all()` records the statement it is about to run.
    const record = (builder: unknown): unknown => {
      if (typeof builder !== "object" || builder === null) return builder
      return new Proxy(builder, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver)
          if (typeof value !== "function") return value
          if (key === "all" && "toSQL" in target) {
            const query = (Reflect.get(target, "toSQL") as () => Captured).call(target)
            sql.push({ sql: query.sql, params: query.params })
          }
          return (...args: unknown[]) => record(Reflect.apply(value, target, args))
        },
      })
    }
    const spy = spyOn(db, "transaction").mockImplementation(((fn: Parameters<Db["transaction"]>[0], config?: never) =>
      original(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(target, key, receiver) {
                const value: unknown = Reflect.get(target, key, receiver)
                if ((key !== "select" && key !== "selectDistinct") || typeof value !== "function") return value
                return (...args: unknown[]) => record(Reflect.apply(value, target, args))
              },
            }),
          ),
        config,
      )) as Db["transaction"])
    const result = yield* effect.pipe(Effect.ensuring(Effect.sync(() => spy.mockRestore())))
    return { result, sql }
  })

const listIn = (ctx: { directory: string; project: { id: string } }, input: { limit: number; cursor?: number }) =>
  KiloSession.listGlobal<GlobalInfo>({
    fromRow: Session.fromRow,
    projectID: ctx.project.id,
    directories: [ctx.directory],
    roots: true,
    ...input,
  })

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
      const { ctx, db } = yield* instance
      const outside = yield* tmpdirScoped()
      const dirs = [ctx.directory, path.join(ctx.directory, "a"), path.join(ctx.directory, "b"), outside]
      yield* Effect.promise(() => Promise.all(dirs.slice(1).map((dir) => fs.mkdir(dir, { recursive: true }))))
      const total = 80
      const now = Date.now()
      // time_updated ties exercise the id tiebreak.
      yield* seedRows(db, total, (i) => ({ directory: dirs[i % dirs.length]!, time_updated: now - Math.floor(i / 2) }))
      // Sessions in the root, a and b match; sessions in the outside dir do not.
      const expected = Array.from({ length: total }, (_, i) => i)
        .filter((i) => i % dirs.length !== 3)
        .sort((a, b) => Math.floor(a / 2) - Math.floor(b / 2) || (a < b ? 1 : -1))
        .map((i) => sid(i))

      const resolve = spyOn(Filesystem, "resolve")
      const first = yield* listIn(ctx, { limit: 21 }).pipe(Effect.ensuring(Effect.sync(() => resolve.mockRestore())))
      const calls = resolve.mock.calls.length

      expect(ids(first)).toEqual(expected.slice(0, 21))
      // Cost is bounded by distinct directories, not by session count.
      expect(calls).toBeLessThanOrEqual(dirs.length * 3 + 4)

      const cursor = first.at(-1)!.time.updated
      const next = yield* listIn(ctx, { limit: 21, cursor })
      const after = expected.filter((id) => now - Math.floor(Number(id.slice(4)) / 2) < cursor)
      expect(ids(next)).toEqual(after.slice(0, 21))
      expect(after.length).toBeGreaterThan(0)
    }),
  )

  it.instance(
    "pages past thousands of distinct directories without a bind list",
    () =>
      Effect.gen(function* () {
        const { ctx, db } = yield* instance
        const total = 33000
        const now = Date.now()
        // Every session has its own directory inside the project, so the allowed set is
        // larger than SQLite can bind in one IN list.
        yield* seedRows(db, total, (i) => ({ directory: path.join(ctx.directory, `d${i}`), time_updated: now - i }), 6)
        const expected = Array.from({ length: total }, (_, i) => sid(i, 6))
        expect(ids(yield* listIn(ctx, { limit: 5 }))).toEqual(expected.slice(0, 5))
      }),
    60_000,
  )

  it.instance(
    "reads distinct directories then one limited ordered query, bounded by the page",
    () =>
      Effect.gen(function* () {
        const { ctx, db } = yield* instance
        const outside = yield* tmpdirScoped()
        const rejected = 2000
        const accepted = 1500
        const now = Date.now()
        // Newest rows belong to another worktree; the accepted rows, each in its own directory, are the oldest.
        yield* seedRows(db, rejected + accepted, (i) => ({
          directory: i < rejected ? outside : path.join(ctx.directory, `d${i}`),
          time_updated: now - i,
        }))
        const queries = yield* captureQueries(db, listIn(ctx, { limit: 3 }))

        expect(ids(queries.result)).toEqual([sid(rejected), sid(rejected + 1), sid(rejected + 2)])
        // One snapshot, two statements: the directory scan returns one row per directory
        // and the page query carries LIMIT, so rows read never scale with rejected sessions.
        expect(queries.sql.length).toBe(2)
        const [scan, page] = queries.sql
        expect(scan!.sql).toContain("distinct")
        expect(page!.sql).toContain("json_each")
        expect(page!.sql).toContain("limit")
        expect(page!.params.at(-1)).toBe(3)
        // The accepted directories travel as one JSON parameter, so the bind count does not
        // grow with them: the same fixed filters bind for a page over a handful of directories.
        expect(page!.params.filter((param) => typeof param === "string" && param.startsWith("[")).length).toBe(1)
        expect(page!.params.length).toBeLessThan(20)
      }),
    60_000,
  )

  it.instance("includes a session created in a previously unseen directory on the next read", () =>
    Effect.gen(function* () {
      yield* seedProject
      const ctx = yield* InstanceRef
      if (!ctx) return yield* Effect.die(new Error("missing test instance"))
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const base = yield* sessions.create({ title: "base" })
      const [row] = yield* db.select().from(SessionTable).where(eq(SessionTable.id, base.id)).all()
      const run = () =>
        Session.listGlobal({ projectID: ctx.project.id, directories: [ctx.directory], roots: true, limit: 1 })
      expect((yield* run()).map((item) => item.id)).toEqual([base.id])
      yield* db.insert(SessionTable).values({
        ...row,
        id: "ses_newer" as typeof row.id,
        directory: path.join(ctx.directory, "fresh") as typeof row.directory,
        time_updated: row.time_updated + 1,
      })
      expect((yield* run()).map((item) => String(item.id))).toEqual(["ses_newer"])
    }),
  )

  it.instance("binds stored directories unchanged, including mixed separators", () =>
    Effect.gen(function* () {
      const { ctx, db } = yield* instance
      const now = Date.now()
      yield* seedRows(db, 2, (i) => ({ directory: ctx.directory, time_updated: now - i }))
      // A legacy row that bypassed the column encoder. The win32 decoder turns it into
      // `<root>/legacy/x`, which would re-encode to different bytes than the stored text.
      const raw = `${ctx.directory}/legacy\\x`
      yield* db
        .update(SessionTable)
        .set({ directory: sql<string>`${raw}`, time_updated: now - 1 })
        .where(eq(SessionTable.id, sid(1) as Row["id"]))
      const decode = spyOn(SessionTable.directory, "mapFromDriverValue").mockImplementation((value) =>
        value.replaceAll("\\", "/"),
      )
      const queries = yield* captureQueries(db, listIn(ctx, { limit: 5 })).pipe(
        Effect.ensuring(Effect.sync(() => decode.mockRestore())),
      )
      expect(ids(queries.result)).toEqual([sid(0), sid(1)])
      const bound = queries.sql[1]!.params.flatMap((param) => (typeof param === "string" ? [param] : []))
      const lists = bound.flatMap((param): unknown[] => (param.startsWith("[") ? [JSON.parse(param)] : []))
      expect(lists).toEqual([expect.arrayContaining([ctx.directory, raw])])
    }),
  )

  it.instance("skips a directory that cannot be resolved instead of failing the page", () =>
    Effect.gen(function* () {
      const { ctx, db } = yield* instance
      const denied = path.join(ctx.directory, "denied")
      yield* Effect.promise(() => fs.mkdir(denied, { recursive: true }))
      const now = Date.now()
      // The inaccessible directory holds the newest session, so it would lead the page if accepted.
      yield* seedRows(db, 3, (i) => ({
        directory: i === 0 ? denied : path.join(ctx.directory, `d${i}`),
        time_updated: now - i,
      }))
      const original = Filesystem.resolve
      const resolve = spyOn(Filesystem, "resolve").mockImplementation((input) => {
        if (input === denied) throw Object.assign(new Error("denied"), { code: "EACCES" })
        return original(input)
      })
      const list = yield* listIn(ctx, { limit: 2 }).pipe(Effect.ensuring(Effect.sync(() => resolve.mockRestore())))
      expect(ids(list)).toEqual([sid(1), sid(2)])
    }),
  )
})
