import { describe, expect, it } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { eq, inArray } from "drizzle-orm"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { AppProcess } from "@opencode-ai/core/process"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { ProjectV2 } from "@opencode-ai/core/project"
import { ProjectTable } from "@opencode-ai/core/project/sql"
import { MessageTable, PartTable, SessionTable } from "@opencode-ai/core/session/sql"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Config } from "../../../src/config/config"
import { Session } from "../../../src/session/session"
import { SessionID, MessageID, PartID } from "../../../src/session/schema"
import { KiloSessionRetention } from "../../../src/kilocode/session/retention"
import { RetentionStatus } from "../../../src/kilocode/server/httpapi/groups/kilocode"
import { testInstanceStoreLayer } from "../../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([FSUtil.node, AppProcess.node, EffectFlock.node, Database.node, CrossSpawnSpawner.node]),
  ),
  testInstanceStoreLayer,
)
const dbIt = testEffect(env)
const runIt = testEffect(
  LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node, CrossSpawnSpawner.node])),
)
const enabled = Layer.mock(Config.Service, {
  get: () => Effect.succeed({ retention: { enabled: true, maxAgeDays: 30 } }),
})

const NOW = 1_700_000_000_000

it("retention HTTP status accepts idle and individual-session progress", () => {
  const decode = Schema.decodeUnknownSync(RetentionStatus)
  const policy = { enabled: true, maxAgeDays: 30 }
  expect(decode({ policy })).toEqual({ policy })
  const progress = { phase: "deleting" as const, total: 10, processed: 4, deleted: 3, failed: 1, skippedActive: 2 }
  expect(decode({ policy, progress })).toEqual({ policy, progress })
  const halting = { ...progress, phase: "cancelling" as const }
  expect(decode({ policy, progress: halting })).toEqual({ policy, progress: halting })
  expect(
    decode({
      policy,
      last: { at: 1, scanned: 2, deleted: 1, skippedActive: 0, failed: 0, durationMs: 3, reclaimedBytes: 4 },
    }),
  ).toEqual({
    policy,
    last: { at: 1, scanned: 2, deleted: 1, skippedActive: 0, failed: 0, durationMs: 3, reclaimedBytes: 4 },
  })
  expect(
    decode({
      policy,
      last: { at: 1, scanned: 2, deleted: 1, skippedActive: 0, failed: 0, durationMs: 3, cancelled: true },
    }),
  ).toEqual({
    policy,
    last: { at: 1, scanned: 2, deleted: 1, skippedActive: 0, failed: 0, durationMs: 3, cancelled: true },
  })
  expect(
    decode({ policy, last: { at: 1, scanned: 2, deleted: 1, skippedActive: 0, failed: 0, durationMs: 3 } }),
  ).toEqual({
    policy,
    last: { at: 1, scanned: 2, deleted: 1, skippedActive: 0, failed: 0, durationMs: 3 },
  })
  expect(() => decode({ policy, progress: { ...progress, deleted: -1 } })).toThrow()
})

function session(
  id: string,
  ageDays: number,
  overrides: Partial<KiloSessionRetention.Row> = {},
): KiloSessionRetention.Row {
  return {
    id,
    updated: NOW - ageDays * KiloSessionRetention.DAY_MS,
    ...overrides,
  }
}

describe("clampDays", () => {
  it("accepts whole days at or above one", () => {
    expect(KiloSessionRetention.clampDays(1, 30)).toBe(1)
    expect(KiloSessionRetention.clampDays(45, 30)).toBe(45)
  })

  it("rejects fractional and invalid input, falling back", () => {
    expect(KiloSessionRetention.clampDays(7.9, 30)).toBe(30)
    expect(KiloSessionRetention.clampDays(0, 30)).toBe(30)
    expect(KiloSessionRetention.clampDays(-5, 7)).toBe(7)
    expect(KiloSessionRetention.clampDays(Number.NaN, 30)).toBe(30)
    expect(KiloSessionRetention.clampDays("30", 30)).toBe(30)
    expect(KiloSessionRetention.clampDays(undefined, 7)).toBe(7)
  })
})

