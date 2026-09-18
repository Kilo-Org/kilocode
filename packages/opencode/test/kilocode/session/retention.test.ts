import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
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
import { SessionID, MessageID, PartID } from "../../../src/session/schema"
import { KiloSessionRetention } from "../../../src/kilocode/session/retention"
import { testInstanceStoreLayer } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const env = Layer.mergeAll(
  LayerNode.compile(
    LayerNode.group([FSUtil.node, AppProcess.node, EffectFlock.node, Database.node, CrossSpawnSpawner.node]),
  ),
  testInstanceStoreLayer,
)
const dbIt = testEffect(env)

const NOW = 1_700_000_000_000

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
  const state = (daysAgo: number): KiloSessionRetention.State => ({
    at: NOW - daysAgo * KiloSessionRetention.DAY_MS,
    scanned: 1,
    deleted: 1,
    skippedActive: 0,
    failed: 0,
    durationMs: 5,
  })

  it("refuses every pass, forced or not, while the policy is disabled", () => {
    const off: KiloSessionRetention.Policy = { enabled: false, maxAgeDays: 30 }
    expect(KiloSessionRetention.shouldRun(off, {}, state(10), NOW)).toEqual({ ok: false, reason: "disabled" })
    expect(KiloSessionRetention.shouldRun(off, { force: true }, null, NOW)).toEqual({
      ok: false,
      reason: "disabled",
    })
  })

  it("waits out the spacing window for scheduled passes", () => {
    expect(KiloSessionRetention.shouldRun(active, {}, state(1), NOW)).toEqual({ ok: false, reason: "recent" })
    expect(KiloSessionRetention.shouldRun(active, {}, state(21), NOW)).toEqual({ ok: true })
  })

  it("lets a forced pass through once enabled, and a fresh policy with no prior state", () => {
    expect(KiloSessionRetention.shouldRun(active, { force: true }, state(1), NOW)).toEqual({ ok: true })
    expect(KiloSessionRetention.shouldRun(active, {}, null, NOW)).toEqual({ ok: true })
  })
})

const seed = Effect.fn("retention-test.seed")(function* (input: {
  directory: string
  rows: Array<{ id: string; updated: number; message?: number; part?: number }>
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
    const busy = yield* KiloSessionRetention.busySessions(now)
    expect(busy.has(fresh)).toBe(true)
    expect(busy.has(old)).toBe(false)
  }),
)
