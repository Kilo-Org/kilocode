import { describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { Filesystem } from "../../src/util/filesystem"

describe("util.filesystem", () => {
  test("exists() is true for files and directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.exists(dir), Filesystem.exists(file), Filesystem.exists(missing)])

    expect(cases).toEqual([true, true, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test("isDir() is true only for directories", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "opencode-filesystem-"))
    const dir = path.join(tmp, "dir")
    const file = path.join(tmp, "file.txt")
    const missing = path.join(tmp, "missing")

    await mkdir(dir, { recursive: true })
    await Bun.write(file, "hello")

    const cases = await Promise.all([Filesystem.isDir(dir), Filesystem.isDir(file), Filesystem.isDir(missing)])

    expect(cases).toEqual([true, false, false])

    await rm(tmp, { recursive: true, force: true })
  })

  test.skipIf(process.platform !== "win32")("normalize() converts paths to posix format", () => {
    expect(Filesystem.normalize("C:\\Users\\test\\file.txt")).toBe("C:/Users/test/file.txt")
    expect(Filesystem.normalize("/unix/path/file.txt")).toBe("/unix/path/file.txt")
    expect(Filesystem.normalize("relative\\path\\file.txt")).toBe("relative/path/file.txt")
  })

  test.skipIf(process.platform !== "win32")("relative() returns posix-style relative paths", () => {
    const from = "C:\\Users\\test\\project"
    const to = "C:\\Users\\test\\project\\src\\file.txt"
    expect(Filesystem.relative(from, to)).toBe("src/file.txt")
  })

  test.skipIf(process.platform !== "win32")("join() produces posix-style paths", () => {
    expect(Filesystem.join("C:\\Users", "test", "file.txt")).toBe("C:/Users/test/file.txt")
    expect(Filesystem.join("/unix", "path", "file.txt")).toBe("/unix/path/file.txt")
  })

  test.skipIf(process.platform !== "win32")("dirname() returns posix-style directory", () => {
    expect(Filesystem.dirname("C:\\Users\\test\\file.txt")).toBe("C:/Users/test")
    expect(Filesystem.dirname("/unix/path/file.txt")).toBe("/unix/path")
  })

  test.skipIf(process.platform !== "win32")("contains() checks if path is within directory", () => {
    const dir = "C:\\Users\\test\\project"
    const inside = "C:\\Users\\test\\project\\src\\file.txt"
    const outside = "C:\\Users\\other\\file.txt"

    expect(Filesystem.contains(dir, inside)).toBe(true)
    expect(Filesystem.contains(dir, outside)).toBe(false)
    expect(Filesystem.contains(dir, dir)).toBe(true)
  })
})