describe("expiredRoots", () => {
  const run = (rows: KiloSessionRetention.Row[], busy: string[] = []) =>
    KiloSessionRetention.expiredRoots(rows, { maxAgeDays: 30, busy: new Set(busy), now: NOW })

  it("expires regular sessions past the retention, keeps fresh ones", () => {
    const result = run([session("fresh", 5), session("old", 31)])
    expect(result.expired.has("old")).toBe(true)
    expect(result.expired.has("fresh")).toBe(false)
    expect(result.roots).toEqual(["old"])
    expect(result.skipped).toEqual([])
  })

  it("keeps sessions just inside the boundary, expires at it", () => {
    expect(run([session("inside", 29.9)]).expired.size).toBe(0)
    expect(run([session("edge", 30)]).expired.has("edge")).toBe(true)
  })

  it("protects an old parent while a fork is still fresh", () => {
    const result = run([session("parent", 40), session("child", 2, { parentID: "parent" })])
    expect(result.expired.has("parent")).toBe(false)
    expect(result.expired.has("child")).toBe(false)
  })

  it("expires a parent and fork once both age out, deleting only the root", () => {
    const result = run([session("parent", 40), session("child", 35, { parentID: "parent" })])
    expect(result.expired.has("parent")).toBe(true)
    expect(result.expired.has("child")).toBe(true)
    expect(result.roots).toEqual(["parent"])
  })

  it("protects a grandparent through a chain of fresh forks", () => {
    const result = run([
      session("grand", 60),
      session("parent", 40, { parentID: "grand" }),
      session("child", 1, { parentID: "parent" }),
    ])
    expect(result.expired.has("grand")).toBe(false)
    expect(result.expired.has("parent")).toBe(false)
  })

  it("protects an old parent whose descendant is busy", () => {
    const result = run([session("parent", 40), session("child", 35, { parentID: "parent" })], ["child"])
    expect(result.expired.has("parent")).toBe(false)
    expect(result.skipped).toEqual(["parent", "child"])
  })

  it("holds back a busy expired session instead of deleting it", () => {
    const result = run([session("busy", 40)], ["busy"])
    expect(result.expired.size).toBe(0)
    expect(result.roots).toEqual([])
    expect(result.skipped).toEqual(["busy"])
  })

  it("does not loop on cyclic parent links", () => {
    const result = run([session("a", 40, { parentID: "b" }), session("b", 40, { parentID: "a" })])
    expect(result.roots).toEqual([])
  })

  it("keeps only the topmost expired id of a chain", () => {
    const rows = [
      session("parent", 40),
      session("child", 35, { parentID: "parent" }),
      session("grand", 40),
      session("mid", 38, { parentID: "grand" }),
      session("leaf", 36, { parentID: "mid" }),
    ]
    expect(run(rows).roots).toEqual(["parent", "grand"])
  })

  it("keeps an expired child whose parent is not expired as its own root", () => {
    const rows = [session("fresh-parent", 2), session("orphan-child", 35, { parentID: "fresh-parent" })]
    expect(run(rows).roots).toEqual(["orphan-child"])
  })
})

describe("policy", () => {
  it("defaults to disabled at 30 days and clamps configured values", () => {
    expect(KiloSessionRetention.policy(undefined)).toEqual({ enabled: false, maxAgeDays: 30 })
    expect(KiloSessionRetention.policy({ retention: { enabled: true, maxAgeDays: 7.5 } })).toEqual({
      enabled: true,
      maxAgeDays: 30,
    })
    expect(KiloSessionRetention.policy({ retention: { enabled: true, maxAgeDays: 14 } })).toEqual({
      enabled: true,
      maxAgeDays: 14,
    })
  })
})

