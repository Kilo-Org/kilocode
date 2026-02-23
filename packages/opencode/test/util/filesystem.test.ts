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

  test("normalizeGitPath handles Git Bash drive-prefixed paths on Windows", () => {
    const result = Filesystem.normalizeGitPath("/d/workspaces/repo", "C:\\code", "win32")
    expect(result).toBe("D:\\workspaces\\repo")
  })

  test("normalizeGitPath resolves relative Windows paths against cwd", () => {
    const result = Filesystem.normalizeGitPath("..\\shared\\.git", "C:\\work\\repo", "win32")
    expect(result).toBe(path.win32.resolve("C:\\work\\repo", "..\\shared\\.git"))
  })

  test("normalizeGitPath resolves non-Windows paths with path.resolve", () => {
    const result = Filesystem.normalizeGitPath("../.git", "/home/user/repo", "linux")
    expect(result).toBe(path.resolve("/home/user/repo", "../.git"))
  })
})
