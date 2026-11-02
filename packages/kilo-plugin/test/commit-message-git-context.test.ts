import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CommitMessageGit } from "../src/commit-message/git-context"

// A temporary repository with one root commit, removed when the test ends.
async function repo() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-commit-message-")))
  await $`git init -q -b main`.cwd(dir).quiet()
  await $`git config user.email test@example.com`.cwd(dir).quiet()
  await $`git config user.name Test`.cwd(dir).quiet()
  await $`git config commit.gpgsign false`.cwd(dir).quiet()
  await $`git commit -q --allow-empty -m "root commit"`.cwd(dir).quiet()
  return { path: dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) }
}

async function stage(dir: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true })
    await Bun.write(path.join(dir, file), text)
    await $`git add ${file}`.cwd(dir).quiet()
  }
}

describe("commit message git context", () => {
  test("parseNameStatus reads added, modified, deleted and renamed entries", () => {
    expect(CommitMessageGit.parseNameStatus("A\tsrc/new-file.ts")).toEqual([{ status: "A", path: "src/new-file.ts" }])
    expect(CommitMessageGit.parseNameStatus("M\tsrc/existing.ts")).toEqual([{ status: "M", path: "src/existing.ts" }])
    expect(CommitMessageGit.parseNameStatus("D\tsrc/removed.ts")).toEqual([{ status: "D", path: "src/removed.ts" }])
    expect(CommitMessageGit.parseNameStatus("R100\told-name.ts\tnew-name.ts")).toEqual([
      { status: "R100", path: "new-name.ts" },
    ])
    expect(CommitMessageGit.parseNameStatus("M\tsrc/a.ts\nA\tsrc/b.ts").map((entry) => entry.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ])
    expect(CommitMessageGit.parseNameStatus("")).toEqual([])
  })

  test("parsePorcelain reads untracked and modified entries and skips blank lines", () => {
    expect(CommitMessageGit.parsePorcelain("?? src/brand-new.ts")).toEqual([{ status: "??", path: "src/brand-new.ts" }])
    expect(CommitMessageGit.parsePorcelain(" M src/changed.ts")).toEqual([{ status: "M", path: "src/changed.ts" }])
    expect(CommitMessageGit.parsePorcelain("")).toEqual([])
    expect(CommitMessageGit.parsePorcelain("?? a.ts\n\n?? b.ts")).toHaveLength(2)
  })

  test("mapStatus and isUntracked classify git status codes", () => {
    expect(CommitMessageGit.mapStatus("R100")).toBe("renamed")
    expect(CommitMessageGit.mapStatus("R050")).toBe("renamed")
    expect(CommitMessageGit.mapStatus("A")).toBe("added")
    expect(CommitMessageGit.mapStatus("??")).toBe("added")
    expect(CommitMessageGit.mapStatus("?")).toBe("added")
    expect(CommitMessageGit.mapStatus("D")).toBe("deleted")
    expect(CommitMessageGit.mapStatus("M")).toBe("modified")
    expect(CommitMessageGit.mapStatus("X")).toBe("modified")
    expect(CommitMessageGit.isUntracked("??")).toBe(true)
    expect(CommitMessageGit.isUntracked("?")).toBe(true)
    expect(CommitMessageGit.isUntracked("M")).toBe(false)
    expect(CommitMessageGit.isUntracked("A")).toBe(false)
  })

  test("isLockFile detects lock files at any depth only", () => {
    for (const file of ["package-lock.json", "yarn.lock", "packages/api/package-lock.json", "bun.lockb", "go.sum"])
      expect(CommitMessageGit.isLockFile(file)).toBe(true)
    for (const file of ["Cargo.lock", "poetry.lock", "pnpm-lock.yaml"]) expect(CommitMessageGit.isLockFile(file)).toBe(true)
    expect(CommitMessageGit.isLockFile("src/index.ts")).toBe(false)
    expect(CommitMessageGit.isLockFile("README.md")).toBe(false)
  })

  test("staged lock files are left out, also in subdirectories", async () => {
    await using tmp = await repo()
    await stage(tmp.path, {
      "src/index.ts": "console.log('hello')\n",
      "package-lock.json": '{"lockfileVersion": 3}\n',
      "packages/api/package-lock.json": "lock\n",
    })
    expect(CommitMessageGit.getGitContext(tmp.path).files.map((file) => file.path)).toEqual(["src/index.ts"])
  })

  test("staged added, modified and deleted files get their status", async () => {
    await using tmp = await repo()
    await stage(tmp.path, { "src/existing.ts": "original\n", "src/removed.ts": "to delete\n" })
    await $`git commit -q -m "add files"`.cwd(tmp.path).quiet()
    await stage(tmp.path, { "src/existing.ts": "changed\n", "src/new-file.ts": "new content\n" })
    await $`git rm -q src/removed.ts`.cwd(tmp.path).quiet()

    const files = CommitMessageGit.getGitContext(tmp.path).files
    expect(files.map((file) => [file.path, file.status])).toEqual([
      ["src/existing.ts", "modified"],
      ["src/new-file.ts", "added"],
      ["src/removed.ts", "deleted"],
    ])
    expect(files[0]!.diff).toContain("+changed")
  })

  test("staged changes win over unstaged and untracked ones", async () => {
    await using tmp = await repo()
    await stage(tmp.path, { "staged.ts": "staged\n" })
    await Bun.write(path.join(tmp.path, "untracked.ts"), "untracked\n")
    expect(CommitMessageGit.getGitContext(tmp.path).files.map((file) => file.path)).toEqual(["staged.ts"])
  })

  test("without staged changes, unstaged and untracked files are used", async () => {
    await using tmp = await repo()
    await stage(tmp.path, { "tracked.ts": "one\n" })
    await $`git commit -q -m "add"`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "tracked.ts"), "two\n")
    await Bun.write(path.join(tmp.path, "untracked.ts"), "new\n")

    const files = CommitMessageGit.getGitContext(tmp.path).files
    expect(files).toEqual([
      { status: "modified", path: "tracked.ts", diff: expect.stringContaining("+two") },
      { status: "added", path: "untracked.ts", diff: "New untracked file: untracked.ts" },
    ])
  })

  test("binary files get a placeholder instead of a diff", async () => {
    await using tmp = await repo()
    await Bun.write(path.join(tmp.path, "image.bin"), new Uint8Array([0, 1, 2, 0, 255]))
    await $`git add image.bin`.cwd(tmp.path).quiet()
    expect(CommitMessageGit.getGitContext(tmp.path).files[0]!.diff).toBe("Binary file image.bin has been modified")
  })

  test("a diff longer than the limit is truncated", async () => {
    await using tmp = await repo()
    await stage(tmp.path, { "src/big.ts": "original\n" })
    await $`git commit -q -m "add"`.cwd(tmp.path).quiet()
    await stage(tmp.path, { "src/big.ts": "x".repeat(CommitMessageGit.MAX_DIFF_LENGTH + 2000) + "\n" })

    const diff = CommitMessageGit.getGitContext(tmp.path).files[0]!.diff
    expect(diff.endsWith("\n... [truncated]")).toBe(true)
    expect(diff.length).toBe(CommitMessageGit.MAX_DIFF_LENGTH + "\n... [truncated]".length)
  })

  test("selectedFiles keeps only the listed paths", async () => {
    await using tmp = await repo()
    await stage(tmp.path, { "src/a.ts": "a\n", "src/b.ts": "b\n", "src/c.ts": "c\n" })
    expect(CommitMessageGit.getGitContext(tmp.path, ["src/a.ts", "src/c.ts"]).files.map((file) => file.path)).toEqual([
      "src/a.ts",
      "src/c.ts",
    ])
    expect(CommitMessageGit.getGitContext(tmp.path).files).toHaveLength(3)
    expect(CommitMessageGit.getGitContext(tmp.path, ["src/nonexistent.ts"]).files).toEqual([])
  })

  test("the branch and the recent commits come from the repository", async () => {
    await using tmp = await repo()
    await $`git checkout -q -b feature/my-branch`.cwd(tmp.path).quiet()
    await stage(tmp.path, { "a.ts": "a\n" })
    await $`git commit -q -m "second commit"`.cwd(tmp.path).quiet()

    const context = CommitMessageGit.getGitContext(tmp.path)
    expect(context.branch).toBe("feature/my-branch")
    expect(context.recentCommits).toHaveLength(2)
    expect(context.recentCommits[0]).toContain("second commit")
  })
})