describe("shouldRun", () => {
  const active: KiloSessionRetention.Policy = { enabled: true, maxAgeDays: 30 }
  const state = (msAgo: number): KiloSessionRetention.State => ({
    at: NOW - msAgo,
    scanned: 1,
    deleted: 1,
    skippedActive: 0,
    failed: 0,
    durationMs: 5,
  })
  const HOUR = 3_600_000

  it("refuses every pass, forced or not, while the policy is disabled", () => {
    const off: KiloSessionRetention.Policy = { enabled: false, maxAgeDays: 30 }
    expect(KiloSessionRetention.shouldRun(off, {}, state(10 * 24 * HOUR), NOW)).toEqual({
      ok: false,
      reason: "disabled",
    })
    expect(KiloSessionRetention.shouldRun(off, { force: true }, null, NOW)).toEqual({
      ok: false,
      reason: "disabled",
    })
  })

  it("waits out the spacing window for scheduled passes", () => {
    expect(KiloSessionRetention.shouldRun(active, {}, state(10 * HOUR), NOW)).toEqual({
      ok: false,
      reason: "recent",
    })
    expect(KiloSessionRetention.shouldRun(active, {}, state(24 * HOUR), NOW)).toEqual({ ok: true })
  })

  it("lets a forced pass through once enabled, and a fresh policy with no prior state", () => {
    expect(KiloSessionRetention.shouldRun(active, { force: true }, state(10 * HOUR), NOW)).toEqual({ ok: true })
    expect(KiloSessionRetention.shouldRun(active, {}, null, NOW)).toEqual({ ok: true })
  })
})

const seed = Effect.fn("retention-test.seed")(function* (input: {
  directory: string
  rows: Array<{ id: string; parent?: string; updated: number; message?: number; part?: number }>
}) {
  const { db } = yield* Database.Service
  const project = ProjectV2.ID.make(`proj_retention_${crypto.randomUUID()}`)
  const now = Date.now()
  yield* db
    .insert(ProjectTable)
    .values({
      id: project,
      worktree: AbsolutePath.make(input.directory),
      vcs: "git",
      time_created: now,
      time_updated: now,
      sandboxes: [],
    })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .insert(SessionTable)
    .values(
      input.rows.map((row) => ({
        id: SessionID.make(row.id),
        parent_id: row.parent ? SessionID.make(row.parent) : undefined,
        project_id: project,
        slug: row.id,
        directory: input.directory,
        title: row.id,
        version: "test",
        time_created: row.updated,
        time_updated: row.updated,
      })),
    )
    .run()
    .pipe(Effect.orDie)
  for (const row of input.rows) {
    if (row.message === undefined && row.part === undefined) continue
    const messageID = MessageID.make(`msg_${crypto.randomUUID()}`)
    yield* db
      .insert(MessageTable)
      .values({
        id: messageID,
        session_id: SessionID.make(row.id),
        data: { role: "user" } as never,
        time_created: row.message ?? now,
        time_updated: row.message ?? now,
      })
      .run()
      .pipe(Effect.orDie)
    if (row.part !== undefined) {
      yield* db
        .insert(PartTable)
        .values({
          id: PartID.make(`prt_${crypto.randomUUID()}`),
          message_id: messageID,
          session_id: SessionID.make(row.id),
          data: { type: "text", text: "seed" } as never,
          time_created: row.part,
          time_updated: row.part,
        })
        .run()
        .pipe(Effect.orDie)
    }
  }
})

dbIt.live("busySessions flags sessions with recent message or part activity", () =>
  Effect.gen(function* () {
    const fresh = `ses_retention_fresh_${crypto.randomUUID()}`
    const old = `ses_retention_old_${crypto.randomUUID()}`
    const now = Date.now()
    yield* seed({
      directory: "/tmp/retention-busy",
      rows: [
        { id: fresh, updated: now - KiloSessionRetention.DAY_MS, message: now - 60_000, part: now - 30_000 },
        { id: old, updated: now - 40 * KiloSessionRetention.DAY_MS, message: now - 40 * KiloSessionRetention.DAY_MS },
      ],
    })
    const busy = yield* KiloSessionRetention.busySessions(now, [fresh, old])
    expect(busy.has(fresh)).toBe(true)
    expect(busy.has(old)).toBe(false)
  }),
)

