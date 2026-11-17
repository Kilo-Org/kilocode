import { expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { importV1, summarize, v1Store } from "../src/import-v1"

it("runs the server command with the import arguments instead of serve", async () => {
  const script = "console.log(JSON.stringify([process.argv.slice(1), process.env.KILO_V2_PROFILE]))"
  const result = await importV1({
    command: {
      cmd: process.execPath,
      args: ["-e", script, "serve", "--port", "0", "--stdio"],
      env: { KILO_V2_PROFILE: "p" },
    },
    cwd: process.cwd(),
    env: process.env,
    days: 14,
    log: () => undefined,
  })
  expect(result.ok).toBe(true)
  expect(JSON.parse(result.output)).toEqual([["import", "v1", "--since", "14d", "--config"], "p"])
})

it("reads the counts from the import output", () => {
  const output = [
    "Copied the Kilo v1 config kilo.jsonc, skills, agent from /home/u/.config/kilo to /home/u/.config/kilo2.",
    "Importing the Kilo v1 sessions of /home/u/.local/share/kilo/kilo.db into /home/u/.local/share/kilo2/kilo2.db",
    "Imported 642 new Kilo v1 sessions (updated since 2026-10-30) from a to b in 48299 ms.",
  ].join("\n")
  expect(summarize(output)).toEqual({ sessions: 642, config: ["kilo.jsonc", "skills", "agent"] })
  expect(summarize("No Kilo v1 config to copy from x.\nImported 0 new Kilo v1 sessions")).toEqual({
    sessions: 0,
    config: [],
  })
})

it("finds the v1 store in the XDG data directory, then in the home default", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kilo-v1-store-"))
  const home = path.join(dir, "home")
  expect(v1Store({ XDG_DATA_HOME: dir }, home)).toBeUndefined()
  await mkdir(path.join(home, ".local", "share", "kilo"), { recursive: true })
  await writeFile(path.join(home, ".local", "share", "kilo", "kilo.db"), "")
  expect(v1Store({ XDG_DATA_HOME: dir }, home)).toBe(path.join(home, ".local", "share", "kilo", "kilo.db"))
  await mkdir(path.join(dir, "kilo"))
  await writeFile(path.join(dir, "kilo", "kilo.db"), "")
  expect(v1Store({ XDG_DATA_HOME: dir }, home)).toBe(path.join(dir, "kilo", "kilo.db"))
  await rm(dir, { recursive: true, force: true })
})

it("stops the import when the signal aborts", async () => {
  const abort = new AbortController()
  const started = Date.now()
  const result = importV1({
    command: { cmd: process.execPath, args: ["-e", "setTimeout(() => {}, 60_000)", "serve"], env: {} },
    cwd: process.cwd(),
    env: process.env,
    days: 14,
    log: () => undefined,
    signal: abort.signal,
  })
  setTimeout(() => abort.abort(), 200)
  expect((await result).ok).toBe(false)
  expect(Date.now() - started).toBeLessThan(10_000)
})
