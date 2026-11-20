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

test("every distribution channel selects the stable kilo.db", async () => {
  const dir = await data()
  const file = (channel: string, env: Record<string, string | undefined> = {}) =>
    KiloDatabase.select(env, { data: dir, channel })
  expect(await file("latest")).toBe(path.join(dir, "kilo.db"))
  expect(await file("beta")).toBe(path.join(dir, "kilo.db"))
  expect(await file("v2")).toBe(path.join(dir, "kilo.db"))
  expect(await file("local")).toBe(path.join(dir, "kilo.db"))
  expect(await file("feat/x y")).toBe(path.join(dir, "kilo.db"))
  expect(await file("v2", { KILO_DISABLE_CHANNEL_DB: "true" })).toBe(path.join(dir, "kilo.db"))
})

test("KILO_DB and the file of a parent process win, and the choice reaches OPENCODE_DB", async () => {
  const dir = await data()
  const selected = path.join(dir, "custom", "sessions.db")
  const env = { KILO_DB: selected, OPENCODE_DB: path.join(dir, "inherited.db") }
  translate(env)
  expect(await KiloDatabase.select(env, { data: dir, channel: "v2" })).toBe(selected)
  expect(env.OPENCODE_DB).toBe(selected)

  const parent: Record<string, string | undefined> = {}
  await KiloDatabase.select(parent, { data: dir, channel: "v2" })
  expect(parent.OPENCODE_DB).toBe(path.join(dir, "kilo.db"))
  const child = { ...parent }
  expect(await KiloDatabase.select(child, { data: dir, channel: "local" })).toBe(parent.OPENCODE_DB!)
})