dbIt.live("run skips history queries without age candidates and includes scanning in duration", () =>
  Effect.gen(function* () {
    expect(Database.path()).toBe(":memory:")
    const { db } = yield* Database.Service
    const now = Date.now()
    const parent = `ses_retention_parent_${crypto.randomUUID()}`
    yield* seed({
      directory: "/tmp/retention-no-candidates",
      rows: [
        { id: parent, updated: now - 40 * KiloSessionRetention.DAY_MS },
        { id: `ses_retention_fresh_${crypto.randomUUID()}`, parent, updated: now },
      ],
    })
    yield* db.run("DROP TABLE part").pipe(Effect.orDie)
    yield* db.run("DROP TABLE message").pipe(Effect.orDie)
    const config = Layer.mock(Config.Service, {
      get: () => Effect.sleep(20).pipe(Effect.as({ retention: { enabled: true, maxAgeDays: 30 } })),
    })
    const sessions = Layer.mock(Session.Service, { remove: () => Effect.die("no session should be removed") })
    const outcome = yield* KiloSessionRetention.run({ force: true }).pipe(Effect.provide(Layer.merge(config, sessions)))
    expect(outcome.ran).toBe(true)
    if (!outcome.ran) return
    expect(outcome.result).toMatchObject({ scanned: 2, deleted: 0, failed: 0, skippedActive: 0 })
    expect(outcome.result.durationMs).toBeGreaterThanOrEqual(15)
  }),
)

runIt.live("candidate probes preserve cross-project descendant and busy-parent selection", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const now = Date.now()
    const old = now - 40 * KiloSessionRetention.DAY_MS
    const ids = Array.from({ length: 9 }, () => SessionID.make(`ses_retention_${crypto.randomUUID()}`))
    const [grand, parent, child, busy, idle, fresh, expired, ancestor, recent] = ids
    yield* seed({
      directory: "/tmp/retention-ancestors",
      rows: [
        { id: grand, updated: old },
        { id: busy, updated: old, message: now },
        { id: fresh, updated: now, message: now },
        { id: ancestor, updated: old },
      ],
    })
    yield* seed({
      directory: "/tmp/retention-children",
      rows: [
        { id: parent, parent: grand, updated: old },
        { id: idle, parent: busy, updated: old },
        { id: expired, parent: fresh, updated: old },
        { id: recent, parent: ancestor, updated: now, message: now },
      ],
    })
    yield* seed({
      directory: "/tmp/retention-grandchild",
      rows: [{ id: child, parent, updated: old, message: old, part: now }],
    })
    const outcome = yield* KiloSessionRetention.run({ force: true }).pipe(Effect.provide(enabled))
    expect(outcome.ran && outcome.result).toMatchObject({ scanned: 9, deleted: 2, failed: 0, skippedActive: 4 })
    const rows = yield* db.select({ id: SessionTable.id }).from(SessionTable).all().pipe(Effect.orDie)
    expect(rows.map((row) => row.id).sort()).toEqual(ids.filter((id) => id !== idle && id !== expired).sort())
  }),
)

dbIt.live("busy probes ignore unrelated recent sessions and yield to event-loop work", () =>
  Effect.gen(function* () {
    const now = Date.now()
    const ids = Array.from({ length: 65 }, () => `ses_retention_probe_${crypto.randomUUID()}`)
    const outside = `ses_retention_outside_${crypto.randomUUID()}`
    yield* seed({
      directory: "/tmp/retention-probes",
      rows: [...ids, outside].map((id) => ({
        id,
        updated: now - 40 * KiloSessionRetention.DAY_MS,
        message: now,
      })),
    })
    let ticks = 0
    const timer = yield* Effect.acquireRelease(
      Effect.sync(() =>
        setInterval(() => {
          ticks++
        }, 0),
      ),
      (timer) => Effect.sync(() => clearInterval(timer)),
    )
    const busy = yield* KiloSessionRetention.busySessions(now, ids)
    clearInterval(timer)
    expect(busy).toEqual(new Set(ids))
    expect(busy.has(outside)).toBe(false)
    expect(ticks).toBeGreaterThanOrEqual(2)
  }),
)

