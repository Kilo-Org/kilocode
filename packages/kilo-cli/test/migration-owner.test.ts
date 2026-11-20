import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { isolatedEnv } from "../../cli/test/fixture/environment"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import {
  finishRecovered,
  MigrationRunError,
  type MigrationState,
  observeOwner,
  readOwner,
  retryOwner,
  withOwner,
} from "../src/migration/owner"

function fixture(root: string) {
  const dir = path.join(root, "kilo")
  mkdirSync(dir)
  const file = path.join(dir, "kilo.db")
  using db = new Database(file)
  db.exec("CREATE TABLE synthetic(id INTEGER PRIMARY KEY); INSERT INTO synthetic VALUES (17)")
  return file
}

async function blockedOwner(file: string, root: string, action: "start" | "retry" | "publish" = "start") {
  const release = path.join(root, "release")
  const module = pathToFileURL(path.join(import.meta.dir, "../src/migration/owner.ts"))
  const script = `
    import { retryOwner, withOwner } from ${JSON.stringify(module.href)}
    import { copyFileSync, existsSync, writeSync } from "node:fs"
    import { Database } from "bun:sqlite"
    const source = ${JSON.stringify(file)}, action = ${JSON.stringify(action)}
    const backup = source + '.backup'
    async function work(update) {
      update({ phase: "copy", done: 1, total: 7 })
      if (action === "publish") {
        copyFileSync(source, backup)
        using db = new Database(source, { readwrite: true })
        db.exec("ALTER TABLE synthetic RENAME TO converted")
      }
      writeSync(1, "ready")
      while (!existsSync(${JSON.stringify(release)})) Bun.sleepSync(10)
      update({ phase: "convert", done: 7, total: 7 })
    }
    function validate() {
      if (existsSync(backup)) throw Error("Recovery backup exists")
      using db = new Database(source, { readonly: true })
      if (!db.query("SELECT id FROM synthetic WHERE id=17").get()) throw Error("Source no longer eligible")
    }
    if (action === "retry") await retryOwner(source, validate, work)
    else await withOwner(source, work)
  `
  const proc = Bun.spawn([process.execPath, "-e", script], {
    cwd: root,
    env: isolatedEnv(root),
    stdout: "pipe",
    stderr: "pipe",
  })
  // Wait for the child to commit its progress, then keep its event loop blocked until the observing window acts.
  const ready = await proc.stdout.getReader().read()
  if (ready.done) throw new Error(`Owner exited before reporting progress: ${await new Response(proc.stderr).text()}`)
  return {
    proc,
    resume: () => writeFileSync(release, ""),
    async [Symbol.asyncDispose]() {
      if (proc.exitCode === null) proc.kill("SIGKILL")
      await proc.exited
    },
  }
}

async function duplicate() {
  throw new Error("Joining windows must never enter work")
}

function files(root: string) {
  return readdirSync(root, { encoding: "utf8", recursive: true })
    .sort()
    .map((name) => {
      const stat = statSync(path.join(root, name), { bigint: true })
      return { name, mtime: stat.mtimeNs, size: stat.size }
    })
}

test("observation before consent cannot start work or initialize sidecars", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  const before = files(root.path)
  expect(readOwner(file)).toBeUndefined()
  expect(readOwner(path.join(root.path, "absent.db"))).toBeUndefined()
  await expect(observeOwner(file, () => {})).rejects.toThrow("No migration run")
  await expect(retryOwner(file, duplicate, duplicate)).rejects.toThrow("No migration run")
  await expect(finishRecovered(file, duplicate)).rejects.toThrow("No migration run")
  expect(files(root.path)).toEqual(before)
})

test("a window joining through a path alias observes atomic progress and replays the owner's success", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  const before = readFileSync(file)
  const alias = path.join(root.path, "alias")
  symlinkSync(path.dirname(file), alias, "junction")
  await using child = await blockedOwner(file, root.path)
  const seen: MigrationState[] = []
  await withOwner(path.join(alias, "kilo.db"), duplicate, (state) => {
    seen.push(state)
    if (state.status === "running" && state.phase === "copy") child.resume()
  })
  const code = await child.proc.exited
  expect(await new Response(child.proc.stderr).text()).toBe("")
  expect(code).toBe(0)
  expect(seen[0]).toEqual({ phase: "copy", done: 1, total: 7, status: "running" })
  const completed = { phase: "convert", done: 7, total: 7, status: "completed" as const }
  expect(seen.at(-1)).toEqual(completed)
  const replay: MigrationState[] = []
  await withOwner(file, duplicate, (state) => replay.push(state))
  expect(replay).toEqual([completed])
  const observed: MigrationState[] = []
  await observeOwner(file, (state) => observed.push(state))
  expect(observed).toEqual(replay)
  await expect(retryOwner(file, duplicate, duplicate)).rejects.toThrow("already completed")
  await expect(finishRecovered(file, duplicate)).rejects.toThrow("already completed")
  expect(readFileSync(file)).toEqual(before)
})

