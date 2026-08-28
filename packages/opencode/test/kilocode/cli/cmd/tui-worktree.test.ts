import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../../../fixture/fixture"
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
  test("appends the exclude entry when the file exists but is empty", async () => {
    await using tmp = await tmpdir({ git: true })
    const excludePath = path.join(tmp.path, ".git", "info", "exclude")
    await Filesystem.write(excludePath, "")
    await ensureGitExclude(tmp.path)
    expect(await Filesystem.readText(excludePath)).toContain(".kilo/worktrees/")
  })

  test("preserves existing content and adds a newline before the new entry", async () => {
    await using tmp = await tmpdir({ git: true })
    const excludePath = path.join(tmp.path, ".git", "info", "exclude")
    await Filesystem.write(excludePath, "*.log")
    await ensureGitExclude(tmp.path)
    const content = await Filesystem.readText(excludePath)
    expect(content).toContain("*.log")
    expect(content).toContain(".kilo/worktrees/")
  })

  test("is idempotent when the entry already exists", async () => {
    await using tmp = await tmpdir({ git: true })
    const excludePath = path.join(tmp.path, ".git", "info", "exclude")
    await Filesystem.write(excludePath, "")
    await ensureGitExclude(tmp.path)
    await ensureGitExclude(tmp.path)
    const content = await Filesystem.readText(excludePath)
    expect(content.match(/\.kilo\/worktrees\//g)?.length).toBe(1)
  })

  test("does not throw when .git/info is missing", async () => {
    await using tmp = await tmpdir()
    await ensureGitExclude(tmp.path)
  })
})