runIt.live("run counts individual cascaded sessions and sweeps children in another project", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const parent = `ses_retention_parent_${crypto.randomUUID()}`
    const child = `ses_retention_child_${crypto.randomUUID()}`
    const foreign = `ses_retention_foreign_${crypto.randomUUID()}`
    const fresh = SessionID.make(`ses_retention_fresh_${crypto.randomUUID()}`)
    const busy = SessionID.make(`ses_retention_busy_${crypto.randomUUID()}`)
    const now = Date.now()
    const updated = now - 40 * KiloSessionRetention.DAY_MS
    yield* seed({
      directory: "/tmp/retention-cascade",
      rows: [
        { id: parent, updated },
        { id: child, parent, updated },
        { id: fresh, updated: now },
        { id: busy, updated, message: now },
      ],
    })
    yield* seed({ directory: "/tmp/retention-foreign", rows: [{ id: foreign, parent, updated }] })
    const outcome = yield* KiloSessionRetention.run({ force: true }).pipe(Effect.provide(enabled))
    expect(outcome.ran).toBe(true)
    if (!outcome.ran) return
    expect(outcome.result).toMatchObject({ scanned: 5, deleted: 3, failed: 0, skippedActive: 1 })
    const rows = yield* db.select({ id: SessionTable.id }).from(SessionTable).all().pipe(Effect.orDie)
    expect(rows.map((row) => row.id).sort()).toEqual([busy, fresh].sort())
    expect(yield* KiloSessionRetention.readState()).toEqual(outcome.result)
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
  }),
)

dbIt.live("progress observes children while root removal is pending and verifies swallowed failures", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const parent = SessionID.make(`ses_retention_parent_${crypto.randomUUID()}`)
    const child = SessionID.make(`ses_retention_child_${crypto.randomUUID()}`)
    const failed = SessionID.make(`ses_retention_failed_${crypto.randomUUID()}`)
    const updated = Date.now() - 40 * KiloSessionRetention.DAY_MS
    yield* seed({
      directory: "/tmp/retention-progress",
      rows: [
        { id: parent, updated },
        { id: child, parent, updated },
        { id: failed, updated },
      ],
    })
    const reached = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    const sessions = Layer.mock(Session.Service, {
      remove: (id) =>
        Effect.gen(function* () {
          if (id === failed) return // Session.remove can return without removing the row.
          if (id === parent) {
            yield* db.delete(SessionTable).where(eq(SessionTable.id, child)).run().pipe(Effect.orDie)
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(resume)
          }
          yield* db.delete(SessionTable).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)
        }),
    })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(enabled, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(reached), "root removal did not reach child pause")
    expect(yield* KiloSessionRetention.readProgress()).toEqual({
      phase: "deleting",
      total: 3,
      processed: 1,
      deleted: 1,
      failed: 0,
      skippedActive: 0,
    })
    yield* Deferred.succeed(resume, undefined)
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.ran && outcome.result).toMatchObject({ deleted: 2, failed: 1 })
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
    const rows = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(inArray(SessionTable.id, [parent, child, failed]))
      .all()
      .pipe(Effect.orDie)
    expect(rows.map((row) => row.id)).toEqual([failed])
  }),
)

