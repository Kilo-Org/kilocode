import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "fs/promises"
import { hostname, tmpdir } from "os"
import path from "path"
import { createHash } from "crypto"
import { acquire } from "../../../src/indexing/writer-lock"

const WS = "/tmp/workspace-under-test"

let dir: string

function slot(): string {
  return path.join(dir, "locks", createHash("sha256").update(WS).digest("hex").substring(0, 16))
}

async function meta(): Promise<{ token: string; pid: number; host: string; at: string }> {
  return JSON.parse(await readFile(path.join(slot(), "meta.json"), "utf-8"))
}

async function plant(owner: { token: string; pid: number; host: string }, beat = false): Promise<void> {
  await mkdir(slot(), { recursive: true })
  await writeFile(path.join(slot(), "meta.json"), JSON.stringify({ ...owner, at: new Date().toISOString() }))
  if (!beat) return
  await writeFile(path.join(slot(), "heartbeat"), "")
  const when = new Date(Date.now() - 120_000)
  await utimes(path.join(slot(), "heartbeat"), when, when)
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "writer-lock-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("writer lock", () => {
  test("grants the lock once and refuses a second holder", async () => {
    const first = await acquire(dir, WS)
    expect(first).toBeDefined()
    expect(await acquire(dir, WS)).toBeUndefined()
    await first?.release()
  })

  test("grants the lock again after release", async () => {
    const first = await acquire(dir, WS)
    await first?.release()
    expect(await acquire(dir, WS)).toBeDefined()
  })

  test("scopes the lock to the workspace", async () => {
    const first = await acquire(dir, WS)
    expect(await acquire(dir, "/tmp/some-other-workspace")).toBeDefined()
    await first?.release()
  })

  test("records the owning process", async () => {
    const writer = await acquire(dir, WS)
    expect((await meta()).pid).toBe(process.pid)
    await writer?.release()
  })

  test("reports ownership only while the lock still belongs to this writer", async () => {
    const writer = await acquire(dir, WS)
    expect(await writer?.owned()).toBe(true)

    // A takeover rewrites the metadata; the cached writer must notice instead
    // of continuing to write the store as if the lock were still its own.
    const current = await meta()
    await writeFile(path.join(slot(), "meta.json"), JSON.stringify({ ...current, token: "rival" }))
    expect(await writer?.owned()).toBe(false)
    await writer?.release()
  })

  test("takes over a lock whose heartbeat stopped", async () => {
    await plant({ token: "dead", pid: process.pid, host: "elsewhere" }, true)

    const writer = await acquire(dir, WS)
    expect(writer).toBeDefined()
    expect((await meta()).token).not.toBe("dead")
    await writer?.release()
  })

  test("takes over a lock whose local owner is gone", async () => {
    await plant({ token: "dead", pid: 2 ** 30, host: hostname() })

    const writer = await acquire(dir, WS)
    expect(writer).toBeDefined()
    expect((await meta()).token).not.toBe("dead")
    await writer?.release()
  })

  test("leaves a fresh lock held by a live owner alone", async () => {
    await plant({ token: "live", pid: process.pid, host: hostname() })
    expect(await acquire(dir, WS)).toBeUndefined()
  })

  test("refuses to release a lock that was taken over", async () => {
    const first = await acquire(dir, WS)
    await rm(slot(), { recursive: true, force: true })
    const second = await acquire(dir, WS)
    const token = (await meta()).token

    await first?.release()
    expect((await meta()).token).toBe(token)
    await second?.release()
  })

  test("reclaims a vanished lock directory instead of wedging", async () => {
    const first = await acquire(dir, WS)
    expect(first).toBeDefined()
    // Winner reclaimed the stale directory out from under a racing claim:
    // the loser must fall through to claiming, not report held-forever.
    await rm(slot(), { recursive: true, force: true })
    const second = await acquire(dir, WS)
    expect(second).toBeDefined()
    await second?.release()
  })

  test("a stale release never deletes the current lock directory", async () => {
    const first = await acquire(dir, WS)
    expect(first).toBeDefined()
    // The first owner's directory vanished (taken over); a second session now
    // owns the slot. The first owner's release must leave it alone.
    await rm(slot(), { recursive: true, force: true })
    const second = await acquire(dir, WS)
    const token = (await meta()).token

    await first?.release()
    expect((await meta()).token).toBe(token)
    expect((await readdir(slot())).sort()).toEqual(["heartbeat", "meta.json"])
    await second?.release()
  })
})
