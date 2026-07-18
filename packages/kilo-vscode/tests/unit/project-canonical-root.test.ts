import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as fsp from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { execSync } from "node:child_process"
import { canonicalRoot, NotAGitRepositoryError } from "../../src/agent-manager/project-canonical-root"

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kilo-canonical-root-"))
}

function git(cwd: string, ...args: string[]): string {
  return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
}

let root: string

beforeEach(() => {
  root = tmp()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe("canonicalRoot", () => {
  test("returns the realpath of the git top-level for a path inside a fresh repo", async () => {
    git(root, "init", "--quiet", "--initial-branch=main")
    const subdir = path.join(root, "sub", "deep")
    fs.mkdirSync(subdir, { recursive: true })
    const want = await fsp.realpath(root)
    expect(await canonicalRoot(subdir)).toBe(want)
  })

  test("throws NotAGitRepositoryError for a directory that is not a git repo", async () => {
    let caught: unknown
    try {
      await canonicalRoot(root)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(NotAGitRepositoryError)
  })

  test("resolves symlinks: returns the realpath, not the symlinked path", async () => {
    git(root, "init", "--quiet", "--initial-branch=main")
    const target = path.join(root, "real")
    fs.mkdirSync(target, { recursive: true })
    const linkDir = path.join(root, "linkdir")
    try {
      fs.symlinkSync(target, linkDir, "dir")
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EPERM" || (err as NodeJS.ErrnoException).code === "EACCES") return
      throw err
    }
    const want = await fsp.realpath(root)
    expect(await canonicalRoot(linkDir)).toBe(want)
  })

  test("accepts a relative path and resolves it against the current working directory", async () => {
    git(root, "init", "--quiet", "--initial-branch=main")
    const subdir = path.join(root, "sub")
    fs.mkdirSync(subdir, { recursive: true })
    const want = await fsp.realpath(root)
    const previous = process.cwd()
    process.chdir(root)
    try {
      expect(await canonicalRoot("sub")).toBe(want)
    } finally {
      process.chdir(previous)
    }
  })

  test("returns the same canonical root for every subdirectory in a repo", async () => {
    git(root, "init", "--quiet", "--initial-branch=main")
    const a = path.join(root, "a")
    const b = path.join(root, "b", "c")
    fs.mkdirSync(a, { recursive: true })
    fs.mkdirSync(b, { recursive: true })
    const want = await fsp.realpath(root)
    expect(await canonicalRoot(a)).toBe(want)
    expect(await canonicalRoot(b)).toBe(want)
  })
})