runIt.live("run verifies actual Session.remove failures instead of counting returned calls", () =>
  Effect.gen(function* () {
    expect(Database.path()).toBe(":memory:")
    const { db } = yield* Database.Service
    const id = SessionID.make(`ses_retention_failed_${crypto.randomUUID()}`)
    yield* seed({
      directory: "/tmp/retention-failed",
      rows: [{ id, updated: Date.now() - 40 * KiloSessionRetention.DAY_MS }],
    })
    yield* db
      .run("CREATE TRIGGER retention_fail BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'retention failure'); END")
      .pipe(Effect.orDie)
    const outcome = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(enabled),
      Effect.ensuring(db.run("DROP TRIGGER retention_fail").pipe(Effect.orDie)),
    )
    expect(outcome.ran && outcome.result).toMatchObject({ deleted: 0, failed: 1 })
    const row = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.id, id))
      .get()
      .pipe(Effect.orDie)
    expect(row?.id).toBe(id)
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
  }),
)

dbIt.live("run serializes duplicates and clears progress on failure and interruption", () =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<void>()
    const blocked = Layer.mock(Config.Service, {
      get: () => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)),
    })
    const sessions = Layer.mock(Session.Service, { remove: () => Effect.void })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(blocked, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(reached), "scan did not start")
    expect(yield* KiloSessionRetention.readProgress()).toEqual({
      phase: "scanning",
      total: 0,
      processed: 0,
      deleted: 0,
      failed: 0,
      skippedActive: 0,
    })
    let calls = 0
    const broken = Layer.mock(Config.Service, {
      get: () =>
        Effect.sync(() => {
          calls++
        }).pipe(Effect.andThen(Effect.die("scan failed"))),
    })
    const duplicate = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(broken, sessions)),
      Effect.exit,
      Effect.forkChild({ startImmediately: true }),
    )
    expect(calls).toBe(0)
    yield* Fiber.interrupt(fiber)
    const exit = yield* awaitWithTimeout(Fiber.join(duplicate), "interrupted run did not release its lock")
    expect(calls).toBe(1)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
  }),
)

dbIt.live("run clears deleting progress after interruption without replacing the previous result", () =>
  Effect.gen(function* () {
    const id = `ses_retention_abort_${crypto.randomUUID()}`
    yield* seed({
      directory: "/tmp/retention-abort",
      rows: [{ id, updated: Date.now() - 40 * KiloSessionRetention.DAY_MS }],
    })
    const previous = yield* KiloSessionRetention.readState()
    const reached = yield* Deferred.make<void>()
    const sessions = Layer.mock(Session.Service, {
      remove: () => Deferred.succeed(reached, undefined).pipe(Effect.andThen(Effect.never)),
    })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(enabled, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(reached), "deletion did not start")
    expect((yield* KiloSessionRetention.readProgress())?.phase).toBe("deleting")
    yield* Fiber.interrupt(fiber)
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
    expect(yield* KiloSessionRetention.readState()).toEqual(previous)
  }),
)

dbIt.live("cancel with no active pass reports false", () =>
  Effect.gen(function* () {
    expect(KiloSessionRetention.cancel()).toBe(false)
  }),
)

dbIt.live("cancel during deleting keeps completed removals, stops the rest, records a partial result", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const first = `ses_retention_stop_a_${crypto.randomUUID()}`
    const second = `ses_retention_stop_b_${crypto.randomUUID()}`
    const updated = Date.now() - 40 * KiloSessionRetention.DAY_MS
    yield* seed({
      directory: "/tmp/retention-stop",
      rows: [
        { id: first, updated },
        { id: second, updated },
      ],
    })
    const reached = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let removed = 0
    const sessions = Layer.mock(Session.Service, {
      remove: (id) =>
        Effect.gen(function* () {
          if (++removed === 1) {
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(resume)
          }
          yield* db.delete(SessionTable).where(eq(SessionTable.id, id)).run().pipe(Effect.orDie)
        }),
    })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(enabled, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(reached), "first removal did not start")
    expect(KiloSessionRetention.cancel()).toBe(true)
    expect((yield* KiloSessionRetention.readProgress())?.phase).toBe("cancelling")
    yield* Deferred.succeed(resume, undefined)
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.ran && outcome.result).toMatchObject({ scanned: 2, deleted: 1, failed: 0, cancelled: true })
    expect(yield* KiloSessionRetention.readState()).toMatchObject({ deleted: 1, cancelled: true })
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
    const rows = yield* db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(inArray(SessionTable.id, [SessionID.make(first), SessionID.make(second)]))
      .all()
      .pipe(Effect.orDie)
    expect(rows.map((row) => row.id)).toEqual([SessionID.make(second)])
    expect(KiloSessionRetention.cancel()).toBe(false)
  }),
)

