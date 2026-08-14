import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { resolveState } from "@opencode-ai/core/kilocode/global"
import { tmpdir } from "../fixture/tmpdir"

const skip = process.platform === "win32" || process.getuid?.() === 0

describe("global state directory", () => {
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
    const preferred = path.join(parent, "kilo")
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

  test("preserves errors for explicitly configured state directories", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    await fs.writeFile(preferred, "not a directory")

    const err = await resolveState(preferred).catch((err: unknown) => err)
    expect(err).toBeInstanceOf(Error)
  })

  test("reports both paths when the fallback also fails", async () => {
    await using tmp = await tmpdir()
    const preferred = path.join(tmp.path, "preferred")
    const fallback = path.join(tmp.path, "fallback")
    await Promise.all([fs.writeFile(preferred, "not a directory"), fs.writeFile(fallback, "not a directory")])

    const err = await resolveState(preferred, fallback).catch((err: unknown) => err)
    expect(err).toBeInstanceOf(AggregateError)
    if (!(err instanceof AggregateError)) throw err
    expect(err.message).toContain(preferred)
    expect(err.message).toContain(fallback)
    expect(err.errors).toHaveLength(2)
  })
})
