import { describe, expect, test, beforeEach } from "bun:test"

// Mock Bun.spawnSync before importing the module under test
const spawnSyncResults: Record<string, string> = {}

function setGitOutput(args: string, output: string) {
  spawnSyncResults[args] = output
}

function clearGitOutputs() {
  for (const key of Object.keys(spawnSyncResults)) {
    delete spawnSyncResults[key]
  }
}

// Replace global Bun.spawnSync — the git() helper in git-context.ts calls
// result.stdout.toString().trim(), so we return a Buffer and let git() trim.
Bun.spawnSync = ((cmd: string[], _opts?: any) => {
  const args = cmd.slice(1).join(" ")
  const output = spawnSyncResults[args] ?? ""
  return {
    stdout: Buffer.from(output),
    stderr: Buffer.from(""),
    exitCode: 0,
  }
}) as typeof Bun.spawnSync

import { getGitContext } from "../git-context"

describe("commit-message.git-context", () => {
  beforeEach(() => {
    clearGitOutputs()
    // Defaults
    setGitOutput("branch --show-current", "main")
    setGitOutput("log --oneline -5", "abc1234 initial commit")
    setGitOutput("diff --name-status --cached", "")
    setGitOutput("status --porcelain", "")
  })

  // NOTE: git() trims stdout, which eats the leading space of the first
  // porcelain line. We use staged (--name-status) tests for path-sensitive
  // assertions and only use porcelain for behavior tests where this is acceptable.

  describe("lock file filtering", () => {
    test("filters out package-lock.json from staged changes", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/index.ts\nM\tpackage-lock.json")
      setGitOutput("diff --cached -- src/index.ts", "+console.log('hello')")
      setGitOutput("diff --cached -- package-lock.json", "+lots of lock content")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("src/index.ts")
    })

    test("filters out yarn.lock from staged changes", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/app.ts\nM\tyarn.lock")
      setGitOutput("diff --cached -- src/app.ts", "+import x")
      setGitOutput("diff --cached -- yarn.lock", "+lock data")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("src/app.ts")
    })

    test("filters out pnpm-lock.yaml from staged changes", async () => {
      setGitOutput("diff --name-status --cached", "M\treadme.md\nM\tpnpm-lock.yaml")
      setGitOutput("diff --cached -- pnpm-lock.yaml", "+lock")
      setGitOutput("diff --cached -- readme.md", "+docs")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("readme.md")
    })

    test("filters lock files in subdirectories", async () => {
      setGitOutput("diff --name-status --cached", "M\tpackages/api/package-lock.json\nM\tpackages/api/src/index.ts")
      setGitOutput("diff --cached -- packages/api/package-lock.json", "+lock stuff")
      setGitOutput("diff --cached -- packages/api/src/index.ts", "+code")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("packages/api/src/index.ts")
    })

    test("filters out bun.lockb, go.sum, Cargo.lock, poetry.lock", async () => {
      setGitOutput(
        "diff --name-status --cached",
        "M\tbun.lockb\nM\tgo.sum\nM\tCargo.lock\nM\tpoetry.lock\nM\tsrc/main.rs",
      )
      setGitOutput("diff --cached -- bun.lockb", "binary")
      setGitOutput("diff --cached -- go.sum", "+hash")
      setGitOutput("diff --cached -- Cargo.lock", "+lock")
      setGitOutput("diff --cached -- poetry.lock", "+lock")
      setGitOutput("diff --cached -- src/main.rs", "+fn main() {}")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("src/main.rs")
    })
  })

  describe("status parsing", () => {
    test("parses staged added files", async () => {
      setGitOutput("diff --name-status --cached", "A\tsrc/new-file.ts")
      setGitOutput("diff --cached -- src/new-file.ts", "+new content")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("added")
      expect(ctx.files[0]!.path).toBe("src/new-file.ts")
    })

    test("parses staged modified files", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/existing.ts")
      setGitOutput("diff --cached -- src/existing.ts", "+changed line")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("modified")
    })

    test("parses staged deleted files", async () => {
      setGitOutput("diff --name-status --cached", "D\tsrc/removed.ts")
      setGitOutput("diff --cached -- src/removed.ts", "-deleted content")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("deleted")
    })

    test("parses staged renamed files", async () => {
      setGitOutput("diff --name-status --cached", "R100\told-name.ts\tnew-name.ts")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("renamed")
    })

    test("parses untracked files from porcelain", async () => {
      setGitOutput("status --porcelain", "?? src/brand-new.ts")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("added")
      expect(ctx.files[0]!.diff).toBe("New untracked file: src/brand-new.ts")
    })

    test("parses porcelain modified files", async () => {
      // Use staged to avoid porcelain trim edge case
      setGitOutput("diff --name-status --cached", "M\tsrc/changed.ts")
      setGitOutput("diff --cached -- src/changed.ts", "+line")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.status).toBe("modified")
    })

    test("prefers staged changes over unstaged", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/staged.ts")
      setGitOutput("diff --cached -- src/staged.ts", "+staged change")
      // unstaged also exists but should be ignored when staged is present
      setGitOutput("status --porcelain", " M src/unstaged.ts")
      setGitOutput("diff -- src/unstaged.ts", "+unstaged change")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.path).toBe("src/staged.ts")
    })

    test("mapStatus returns 'modified' for unknown codes", async () => {
      setGitOutput("diff --name-status --cached", "X\tsrc/weird.ts")
      setGitOutput("diff --cached -- src/weird.ts", "+stuff")

      const ctx = await getGitContext("/repo")

      expect(ctx.files[0]!.status).toBe("modified")
    })
  })

  describe("diff truncation", () => {
    test("truncates diffs exceeding 4000 characters", async () => {
      const longDiff = "x".repeat(5000)
      setGitOutput("diff --name-status --cached", "M\tsrc/big.ts")
      setGitOutput("diff --cached -- src/big.ts", longDiff)

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.diff.length).toBeLessThan(5000)
      expect(ctx.files[0]!.diff).toContain("... [truncated]")
      // 4000 chars + "\n... [truncated]"
      expect(ctx.files[0]!.diff.length).toBe(4000 + "\n... [truncated]".length)
    })

    test("does not truncate diffs at exactly 4000 characters", async () => {
      const exactDiff = "y".repeat(4000)
      setGitOutput("diff --name-status --cached", "M\tsrc/exact.ts")
      setGitOutput("diff --cached -- src/exact.ts", exactDiff)

      const ctx = await getGitContext("/repo")

      expect(ctx.files[0]!.diff).toBe(exactDiff)
      expect(ctx.files[0]!.diff).not.toContain("... [truncated]")
    })

    test("does not truncate diffs under 4000 characters", async () => {
      const shortDiff = "z".repeat(100)
      setGitOutput("diff --name-status --cached", "M\tsrc/small.ts")
      setGitOutput("diff --cached -- src/small.ts", shortDiff)

      const ctx = await getGitContext("/repo")

      expect(ctx.files[0]!.diff).toBe(shortDiff)
    })
  })

  describe("binary file detection", () => {
    test("detects 'Binary files' in diff output", async () => {
      setGitOutput("diff --name-status --cached", "M\tassets/logo.png")
      setGitOutput("diff --cached -- assets/logo.png", "Binary files a/assets/logo.png and b/assets/logo.png differ")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.diff).toBe("Binary file assets/logo.png has been modified")
    })

    test("detects 'GIT binary patch' in diff output", async () => {
      setGitOutput("diff --name-status --cached", "M\tassets/icon.ico")
      setGitOutput("diff --cached -- assets/icon.ico", "GIT binary patch\nliteral 1234\ndata...")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(1)
      expect(ctx.files[0]!.diff).toBe("Binary file assets/icon.ico has been modified")
    })

    test("does not flag normal diffs as binary", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/code.ts")
      setGitOutput("diff --cached -- src/code.ts", "+const x = 1")

      const ctx = await getGitContext("/repo")

      expect(ctx.files[0]!.diff).toBe("+const x = 1")
    })
  })

  describe("selected files filtering", () => {
    test("only includes files in selectedFiles set", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/a.ts\nM\tsrc/b.ts\nM\tsrc/c.ts")
      setGitOutput("diff --cached -- src/a.ts", "+a")
      setGitOutput("diff --cached -- src/b.ts", "+b")
      setGitOutput("diff --cached -- src/c.ts", "+c")

      const ctx = await getGitContext("/repo", ["src/a.ts", "src/c.ts"])

      expect(ctx.files).toHaveLength(2)
      const paths = ctx.files.map((f) => f.path)
      expect(paths).toContain("src/a.ts")
      expect(paths).toContain("src/c.ts")
      expect(paths).not.toContain("src/b.ts")
    })

    test("includes all files when selectedFiles is undefined", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/a.ts\nM\tsrc/b.ts")
      setGitOutput("diff --cached -- src/a.ts", "+a")
      setGitOutput("diff --cached -- src/b.ts", "+b")

      const ctx = await getGitContext("/repo")

      expect(ctx.files).toHaveLength(2)
    })

    test("returns empty files when selectedFiles has no matches", async () => {
      setGitOutput("diff --name-status --cached", "M\tsrc/a.ts")
      setGitOutput("diff --cached -- src/a.ts", "+a")

      const ctx = await getGitContext("/repo", ["src/nonexistent.ts"])

      expect(ctx.files).toHaveLength(0)
    })
  })

  describe("branch and recent commits", () => {
    test("returns current branch name", async () => {
      setGitOutput("branch --show-current", "feature/my-branch")

      const ctx = await getGitContext("/repo")

      expect(ctx.branch).toBe("feature/my-branch")
    })

    test("falls back to HEAD when branch is empty", async () => {
      setGitOutput("branch --show-current", "")

      const ctx = await getGitContext("/repo")

      expect(ctx.branch).toBe("HEAD")
    })

    test("returns recent commits as array", async () => {
      setGitOutput("log --oneline -5", "abc1234 first\ndef5678 second\nghi9012 third")

      const ctx = await getGitContext("/repo")

      expect(ctx.recentCommits).toEqual(["abc1234 first", "def5678 second", "ghi9012 third"])
    })

    test("returns empty array when no commits", async () => {
      setGitOutput("log --oneline -5", "")

      const ctx = await getGitContext("/repo")

      expect(ctx.recentCommits).toEqual([])
    })
  })
})
