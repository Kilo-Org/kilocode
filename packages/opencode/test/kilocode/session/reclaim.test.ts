import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect, Fiber } from "effect"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { KiloReclaim } from "../../../src/kilocode/session/reclaim"
import { tmpdir } from "../../fixture/fixture"

function seed(file: string) {
  const db = new Database(file)
  db.run("PRAGMA journal_mode = WAL")
  db.run("CREATE TABLE retained (value TEXT)")
  db.run("INSERT INTO retained VALUES ('keep')")
  db.run("CREATE TABLE junk (payload BLOB)")
  db.run("INSERT INTO junk VALUES (zeroblob(24 * 1024 * 1024))")
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  db.run("DROP TABLE junk")
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  return db
}

test("reclamation keeps the existing free-space thresholds", () => {
  expect(KiloReclaim.worth(93_861, 0, 4096)).toBe(false)
  expect(KiloReclaim.worth(10_000, 2048, 4096)).toBe(false)
  expect(KiloReclaim.worth(512_000, 6144, 4096)).toBe(false)
  expect(KiloReclaim.worth(93_861, 84_639, 4096)).toBe(true)
  expect(KiloReclaim.worth(20_480, 4096, 4096)).toBe(true)
})

test("does not open an in-memory or missing database", async () => {
  await using tmp = await tmpdir()
  const file = `${tmp.path}/missing.db`
  for (const file of ["", ":memory:"])
    expect(await Effect.runPromise(KiloReclaim.run(file))).toEqual({ vacuumed: false, reclaimedBytes: 0 })
  await expect(Effect.runPromise(KiloReclaim.run(file))).rejects.toThrow()
  expect(existsSync(file)).toBe(false)
})

test("a real worker reclaims freed pages without initializing runtime tables", async () => {
  await using tmp = await tmpdir()
  const file = `${tmp.path}/reclaim.db`
  using db = seed(file)
  const before = statSync(file).size
  const result = await Effect.runPromise(KiloReclaim.run(file))
  expect(result.vacuumed).toBe(true)
  expect(result.reclaimedBytes).toBeGreaterThan(KiloReclaim.minimum)
  expect(statSync(file).size).toBeLessThan(before - KiloReclaim.minimum)
  expect(db.query("SELECT value FROM retained").get()).toEqual({ value: "keep" })
  expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: "retained" }])
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
  expect(await Effect.runPromise(KiloReclaim.run(file))).toEqual({ vacuumed: false, reclaimedBytes: 0 })
})

test("a busy writer prevents reclamation and leaves its transaction intact", async () => {
  await using tmp = await tmpdir()
  const file = `${tmp.path}/busy.db`
  using db = seed(file)
  const before = statSync(file).size
  db.run("BEGIN IMMEDIATE")
  try {
    await expect(Effect.runPromise(KiloReclaim.run(file))).rejects.toThrow("locked")
    expect(db.inTransaction).toBe(true)
    expect(statSync(file).size).toBe(before)
  } finally {
    db.run("ROLLBACK")
  }
  expect((await Effect.runPromise(KiloReclaim.run(file))).vacuumed).toBe(true)
})

test("interruption waits for the worker to close before releasing its owner", async () => {
  await using tmp = await tmpdir()
  const file = `${tmp.path}/interrupted.db`
  using db = seed(file)
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* KiloReclaim.run(file).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            // A released maintenance lease must not race a live SQLite worker.
            db.run("BEGIN IMMEDIATE")
            db.run("ROLLBACK")
          }),
        ),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Fiber.interrupt(fiber)
    }),
  )
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
  expect((await Effect.runPromise(KiloReclaim.run(file))).vacuumed).toBe(true)
})

test("interrupting an active rebuild waits until SQLite releases its writer lock", async () => {
  await using tmp = await tmpdir()
  const file = `${tmp.path}/active.db`
  using db = seed(file)
  db.run("INSERT INTO retained VALUES (zeroblob(64 * 1024 * 1024))")
  db.run("CREATE TABLE junk (payload BLOB)")
  db.run("INSERT INTO junk VALUES (zeroblob(32 * 1024 * 1024))")
  db.run("DROP TABLE junk")
  db.run("PRAGMA wal_checkpoint(TRUNCATE)")
  db.run("PRAGMA busy_timeout = 0")
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* KiloReclaim.run(file).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            db.run("BEGIN IMMEDIATE")
            db.run("ROLLBACK")
          }),
        ),
        Effect.forkChild({ startImmediately: true }),
      )
      yield* Effect.gen(function* () {
        // WAL growth is produced by the real worker's native VACUUM.
        while (statSync(`${file}-wal`).size === 0) {
          if (fiber.pollUnsafe() != null) throw new Error("Rebuild ended before WAL activity was observed")
          yield* Effect.sleep("1 millis")
        }
      }).pipe(Effect.timeout("5 seconds"))
      yield* Fiber.interrupt(fiber)
    }),
  )
  expect(db.query("SELECT COUNT(*) AS count FROM retained").get()).toEqual({ count: 2 })
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
})

test("the worker runs from a compiled Bun executable", async () => {
  await using tmp = await tmpdir()
  const file = `${tmp.path}/compiled.db`
  using db = seed(file)
  const entry = `${tmp.path}/entry.ts`
  const worker =
    "./" +
    path
      .relative(
        process.cwd(),
        fileURLToPath(new URL("../../../src/kilocode/session/reclaim-worker.ts", import.meta.url)),
      )
      .replaceAll(path.sep, "/")
  const helper = fileURLToPath(new URL("../../../src/kilocode/session/reclaim.ts", import.meta.url))
  await Bun.write(
    entry,
    `import { Effect } from ${JSON.stringify(fileURLToPath(import.meta.resolve("effect")))}
       import { KiloReclaim } from ${JSON.stringify(helper)}
       console.log(JSON.stringify(await Effect.runPromise(KiloReclaim.run(process.argv[2]))))`,
  )
  const binary = `${tmp.path}/reclaim${process.platform === "win32" ? ".exe" : ""}`
  const build = await Bun.build({
    entrypoints: [entry, worker],
    conditions: ["bun", "node"],
    minify: true,
    splitting: false,
    compile: {
      outfile: binary,
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: false,
      autoloadPackageJson: false,
    },
    define: { KILO_RECLAIM_WORKER_PATH: worker },
  })
  expect(build.success).toBe(true)
  const child = Bun.spawn([binary, file], {
    cwd: tmp.path,
    env: { HOME: tmp.path, KILO_DB: ":memory:" },
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(err).toBe("")
  expect(code).toBe(0)
  expect(JSON.parse(out)).toMatchObject({ vacuumed: true })
  expect(db.query("SELECT value FROM retained").get()).toEqual({ value: "keep" })
  expect(db.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
}, 30_000)
