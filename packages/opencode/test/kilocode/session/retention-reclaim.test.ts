import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { statSync } from "node:fs"
import { Database } from "@opencode-ai/core/database/database"
import { KiloSessionRetention } from "../../../src/kilocode/session/retention"
import { tmpdir } from "../../fixture/fixture"

const use = <A, E>(effect: Effect.Effect<A, E, Database.Service>, file: string) =>
  Effect.runPromise(Effect.provide(Database.layerFromPath(file))(Effect.scoped(effect)))

describe("worthVacuuming", () => {
  test("requires free space large enough in bytes and relative to the file", () => {
    expect(KiloSessionRetention.worthVacuuming(93_861, 0, 4096)).toBe(false)
    // 8MB free: below the absolute floor
    expect(KiloSessionRetention.worthVacuuming(10_000, 2_048, 4096)).toBe(false)
    // 25MB free of a 2GB file: below the ratio floor
    expect(KiloSessionRetention.worthVacuuming(512_000, 6_144, 4096)).toBe(false)
    // 346MB free of a 367MB file: worth the rebuild
    expect(KiloSessionRetention.worthVacuuming(93_861, 84_639, 4096)).toBe(true)
  })
})

describe("reclaim", () => {
  test("skips while nothing is free, vacuums once freed pages cross the thresholds", async () => {
    await using tmp = await tmpdir()
    const file = `${tmp.path}/reclaim.db`
    await use(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run("CREATE TABLE junk (payload BLOB)").pipe(Effect.orDie)
        yield* db.run("INSERT INTO junk (payload) VALUES (zeroblob(24 * 1024 * 1024))").pipe(Effect.orDie)
        const before = statSync(file).size
        expect(yield* KiloSessionRetention.reclaim()).toEqual({ vacuumed: false, reclaimedBytes: 0 })
        yield* db.run("DROP TABLE junk").pipe(Effect.orDie)
        const freed = yield* KiloSessionRetention.reclaim()
        expect(freed.vacuumed).toBe(true)
        expect(freed.reclaimedBytes).toBeGreaterThan(KiloSessionRetention.VACUUM_MIN_FREE_BYTES)
        expect(statSync(file).size).toBeLessThan(before - 16 * 1024 * 1024)
        expect(yield* KiloSessionRetention.reclaim()).toEqual({ vacuumed: false, reclaimedBytes: 0 })
      }),
      file,
    )
  })

  test("never vacuums an in-memory database", async () => {
    await use(
      Effect.gen(function* () {
        const { db } = yield* Database.Service
        yield* db.run("CREATE TABLE junk (payload BLOB)").pipe(Effect.orDie)
        yield* db.run("INSERT INTO junk (payload) VALUES (zeroblob(24 * 1024 * 1024))").pipe(Effect.orDie)
        yield* db.run("DROP TABLE junk").pipe(Effect.orDie)
        expect(yield* KiloSessionRetention.reclaim()).toEqual({ vacuumed: false, reclaimedBytes: 0 })
      }),
      ":memory:",
    )
  })
})