test("a process killed in mid-phase releases ownership; an observer reports interruption without writing", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  await using child = await blockedOwner(file, root.path)
  const before = files(root.path)
  const seen: MigrationState[] = []
  const join = observeOwner(file, (state) => {
    seen.push(state)
    if (state.status === "running") child.proc.kill("SIGKILL")
  })
  const progress = { phase: "copy", done: 1, total: 7 }
  const error = { name: "MigrationRunError", status: "interrupted", progress }
  await expect(join).rejects.toMatchObject(error)
  expect(seen[0]?.status).toBe("running")
  expect(seen.at(-1)).toMatchObject({ ...progress, status: "interrupted", message: expect.any(String) })
  expect(readOwner(file)).toEqual(seen.at(-1))
  expect(files(root.path)).toEqual(before)
  await expect(withOwner(file, duplicate)).rejects.toMatchObject(error)
})

test("a work failure is recorded for the owner and later callers with its phase, counts and message", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  const progress = { phase: "backup", done: 4, total: 8 }
  const cause = new Error("Fixture disk full")
  const error = { status: "failed", progress, message: cause.message }
  const work = withOwner(file, async (update) => {
    update(progress)
    throw cause
  })
  await expect(work).rejects.toBeInstanceOf(MigrationRunError)
  await expect(work).rejects.toMatchObject({ ...error, cause })
  const replay: MigrationState[] = []
  await expect(withOwner(file, duplicate, (state) => replay.push(state))).rejects.toMatchObject(error)
  expect(replay).toEqual([{ ...progress, status: "failed", message: cause.message }])
})

test("rejected recovery validation holds the owner lock and preserves the failed attempt", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  await expect(
    withOwner(file, async () => {
      throw new Error("disk full")
    }),
  ).rejects.toThrow("disk full")
  const backup = `${file}.backup`
  copyFileSync(file, backup)
  const before = readOwner(file)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const recovery = retryOwner(
    file,
    async () => {
      entered.resolve()
      await release.promise
      if (existsSync(backup)) throw new Error("Recovery backup exists")
    },
    duplicate,
  )
  await entered.promise
  try {
    await expect(finishRecovered(file, duplicate)).rejects.toThrow("lock is busy")
  } finally {
    release.resolve()
  }
  await expect(recovery).rejects.toThrow("Recovery backup exists")
  expect(readOwner(file)).toMatchObject({ status: "failed", message: "disk full" })
  expect(readOwner(file)).toEqual(before)
  expect(readFileSync(file)).toEqual(readFileSync(backup))
})

test("only one explicit retry can recover a killed owner while other windows observe that retry", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  await using first = await blockedOwner(file, root.path)
  await expect(retryOwner(file, duplicate, duplicate)).rejects.toThrow("lock is busy")
  first.proc.kill("SIGKILL")
  await first.proc.exited
  expect(readOwner(file)?.status).toBe("interrupted")
  await using retry = await blockedOwner(file, root.path, "retry")
  await expect(retryOwner(file, duplicate, duplicate)).rejects.toThrow("lock is busy")
  const followers: MigrationState[][] = [[], []]
  await Promise.all(
    followers.map((seen) =>
      observeOwner(file, (state) => {
        seen.push(state)
        if (followers.every((list) => list[0]?.status === "running")) retry.resume()
      }),
    ),
  )
  for (const seen of followers) {
    expect(seen[0]).toMatchObject({ status: "running", done: 1, total: 7 })
    expect(seen.at(-1)).toMatchObject({ status: "completed", done: 7, total: 7 })
  }
  expect(await new Response(retry.proc.stderr).text()).toBe("")
  expect(await retry.proc.exited).toBe(0)
  await expect(retryOwner(file, duplicate, duplicate)).rejects.toThrow("already completed")
})

test("a crash after publication can be marked complete only after verification of the live store and backup", async () => {
  await using root = await tmpdir()
  const file = fixture(root.path)
  await using child = await blockedOwner(file, root.path, "publish")
  child.proc.kill("SIGKILL")
  await child.proc.exited
  const backup = `${file}.backup`
  const originals = [readFileSync(file), readFileSync(backup)]
  function verify(expected: number) {
    using converted = new Database(file, { readonly: true })
    using recovery = new Database(backup, { readonly: true })
    for (const db of [converted, recovery])
      expect(db.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }])
    const live = converted.query("SELECT * FROM converted").all()
    expect(live).toEqual(recovery.query("SELECT * FROM synthetic").all())
    if (live.length !== expected) throw new Error("Unexpected number of migrated rows")
  }
  await expect(finishRecovered(file, () => verify(2))).rejects.toThrow("Unexpected number")
  expect(readOwner(file)?.status).toBe("interrupted")
  const observed: MigrationState[] = []
  await finishRecovered(
    file,
    () => verify(1),
    (state) => observed.push(state),
  )
  expect(observed).toEqual([{ phase: "Recovery verified", status: "completed" }])
  expect(readOwner(file)).toEqual(observed[0])
  await withOwner(file, duplicate)
  expect([readFileSync(file), readFileSync(backup)]).toEqual(originals)
})
