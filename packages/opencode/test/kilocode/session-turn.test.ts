import path from "path"
import os from "os"
import fs from "fs/promises"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import { KiloSessionTurn } from "../../src/kilocode/session/turn"
import { SessionID } from "../../src/session/schema"

// Markers are the on-disk contract between Kilo processes, so these tests write them the way another process does.
const dir = path.join(Global.Path.state, "session-turn")

async function marker(id: SessionID, pid: number, host: string, age = 0) {
  const file = path.join(dir, `${id}.${pid}`)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(file, host)
  const time = new Date(Date.now() - age)
  await fs.utimes(file, time, time)
  return file
}

const exists = (file: string) =>
  fs.stat(file).then(
    () => true,
    () => false,
  )

describe("KiloSessionTurn.foreign", () => {
  test("counts a refreshed marker from another host as live", async () => {
    const id = SessionID.descending()
    const file = await marker(id, process.pid, "other-host")

    expect(await Effect.runPromise(KiloSessionTurn.foreign(id))).toBe(true)
    expect(await exists(file)).toBe(true)
    await fs.rm(file)
  })

  test("removes a marker that another host stopped refreshing", async () => {
    const id = SessionID.descending()
    const file = await marker(id, 4242, "other-host", 5 * 60_000)

    expect(await Effect.runPromise(KiloSessionTurn.foreign(id))).toBe(false)
    expect(await exists(file)).toBe(false)
  })

  test("keeps a marker of a live process on this host across a suspend", async () => {
    const id = SessionID.descending()
    // The parent of the test runner is alive; an old mtime stands in for a suspend and resume.
    const file = await marker(id, process.ppid, os.hostname(), 5 * 60_000)

    expect(await Effect.runPromise(KiloSessionTurn.foreign(id))).toBe(true)
    await fs.rm(file)
  })

  test("removes a local marker unrefreshed for days even when its pid is alive again", async () => {
    const id = SessionID.descending()
    const file = await marker(id, process.ppid, os.hostname(), 3 * 24 * 60 * 60_000)

    expect(await Effect.runPromise(KiloSessionTurn.foreign(id))).toBe(false)
    expect(await exists(file)).toBe(false)
  })

  test("sweeps stale markers of other sessions and ignores their live markers", async () => {
    const id = SessionID.descending()
    const stale = await marker(SessionID.descending(), 4242, "other-host", 5 * 60_000)
    const live = await marker(SessionID.descending(), 4242, "other-host")

    expect(await Effect.runPromise(KiloSessionTurn.foreign(id))).toBe(false)
    expect(await exists(stale)).toBe(false)
    expect(await exists(live)).toBe(true)
    await fs.rm(live)
  })
})
