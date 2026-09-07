// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { SecurityRealpath } from "@/kilocode/security-decision/realpath"

/**
 * Filesystem identity for the security layer. The pure core never touches the filesystem, so the
 * real target is resolved once, here, before the decision runs. A path that cannot be determined
 * resolves to `undefined`, which the adapter turns into an unknown target — an ask, never a pass.
 */

const withRepo = (fn: (repo: string) => Promise<void>) => async () => {
  const repo = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "kilo-realpath-"))
  try {
    await fn(repo)
  } finally {
    await fs.rm(repo, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === "win32")("SecurityRealpath.of", () => {
  test(
    "an existing file resolves to itself",
    withRepo(async (repo) => {
      await fs.writeFile(path.join(repo, "a.ts"), "x")
      expect(await SecurityRealpath.of("a.ts", repo)).toBe(path.join(repo, "a.ts"))
    }),
  )

  test(
    "a symlink resolves to its target",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.writeFile(path.join(repo, ".git/hooks/pre-commit"), "#!/bin/sh")
      await fs.symlink(path.join(repo, ".git/hooks/pre-commit"), path.join(repo, "foo"))
      expect(await SecurityRealpath.of("foo", repo)).toBe(path.join(repo, ".git/hooks/pre-commit"))
    }),
  )

  test(
    "a symlink whose target does not exist yet still resolves to that target",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.symlink(".git/hooks/pre-commit", path.join(repo, "foo"))
      expect(await SecurityRealpath.of("foo", repo)).toBe(path.join(repo, ".git/hooks/pre-commit"))
    }),
  )

  test(
    "a symlinked parent directory is resolved through",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.symlink(path.join(repo, ".git"), path.join(repo, "link"))
      expect(await SecurityRealpath.of("link/hooks/pre-commit", repo)).toBe(path.join(repo, ".git/hooks/pre-commit"))
    }),
  )

  test(
    "a new file in an existing directory keeps its own path",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, "src"), { recursive: true })
      expect(await SecurityRealpath.of("src/new.ts", repo)).toBe(path.join(repo, "src/new.ts"))
    }),
  )

  test(
    "a new file under directories that do not exist yet keeps its own path",
    withRepo(async (repo) => {
      expect(await SecurityRealpath.of("a/b/c.ts", repo)).toBe(path.join(repo, "a/b/c.ts"))
    }),
  )

  test(
    "a symlink pointing outside the workspace resolves outside it",
    withRepo(async (repo) => {
      const outside = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), "kilo-outside-"))
      try {
        await fs.writeFile(path.join(outside, "id_rsa"), "key")
        await fs.symlink(path.join(outside, "id_rsa"), path.join(repo, "notes.md"))
        expect(await SecurityRealpath.of("notes.md", repo)).toBe(path.join(outside, "id_rsa"))
      } finally {
        await fs.rm(outside, { recursive: true, force: true })
      }
    }),
  )

  test(
    "an absolute pattern is respected",
    withRepo(async (repo) => {
      await fs.writeFile(path.join(repo, "a.ts"), "x")
      expect(await SecurityRealpath.of(path.join(repo, "a.ts"), repo)).toBe(path.join(repo, "a.ts"))
    }),
  )

  test(
    "a chained symlink follows to the final target",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.symlink(".git/hooks/pre-commit", path.join(repo, "one"))
      await fs.symlink("one", path.join(repo, "two"))
      expect(await SecurityRealpath.of("two", repo)).toBe(path.join(repo, ".git/hooks/pre-commit"))
    }),
  )

  test(
    "an unresolvable root reports nothing rather than guessing",
    withRepo(async () => {
      expect(await SecurityRealpath.of("", "")).toBeUndefined()
    }),
  )

  test(
    "all() keeps the caller's ordering",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.symlink(".git/hooks/pre-commit", path.join(repo, "foo"))
      expect(await SecurityRealpath.all(["src/new.ts", "foo"], repo)).toEqual([
        path.join(repo, "src/new.ts"),
        path.join(repo, ".git/hooks/pre-commit"),
      ])
    }),
  )
})

describe.skipIf(process.platform === "win32")("SecurityRealpath.paths", () => {
  test(
    "an edit through a symlink reports the real target",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.symlink(".git/hooks/pre-commit", path.join(repo, "notes.md"))
      expect(await SecurityRealpath.paths({ permission: "edit", patterns: ["notes.md"] }, repo)).toEqual([
        path.join(repo, ".git/hooks/pre-commit"),
      ])
    }),
  )

  test(
    "a target that cannot be determined is reported as unresolved, never dropped",
    withRepo(async (repo) => {
      expect(await SecurityRealpath.paths({ permission: "edit", patterns: ["a\u0000b"] }, repo)).toEqual([
        SecurityRealpath.UNRESOLVED,
      ])
    }),
  )

  test(
    "permissions whose patterns are not concrete paths are left alone",
    withRepo(async (repo) => {
      expect(await SecurityRealpath.paths({ permission: "bash", patterns: ["rm -rf build"] }, repo)).toBeUndefined()
      expect(await SecurityRealpath.paths({ permission: "grep", patterns: ["src/*.ts"] }, repo)).toBeUndefined()
      expect(await SecurityRealpath.paths({ permission: "edit", patterns: ["src/*.ts"] }, repo)).toBeUndefined()
      expect(await SecurityRealpath.paths({ permission: "edit", patterns: [] }, repo)).toBeUndefined()
    }),
  )

  test(
    "shell effects are resolved through symlinks too",
    withRepo(async (repo) => {
      await fs.mkdir(path.join(repo, ".git/hooks"), { recursive: true })
      await fs.symlink(".git/hooks/pre-commit", path.join(repo, "notes.md"))
      expect(
        await SecurityRealpath.effects([{ operation: "update", path: path.join(repo, "notes.md") }], repo),
      ).toEqual([{ operation: "update", path: path.join(repo, ".git/hooks/pre-commit") }])
    }),
  )

  test(
    "a shell effect that cannot be resolved loses its path instead of keeping a wrong one",
    withRepo(async (repo) => {
      expect(await SecurityRealpath.effects([{ operation: "delete", path: "a\u0000b" }], repo)).toEqual([
        { operation: "delete" },
      ])
      expect(await SecurityRealpath.effects([{ operation: "delete" }], repo)).toEqual([{ operation: "delete" }])
    }),
  )
})

test("named home syntax cannot be absolutized into the workspace", async () => {
  expect(await SecurityRealpath.of("~root/file", "/tmp")).toBeUndefined()
  expect(await SecurityRealpath.of("~alice/file", "/tmp")).toBeUndefined()
  expect(await SecurityRealpath.of("~backup.txt", "/tmp")).toBe(path.join(await fs.realpath("/tmp"), "~backup.txt"))
})
