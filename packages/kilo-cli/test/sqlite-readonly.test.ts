import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openReadonly } from "../src/sqlite-readonly"

const dirs: string[] = []
const open: Database[] = []
afterEach(async () => {
  // Windows keeps an open file locked, so every connection closes before the directory is removed.
  for (const db of open.splice(0)) db.close()
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  )
})

/** A WAL store in use (its writer stays open) and a copy of it at rest, with no -wal or -shm file beside the copy. */
async function stores() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-readonly-"))
  dirs.push(dir)
  const live = path.join(dir, "live.db")
  const writer = new Database(live)
  open.push(writer)
  writer.run("PRAGMA journal_mode = WAL")
  writer.run("CREATE TABLE note (body TEXT)")
  writer.run("INSERT INTO note VALUES ('kept')")
  writer.run("PRAGMA wal_checkpoint(TRUNCATE)")
  const rest = path.join(dir, "rest", "store.db")
  await mkdir(path.dirname(rest))
  await copyFile(live, rest)
  return { live, rest }
}

test("a store at rest is read on every platform without a file appearing beside it", async () => {
  const { rest } = await stores()
  const reader = openReadonly(rest)
  open.push(reader.db)
  expect(reader.db.query("SELECT body FROM note").all()).toEqual([{ body: "kept" }])
  expect(reader.unchanged()).toBe(true)
  expect(await readdir(path.dirname(rest))).toEqual(["store.db"])
})

test("a store at rest that changes during the read is reported, so a copy of it is not trusted", async () => {
  const { rest } = await stores()
  const reader = openReadonly(rest)
  open.push(reader.db)
  reader.db.query("SELECT body FROM note").all()
  // A writer that starts meanwhile and checkpoints rewrites the file, which moves its modification time.
  const later = new Date(Date.now() + 5_000)
  await utimes(rest, later, later)
  expect(reader.unchanged()).toBe(false)
})

test("a writer that starts during an at-rest read is reported before it checkpoints", async () => {
  const { rest } = await stores()
  const reader = openReadonly(rest)
  open.push(reader.db)
  reader.db.query("SELECT body FROM note").all()
  // A WAL writer adds its frames to a new -wal file and leaves the main file as it is until a checkpoint.
  const writer = new Database(rest)
  open.push(writer)
  writer.run("INSERT INTO note VALUES ('new')")
  expect(reader.unchanged()).toBe(false)
})

test("a store in use is read with locks and sees what its writer committed, also only in the WAL", async () => {
  const { live } = await stores()
  // The writer of `stores` stays open: this row exists only in its -wal file, which an immutable read would ignore.
  const writer = new Database(live)
  open.push(writer)
  writer.run("INSERT INTO note VALUES ('in the wal')")
  const reader = openReadonly(live)
  open.push(reader.db)
  expect(reader.db.query("SELECT body FROM note ORDER BY rowid").all()).toEqual([
    { body: "kept" },
    { body: "in the wal" },
  ])
  expect(reader.unchanged()).toBe(true)
})
