import { describe, expect, test } from "bun:test"
import path from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir as osTmpdir } from "os"
import { ensureGitExclude, slugify } from "@/kilocode/cli/cmd/tui-worktree"
import { Filesystem } from "@/util/filesystem"

describe("slugify", () => {
  test("lowercases and dashes non-alphanumeric runs", () => {
    expect(slugify("My Feature!")).toBe("my-feature")
    expect(slugify("fix_bug--123")).toBe("fix-bug-123")
  })

  test("trims leading/trailing dashes", () => {
    expect(slugify("--hello--")).toBe("hello")
  })

  test("returns empty for names with no alphanumeric characters", () => {
    expect(slugify("!!!")).toBe("")
    expect(slugify("   ")).toBe("")
  })
})

describe("ensureGitExclude", () => {
  async function withRepo(fn: (root: string) => Promise<void>) {
    const root = await mkdtemp(path.join(osTmpdir(), "tui-worktree-exclude-"))
    try {
      await fn(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }

  test("appends the exclude entry when the file exists but is empty", () =>
    withRepo(async (root) => {
      const excludePath = path.join(root, ".git", "info", "exclude")
      await Filesystem.write(excludePath, "")
      await ensureGitExclude(root)
      const content = await Filesystem.readText(excludePath)
      expect(content).toContain(".kilo/worktrees/")
    }))

  test("preserves existing content and adds a newline before the new entry", () =>
    withRepo(async (root) => {
      const excludePath = path.join(root, ".git", "info", "exclude")
      await Filesystem.write(excludePath, "*.log")
      await ensureGitExclude(root)
      const content = await Filesystem.readText(excludePath)
      expect(content).toContain("*.log")
      expect(content).toContain(".kilo/worktrees/")
    }))

  test("is idempotent when the entry already exists", () =>
    withRepo(async (root) => {
      const excludePath = path.join(root, ".git", "info", "exclude")
      await Filesystem.write(excludePath, "")
      await ensureGitExclude(root)
      await ensureGitExclude(root)
      const content = await Filesystem.readText(excludePath)
      expect(content.match(/\.kilo\/worktrees\//g)?.length).toBe(1)
    }))

  test("does not throw when .git/info is missing", () =>
    withRepo(async (root) => {
      await ensureGitExclude(root)
    }))
})
