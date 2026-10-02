import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq, inArray } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Config } from "../../../src/config/config"
import { Session } from "../../../src/session/session"
import { SessionStatus } from "../../../src/session/status"
import { KiloSessionResume } from "../../../src/kilocode/session/resume"
import { KiloSessionRetention } from "../../../src/kilocode/session/retention"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([Session.node, SessionStatus.node, SessionProjector.node, Database.node, CrossSpawnSpawner.node]),
  ),
)
const enabled = Layer.mock(Config.Service, {
  getGlobal: () => Effect.succeed({ retention: { enabled: true, maxAgeDays: 30 } }),
})

for (const leaf of [false, true]) {
  it.instance(`resuming an expired ${leaf ? "child" : "root"} preserves its tree without marking it busy`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { db } = yield* Database.Service
      const root = yield* sessions.create()
      const child = yield* sessions.create({ parentID: root.id })
      const sibling = yield* sessions.create({ parentID: root.id })
      const other = yield* sessions.create()
      const ids = [root.id, child.id, sibling.id, other.id]
      const old = Date.now() - 40 * KiloSessionRetention.DAY_MS
      yield* db.update(SessionTable).set({ time_updated: old }).where(inArray(SessionTable.id, ids)).run()
      const selected = leaf ? child.id : root.id
      const before = Date.now()
      expect(yield* KiloSessionResume.resolve({ session: selected })).toBe(selected)
      expect((yield* sessions.get(selected)).time.updated).toBeGreaterThanOrEqual(before)
      expect(yield* SessionStatus.Service.use((status) => status.get(selected))).toEqual({ type: "idle" })
      const result = yield* KiloSessionRetention.run({ force: true }).pipe(Effect.provide(enabled))
      expect(result.ran && result.result.deleted).toBe(1)
      const rows = yield* db.select({ id: SessionTable.id }).from(SessionTable).all()
      expect(rows.map((row) => row.id).sort()).toEqual([root.id, child.id, sibling.id].sort())
    }),
  )
}

it.instance("continue resolves the latest root before input waits, not its newer child", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { db } = yield* Database.Service
    const older = yield* sessions.create()
    const latest = yield* sessions.create()
    const child = yield* sessions.create({ parentID: older.id })
    const old = Date.now() - 40 * KiloSessionRetention.DAY_MS
    for (const [id, updated] of [
      [older.id, old - 2],
      [latest.id, old - 1],
      [child.id, old],
    ] as const) {
      yield* db.update(SessionTable).set({ time_updated: updated }).where(eq(SessionTable.id, id)).run()
    }
    const selected = yield* KiloSessionResume.resolve({ continue: true })
    expect(selected).toBe(latest.id)
    yield* KiloSessionRetention.run({ force: true }).pipe(Effect.provide(enabled))
    expect((yield* sessions.get(latest.id)).id).toBe(selected!)
    expect(yield* sessions.list()).toHaveLength(1)
  }),
)

it.instance("run continue ignores newer sessions from another directory of the project", () =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const { db } = yield* Database.Service
    const local = yield* sessions.create()
    const other = yield* sessions.create()
    yield* db.update(SessionTable).set({ directory: "/tmp/other-worktree" }).where(eq(SessionTable.id, other.id)).run()
    expect(yield* KiloSessionResume.run({ continue: true })).toBe(local.id)
  }),
)

it.instance("unknown or invalid session IDs are left to normal validation", () =>
  Effect.gen(function* () {
    expect(yield* KiloSessionResume.resolve({ session: "badid" })).toBeUndefined()
    expect(yield* KiloSessionResume.resolve({ session: "ses_doesnotexist123" })).toBeUndefined()
  }),
)

it.instance("fresh runs, cloud imports and continue without history do not select local history", () =>
  Effect.gen(function* () {
    expect(yield* KiloSessionResume.resolve({})).toBeUndefined()
    expect(yield* KiloSessionResume.resolve({ continue: true })).toBeUndefined()
    const sessions = yield* Session.Service
    const session = yield* sessions.create()
    const before = (yield* sessions.get(session.id)).time.updated
    expect(yield* KiloSessionResume.resolve({ session: session.id, cloudFork: true })).toBeUndefined()
    expect((yield* sessions.get(session.id)).time.updated).toBe(before)
  }),
)