dbIt.live("cancelled pass still counts children removed by earlier root cascades", () =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const parent = `ses_retention_cascade_p_${crypto.randomUUID()}`
    const child = `ses_retention_cascade_c_${crypto.randomUUID()}`
    const updated = Date.now() - 40 * KiloSessionRetention.DAY_MS
    yield* seed({
      directory: "/tmp/retention-cascade",
      rows: [
        { id: parent, updated },
        { id: child, updated, parent },
      ],
    })
    const reached = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let removed = 0
    const sessions = Layer.mock(Session.Service, {
      remove: (id) =>
        Effect.gen(function* () {
          if (++removed === 1) {
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(resume)
          }
          // Removing the parent cascades the child, as the real service does.
          yield* db
            .delete(SessionTable)
            .where(inArray(SessionTable.id, [id, SessionID.make(child)]))
            .run()
            .pipe(Effect.orDie)
        }),
    })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(enabled, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(reached), "root removal did not start")
    expect(KiloSessionRetention.cancel()).toBe(true)
    yield* Deferred.succeed(resume, undefined)
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.ran && outcome.result).toMatchObject({ scanned: 2, deleted: 2, failed: 0, cancelled: true })
  }),
)

dbIt.live("cancelled pass counts a root removal that failed before the cancel", () =>
  Effect.gen(function* () {
    const id = `ses_retention_rootfail_${crypto.randomUUID()}`
    yield* seed({
      directory: "/tmp/retention-rootfail",
      rows: [{ id, updated: Date.now() - 40 * KiloSessionRetention.DAY_MS }],
    })
    const reached = yield* Deferred.make<void>()
    const resume = yield* Deferred.make<void>()
    let removed = 0
    const sessions = Layer.mock(Session.Service, {
      remove: () =>
        Effect.gen(function* () {
          if (++removed === 1) {
            yield* Deferred.succeed(reached, undefined)
            yield* Deferred.await(resume)
          }
          // Failed removal: the row stays in place.
        }),
    })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(enabled, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(reached), "root removal did not start")
    expect(KiloSessionRetention.cancel()).toBe(true)
    yield* Deferred.succeed(resume, undefined)
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.ran && outcome.result).toMatchObject({ deleted: 0, failed: 1, cancelled: true })
  }),
)

dbIt.live("cancel during scanning aborts before any deletion", () =>
  Effect.gen(function* () {
    const id = `ses_retention_stop_scan_${crypto.randomUUID()}`
    yield* seed({
      directory: "/tmp/retention-stop-scan",
      rows: [{ id, updated: Date.now() - 40 * KiloSessionRetention.DAY_MS }],
    })
    const gate = yield* Deferred.make<void>()
    const entered = yield* Deferred.make<void>()
    const config = Layer.mock(Config.Service, {
      get: () =>
        Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.as({ retention: { enabled: true, maxAgeDays: 30 } }),
        ),
    })
    const sessions = Layer.mock(Session.Service, { remove: () => Effect.die("no session should be removed") })
    const fiber = yield* KiloSessionRetention.run({ force: true }).pipe(
      Effect.provide(Layer.merge(config, sessions)),
      Effect.forkChild,
    )
    yield* awaitWithTimeout(Deferred.await(entered), "scan did not start")
    expect(KiloSessionRetention.cancel()).toBe(true)
    yield* Deferred.succeed(gate, undefined)
    const outcome = yield* Fiber.join(fiber)
    expect(outcome.ran && outcome.result).toMatchObject({ deleted: 0, failed: 0, cancelled: true })
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
  }),
)
