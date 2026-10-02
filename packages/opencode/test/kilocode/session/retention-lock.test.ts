import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, utimes, writeFile, mkdir } from "fs/promises"
import os from "os"
import path from "path"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"

const key = "session-retention"
const day = 24 * 60 * 60_000
const opts = { owner: true, staleMs: day, timeoutMs: 150, baseDelayMs: 10, maxDelayMs: 10 }

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "retention-lock-"))
  const lock = path.join(dir, Hash.fast(key) + ".lock")
  return {
    dir,
    lock,
    meta: path.join(lock, "meta.json"),
    heartbeat: path.join(lock, "heartbeat"),
    async [Symbol.asyncDispose]() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

async function holder(dir: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `import { Flock } from "@opencode-ai/core/util/flock"
       await Flock.acquire(${JSON.stringify(key)}, { dir: ${JSON.stringify(dir)}, staleMs: ${day} })
       process.stdout.write("ready\\n")
       Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)`,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true },
  )
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
  try {
    const ready = await child.stdout.getReader().read()
    expect(new TextDecoder().decode(ready.value)).toBe("ready\n")
  } catch (err) {
    child.kill("SIGKILL")
    await child.exited
    throw err
  } finally {
    clearTimeout(timer)
  }
  return {
    pid: child.pid,
    async [Symbol.asyncDispose]() {
      if (child.exitCode === null) child.kill("SIGKILL")
      await child.exited
    },
  }
}

async function expired(file: string) {
  const old = new Date(Date.now() - 2 * day)
  await utimes(file, old, old)
}

describe("session retention owner lock", () => {
  test("recovers a killed same-host owner before the 24-hour stale horizon", async () => {
    await using tmp = await fixture()
    await using child = await holder(tmp.dir)
    const before = JSON.parse(await readFile(tmp.meta, "utf8"))
    expect(before.pid).toBe(child.pid)
    expect(before.hostname).toBe(os.hostname())
    await child[Symbol.asyncDispose]()
    expect(Date.now() - (await stat(tmp.heartbeat)).mtimeMs).toBeLessThan(day)

    // Existing callers must still wait for heartbeat expiry, even after owner death.
    await expect(
      Flock.acquire(key, { dir: tmp.dir, staleMs: day, timeoutMs: 150, baseDelayMs: 10, maxDelayMs: 10 }),
    ).rejects.toThrow("Timed out waiting for lock")
    await using lease = await Flock.acquire(key, { ...opts, dir: tmp.dir })
    expect(JSON.parse(await readFile(tmp.meta, "utf8"))).toMatchObject({ pid: process.pid })
    expect(JSON.parse(await readFile(tmp.meta, "utf8")).token).not.toBe(before.token)
  })

  test("does not evict a live owner with a fresh heartbeat", async () => {
    await using tmp = await fixture()
    await using child = await holder(tmp.dir)
    const before = await readFile(tmp.meta, "utf8")
    await expect(Flock.acquire(key, { ...opts, dir: tmp.dir })).rejects.toThrow("Timed out waiting for lock")
    expect(await readFile(tmp.meta, "utf8")).toBe(before)
    process.kill(child.pid, 0)
  })

  test("recovers an expired lock whose PID was reused by a live process", async () => {
    await using tmp = await fixture()
    await using child = await holder(tmp.dir)
    await child[Symbol.asyncDispose]()
    const meta = { ...JSON.parse(await readFile(tmp.meta, "utf8")), pid: process.pid }
    await writeFile(tmp.meta, JSON.stringify(meta))
    await expired(tmp.heartbeat)
    await using lease = await Flock.acquire(key, { ...opts, dir: tmp.dir })
    expect(JSON.parse(await readFile(tmp.meta, "utf8")).token).not.toBe(meta.token)
  })

  test("respects the atomic breaker claim during dead-owner recovery", async () => {
    await using tmp = await fixture()
    await using child = await holder(tmp.dir)
    await child[Symbol.asyncDispose]()
    const before = await readFile(tmp.meta, "utf8")
    const breaker = tmp.lock + ".breaker"
    await mkdir(breaker)
    await expect(Flock.acquire(key, { ...opts, dir: tmp.dir })).rejects.toThrow("Timed out waiting for lock")
    expect(await readFile(tmp.meta, "utf8")).toBe(before)
    await rm(breaker, { recursive: true })
    await using lease = await Flock.acquire(key, { ...opts, dir: tmp.dir })
  })

  test("preserves mutual exclusion when contenders recover the same dead owner", async () => {
    await using tmp = await fixture()
    await using child = await holder(tmp.dir)
    await child[Symbol.asyncDispose]()
    let active = 0
    let completed = 0
    await Promise.all(
      Array.from({ length: 4 }, () =>
        Flock.withLock(
          key,
          async () => {
            active += 1
            expect(active).toBe(1)
            await Bun.sleep(10)
            active -= 1
            completed += 1
          },
          { ...opts, dir: tmp.dir, timeoutMs: 1_000 },
        ),
      ),
    )
    expect(completed).toBe(4)
    expect(active).toBe(0)
  })

  test("uses timestamp recovery for an expired lock with unknown metadata", async () => {
    await using tmp = await fixture()
    await mkdir(tmp.lock)
    await writeFile(tmp.meta, "not json")
    await expired(tmp.meta)
    await using lease = await Flock.acquire(key, { ...opts, dir: tmp.dir })
  })

  for (const [name, value] of [
    ["foreign host", { hostname: os.hostname() + "-foreign" }],
    ["missing host", { hostname: undefined }],
    ["missing token", { token: undefined }],
    ["empty token", { token: "" }],
    ["missing PID", { pid: undefined }],
    ["string PID", { pid: "1" }],
    ["zero PID", { pid: 0 }],
    ["negative PID", { pid: -1 }],
    ["fractional PID", { pid: 1.5 }],
  ] as const) {
    test(`does not recover a fresh lock with ${name}`, async () => {
      await using tmp = await fixture()
      await using child = await holder(tmp.dir)
      await child[Symbol.asyncDispose]()
      const meta = { ...JSON.parse(await readFile(tmp.meta, "utf8")), ...value }
      const before = JSON.stringify(meta)
      await writeFile(tmp.meta, before)
      await expect(Flock.acquire(key, { ...opts, dir: tmp.dir })).rejects.toThrow("Timed out waiting for lock")
      expect(await readFile(tmp.meta, "utf8")).toBe(before)
    })
  }

  test("does not recover fresh missing or malformed metadata", async () => {
    await using tmp = await fixture()
    await mkdir(tmp.lock)
    await expect(Flock.acquire(key, { ...opts, dir: tmp.dir })).rejects.toThrow("Timed out waiting for lock")
    await writeFile(tmp.meta, "not json")
    await expect(Flock.acquire(key, { ...opts, dir: tmp.dir })).rejects.toThrow("Timed out waiting for lock")
    expect(await readFile(tmp.meta, "utf8")).toBe("not json")
  })

  test("uses lock age when the PID probe has an unknown error", async () => {
    await using tmp = await fixture()
    await mkdir(tmp.lock)
    // A PID outside the OS argument range causes a real probe error, not ESRCH.
    const meta = JSON.stringify({ pid: 2 ** 40, hostname: os.hostname(), token: "unknown" })
    await writeFile(tmp.meta, meta)
    await expect(Flock.acquire(key, { ...opts, dir: tmp.dir })).rejects.toThrow("Timed out waiting for lock")
    expect(await readFile(tmp.meta, "utf8")).toBe(meta)
    await expired(tmp.meta)
    await using lease = await Flock.acquire(key, { ...opts, dir: tmp.dir })
  })
})
