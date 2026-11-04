import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { KiloGlobalResilience } from "../src/global-resilience"

const { resolveState, ensureRealDir, markNoIndex, cleanEnv } = KiloGlobalResilience

const skip = process.platform === "win32" || process.getuid?.() === 0

async function tmpdir() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-global-")))
  return {
    path: dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

describe("resolveState", () => {
  test("uses the preferred state directory when available", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    expect(await resolveState(preferred, path.join(tmp.path, "fallback"))).toBe(preferred)
    expect((await fs.stat(preferred)).isDirectory()).toBe(true)
    expect(await fs.readdir(preferred)).toEqual([])
  })

  test("falls back when the default state directory is unusable", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "data", "state")
    await fs.writeFile(preferred, "not a directory")
    expect(await resolveState(preferred, fallback)).toBe(fallback)
    expect((await fs.stat(fallback)).isDirectory()).toBe(true)
  })

  test("keeps using an existing fallback", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "fallback")
    await fs.mkdir(fallback)
    expect(await resolveState(preferred, fallback)).toBe(fallback)
    expect(
      await fs.stat(preferred).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  test.skipIf(skip)("uses the preferred directory when an existing fallback is not writable", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "fallback")
    await fs.mkdir(fallback)
    await fs.chmod(fallback, 0o500)
    try {
      expect(await resolveState(preferred, fallback)).toBe(preferred)
    } finally {
      await fs.chmod(fallback, 0o700)
    }
  })

  test.skipIf(skip)("falls back when the preferred directory cannot be created", async () => {
    await using tmp = await tmpdir()
    const parent = path.join(tmp.path, "preferred")
    const preferred = path.join(parent, "kilo2")
    const fallback = path.join(tmp.path, "data", "state")
    await fs.mkdir(parent)
    await fs.chmod(parent, 0o500)
    try {
      expect(await resolveState(preferred, fallback)).toBe(fallback)
    } finally {
      await fs.chmod(parent, 0o700)
    }
  })

  test.skipIf(skip)("falls back when the preferred directory exists but is not writable", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "data", "state")
    await fs.mkdir(preferred)
    await fs.chmod(preferred, 0o500)
    try {
      expect(await resolveState(preferred, fallback)).toBe(fallback)
    } finally {
      await fs.chmod(preferred, 0o700)
    }
  })

  test("preserves the error for an explicitly configured state directory", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    await fs.writeFile(preferred, "not a directory")
    const err = await resolveState(preferred).catch((error: unknown) => error)
    expect(err).toBeInstanceOf(Error)
  })

  test("reports both paths when the fallback also fails", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "fallback")
    await Promise.all([fs.writeFile(preferred, "not a directory"), fs.writeFile(fallback, "not a directory")])
    const err = await resolveState(preferred, fallback).catch((error: unknown) => error)
    expect(err).toBeInstanceOf(AggregateError)
    if (!(err instanceof AggregateError)) throw err
    expect(err.message).toContain(preferred)
    expect(err.message).toContain(fallback)
    expect(err.errors).toHaveLength(2)
  })
})

describe("ensureRealDir", () => {
  test("creates a missing directory", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "a", "b")
    await ensureRealDir(dir)
    expect((await fs.stat(dir)).isDirectory()).toBe(true)
  })

  test.skipIf(process.platform === "win32")("repairs a symlink/junction whose target is gone", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "gone")
    const link = path.join(tmp.path, "link")
    await fs.mkdir(target)
    await fs.symlink(target, link, "dir")
    await fs.rm(target, { recursive: true, force: true })
    // The link now dangles: mkdir recursive no-ops, so stat (which follows it) fails.
    await ensureRealDir(link)
    expect((await fs.stat(link)).isDirectory()).toBe(true)
    await fs.writeFile(path.join(link, "probe"), "ok")
  })
})

describe("markNoIndex", () => {
  test("writes the Spotlight marker on macOS and is idempotent, no-op elsewhere", async () => {
    await using tmp = await tmpdir()
    await markNoIndex(tmp.path)
    await markNoIndex(tmp.path)
    const marker = path.join(tmp.path, ".metadata_never_index")
    const present = await fs.stat(marker).then(
      () => true,
      () => false,
    )
    expect(present).toBe(process.platform === "darwin")
  })
})

describe("cleanEnv", () => {
  test("strips newlines from HOME and XDG bases and trims the test home", () => {
    const env: Record<string, string | undefined> = {
      HOME: "/Users/me\n",
      XDG_STATE_HOME: "/x/state\r\n",
      XDG_DATA_HOME: "/x/data",
      OPENCODE_TEST_HOME: "  /tmp/test  ",
    }
    cleanEnv(env)
    expect(env.HOME).toBe("/Users/me")
    expect(env.XDG_STATE_HOME).toBe("/x/state")
    expect(env.XDG_DATA_HOME).toBe("/x/data")
    expect(env.OPENCODE_TEST_HOME).toBe("/tmp/test")
  })
})
