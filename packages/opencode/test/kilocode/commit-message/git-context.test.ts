import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import * as fs from "fs/promises"
import path from "path"
import { tmpdir } from "../../fixture/fixture"
import {
  getGitContext,
  isLockFile,
  parseNameStatus,
  parsePorcelain,
  mapStatus,
  isUntracked,
  MAX_DIFF_LENGTH,
} from "../../../src/kilocode/commit-message/git-context"

// ── Helper: stage files in a temp git repo ──────────────────────────
async function stage(dir: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, text)
    await $`git add ${file}`.cwd(dir).quiet()
  }
}

// ── Pure-function unit tests (no git needed) ────────────────────────

describe("commit-message.git-context", () => {
  describe("parseNameStatus", () => {
    test("parses added file", () => {
      const result = parseNameStatus("A\tsrc/new-file.ts")
      expect(result).toEqual([{ status: "A", path: "src/new-file.ts" }])
    })

    test("parses modified file", () => {
      const result = parseNameStatus("M\tsrc/existing.ts")
      expect(result).toEqual([{ status: "M", path: "src/existing.ts" }])
    })

    test("parses deleted file", () => {
      const result = parseNameStatus("D\tsrc/removed.ts")
      expect(result).toEqual([{ status: "D", path: "src/removed.ts" }])
    })

    test("parses renamed file using new path", () => {
      const result = parseNameStatus("R100\told-name.ts\tnew-name.ts")
      expect(result).toEqual([{ status: "R100", path: "new-name.ts" }])
    })

    test("parses multiple entries", () => {
      const result = parseNameStatus("M\tsrc/a.ts\nA\tsrc/b.ts")
      expect(result).toHaveLength(2)
      expect(result[0]!.path).toBe("src/a.ts")
      expect(result[1]!.path).toBe("src/b.ts")
    })

    test("returns empty array for empty input", () => {
      expect(parseNameStatus("")).toEqual([])
    })
  })

  describe("parsePorcelain", () => {
    test("parses untracked file", () => {
      const result = parsePorcelain("?? src/brand-new.ts")
      expect(result).toEqual([{ status: "??", path: "src/brand-new.ts" }])
    })

    test("parses modified file", () => {
      const result = parsePorcelain(" M src/changed.ts")
      expect(result).toEqual([{ status: "M", path: "src/changed.ts" }])
    })

    test("returns empty array for empty input", () => {
      expect(parsePorcelain("")).toEqual([])
    })

    test("filters blank lines", () => {
      const result = parsePorcelain("?? a.ts\n\n?? b.ts")
      expect(result).toHaveLength(2)
    })
  })

  describe("mapStatus", () => {
    test("maps R-prefix to renamed", () => {
      expect(mapStatus("R100")).toBe("renamed")
      expect(mapStatus("R050")).toBe("renamed")
    })

    test("maps A to added", () => {
      expect(mapStatus("A")).toBe("added")
    })

    test("maps ?? to added", () => {
      expect(mapStatus("??")).toBe("added")
    })

    test("maps ? to added", () => {
      expect(mapStatus("?")).toBe("added")
    })

    test("maps D to deleted", () => {
      expect(mapStatus("D")).toBe("deleted")
    })

    test("maps M to modified", () => {
      expect(mapStatus("M")).toBe("modified")
    })

    test("maps unknown codes to modified", () => {
      expect(mapStatus("X")).toBe("modified")
    })
  })

  describe("isUntracked", () => {
    test("returns true for ??", () => {
      expect(isUntracked("??")).toBe(true)
    })

    test("returns true for ?", () => {
      expect(isUntracked("?")).toBe(true)
    })

    test("returns false for other codes", () => {
      expect(isUntracked("M")).toBe(false)
      expect(isUntracked("A")).toBe(false)
    })
  })

  describe("isLockFile", () => {
    test("detects package-lock.json", () => {
      expect(isLockFile("package-lock.json")).toBe(true)
    })

    test("detects yarn.lock", () => {
      expect(isLockFile("yarn.lock")).toBe(true)
    })

    test("detects lock files in subdirectories", () => {
      expect(isLockFile("packages/api/package-lock.json")).toBe(true)
    })

    test("detects various lock files", () => {
      expect(isLockFile("bun.lockb")).toBe(true)
      expect(isLockFile("go.sum")).toBe(true)
      expect(isLockFile("Cargo.lock")).toBe(true)
      expect(isLockFile("poetry.lock")).toBe(true)
      expect(isLockFile("pnpm-lock.yaml")).toBe(true)
    })

    test("does not flag normal files", () => {
      expect(isLockFile("src/index.ts")).toBe(false)
      expect(isLockFile("README.md")).toBe(false)
    })
  })

  // ── Integration tests using real git repos ────────────────────────

  describe("lock file filtering", () => {
    test("filters out lock files from staged changes", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, {
        "src/index.ts": "console.log('hello')\n",
        "package-lock.json": '{"lockfileVersion": 3}\n',
      })

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("src/index.ts")
    })

    test("filters lock files in subdirectories", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, {
        "packages/api/package-lock.json": "lock\n",
        "packages/api/src/index.ts": "export {}\n",
      })

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("packages/api/src/index.ts")
    })
  })

  describe("status parsing", () => {
    test("parses staged added files", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, { "src/new-file.ts": "new content\n" })

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("added")
      expect(ctx.files[0]!.path).toBe("src/new-file.ts")
    })

    test("parses staged modified files", async () => {
      await using tmp = await tmpdir({ git: true })
      // Create, commit, then modify
      await stage(tmp.path, { "src/existing.ts": "original\n" })
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()
      await Bun.write(path.join(tmp.path, "src/existing.ts"), "changed\n")
      await $`git add src/existing.ts`.cwd(tmp.path).quiet()

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("modified")
    })

    test("parses staged deleted files", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, { "src/removed.ts": "to delete\n" })
      await $`git commit -m "add file"`.cwd(tmp.path).quiet()
      await $`git rm src/removed.ts`.cwd(tmp.path).quiet()

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("deleted")
    })
  })

  describe("diff truncation", () => {
    test("truncates diffs exceeding max length", async () => {
      await using tmp = await tmpdir({ git: true })
      const long = "x".repeat(MAX_DIFF_LENGTH + 2000)
      await stage(tmp.path, { "src/big.ts": "original\n" })
      await $`git commit -m "add"`.cwd(tmp.path).quiet()
      await Bun.write(path.join(tmp.path, "src/big.ts"), long + "\n")
      await $`git add src/big.ts`.cwd(tmp.path).quiet()

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.diff).toContain("... [truncated]")
    })
  })

  describe("selected files filtering", () => {
    test("only includes files in selectedFiles set", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, {
        "src/a.ts": "a\n",
        "src/b.ts": "b\n",
        "src/c.ts": "c\n",
      })

      const ctx = await getGitContext(tmp.path, ["src/a.ts", "src/c.ts"])

      expect(ctx.files).toHaveLength(2)
      const paths = ctx.files.map((f) => f.path)
      expect(paths).toContain("src/a.ts")
      expect(paths).toContain("src/c.ts")
      expect(paths).not.toContain("src/b.ts")
    })

    test("includes all files when selectedFiles is undefined", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, {
        "src/a.ts": "a\n",
        "src/b.ts": "b\n",
      })

      const ctx = await getGitContext(tmp.path)

      expect(ctx.files).toHaveLength(2)
    })

    test("returns empty files when selectedFiles has no matches", async () => {
      await using tmp = await tmpdir({ git: true })
      await stage(tmp.path, { "src/a.ts": "a\n" })

      const ctx = await getGitContext(tmp.path, ["src/nonexistent.ts"])

      expect(ctx.files).toHaveLength(0)
    })
  })

  describe("branch and recent commits", () => {
    test("returns current branch name", async () => {
      await using tmp = await tmpdir({ git: true })
      await $`git checkout -b feature/my-branch`.cwd(tmp.path).quiet()

      const ctx = await getGitContext(tmp.path)

      expect(ctx.branch).toBe("feature/my-branch")
    })

    test("returns recent commits as array", async () => {
      await using tmp = await tmpdir({ git: true })
      // tmpdir already creates a root commit
      await stage(tmp.path, { "a.ts": "a\n" })
      await $`git commit -m "second commit"`.cwd(tmp.path).quiet()

      const ctx = await getGitContext(tmp.path)

      expect(ctx.recentCommits.length).toBeGreaterThanOrEqual(1)
      expect(ctx.recentCommits.some((c) => c.includes("second commit"))).toBe(true)
    })
  })
})
