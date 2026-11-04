import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloDatabase } from "../src/database"
import { translate } from "../src/env"

const dirs: string[] = []
afterEach(() => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))))

async function data() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-database-"))
  dirs.push(dir)
  return dir
}

test("the Kilo channel names the file: release channels share kilo2.db, others get their own", async () => {
  const dir = await data()
  const file = (channel: string, env: Record<string, string | undefined> = {}) =>
    KiloDatabase.select(env, { data: dir, channel })
  expect(await file("latest")).toBe(path.join(dir, "kilo2.db"))
  expect(await file("beta")).toBe(path.join(dir, "kilo2.db"))
  expect(await file("v2")).toBe(path.join(dir, "kilo2-v2.db"))
  expect(await file("local")).toBe(path.join(dir, "kilo2-local.db"))
  expect(await file("feat/x y")).toBe(path.join(dir, "kilo2-feat-x-y.db"))
  expect(await file("v2", { KILO_DISABLE_CHANNEL_DB: "true" })).toBe(path.join(dir, "kilo2.db"))
})

test("KILO2_DB and the file of a parent process win, and the choice reaches OPENCODE_DB", async () => {
  const dir = await data()
  const env: Record<string, string | undefined> = { KILO2_DB: "/custom/sessions.db" }
  translate(env)
  expect(await KiloDatabase.select(env, { data: dir, channel: "v2" })).toBe("/custom/sessions.db")

  const parent: Record<string, string | undefined> = {}
  await KiloDatabase.select(parent, { data: dir, channel: "v2" })
  expect(parent.OPENCODE_DB).toBe(path.join(dir, "kilo2-v2.db"))
  const child = { ...parent }
  expect(await KiloDatabase.select(child, { data: dir, channel: "local" })).toBe(parent.OPENCODE_DB!)
})

test("the database of an earlier build is copied once, with the pages still in its WAL", async () => {
  const dir = await data()
  const legacy = path.join(dir, "opencode-v2.db")
  // An open connection keeps the last write in the WAL, as a running server of the earlier build does.
  const old = new Database(legacy)
  old.run("PRAGMA journal_mode = WAL")
  old.run("PRAGMA wal_autocheckpoint = 0")
  old.run("CREATE TABLE session (id TEXT)")
  old.run("INSERT INTO session VALUES ('ses_old')")
  try {
    const file = await KiloDatabase.select({}, { data: dir, channel: "v2" })
    expect(file).toBe(path.join(dir, "kilo2-v2.db"))
    const copy = new Database(file, { readonly: true })
    expect(copy.query("SELECT id FROM session").all()).toEqual([{ id: "ses_old" }])
    copy.close()

    // The copy happens once: later writes to the old file do not reach the Kilo file.
    old.run("INSERT INTO session VALUES ('ses_later')")
    await KiloDatabase.select({}, { data: dir, channel: "v2" })
    const again = new Database(file, { readonly: true })
    expect(again.query("SELECT id FROM session").all()).toEqual([{ id: "ses_old" }])
    again.close()
  } finally {
    old.close()
  }
  expect(new Database(legacy, { readonly: true }).query("SELECT count(*) AS n FROM session").get()).toEqual({ n: 2 })
})

test("release channels and KILO_DISABLE_CHANNEL_DB copy the earlier shared file", async () => {
  const dir = await data()
  const old = new Database(path.join(dir, "opencode.db"))
  old.run("CREATE TABLE session (id TEXT)")
  old.run("INSERT INTO session VALUES ('ses_shared')")
  old.close()
  const file = await KiloDatabase.select({}, { data: dir, channel: "latest" })
  const copy = new Database(file, { readonly: true })
  expect(copy.query("SELECT id FROM session").all()).toEqual([{ id: "ses_shared" }])
  copy.close()
})

test("an unreadable earlier file leaves a new database and no stray copy", async () => {
  const dir = await data()
  await Bun.write(path.join(dir, "opencode-v2.db"), "not a database")
  const file = await KiloDatabase.select({}, { data: dir, channel: "v2" })
  expect(await Bun.file(file).exists()).toBe(false)
  expect((await Array.fromAsync(new Bun.Glob("*.adopt").scan(dir))).length).toBe(0)
})
