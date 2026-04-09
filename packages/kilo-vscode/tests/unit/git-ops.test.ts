import { describe, it, expect } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as nodePath from "path"
import { GitOps } from "../../src/agent-manager/GitOps"

function ops(handler: (args: string[], cwd: string) => Promise<string>): GitOps {
  return new GitOps({ log: () => undefined, runGit: handler })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runGit(cwd: string, args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stderr: "pipe",
    stdout: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  })
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8") || Buffer.from(result.stdout).toString("utf8"))
  }
  return Buffer.from(result.stdout).toString("utf8").trim()
}

async function withRepo(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await fs.mkdtemp(nodePath.join(os.tmpdir(), "kilo-gitops-test-"))
  try {
    runGit(cwd, ["init"])
    await run(cwd)
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
}

describe("GitOps", () => {
  describe("currentBranch", () => {
    it("returns the current branch name", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "feature"
        return ""
      })
      expect(await git.currentBranch("/repo")).toBe("feature")
    })

    it("returns empty string on error", async () => {
      const git = ops(async () => {
        throw new Error("not a git repo")
      })
      expect(await git.currentBranch("/repo")).toBe("")
    })
  })

  describe("resolveRemote", () => {
    it("uses upstream remote when upstream is configured", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "upstream/main"
        return ""
      })
      expect(await git.resolveRemote("/repo", "feature")).toBe("upstream")
    })

    it("uses branch config remote when no upstream", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "config" && args[1] === "branch.feature.remote") return "myfork"
        return ""
      })
      expect(await git.resolveRemote("/repo", "feature")).toBe("myfork")
    })

    it("resolves branch from HEAD when no branch arg provided", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "branch") return "feature"
        if (args[0] === "config" && args[1] === "branch.feature.remote") return "myfork"
        return ""
      })
      expect(await git.resolveRemote("/repo")).toBe("myfork")
    })

    it("falls back to origin when nothing is configured", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse") throw new Error("no upstream")
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") throw new Error("no config")
        return ""
      })
      expect(await git.resolveRemote("/repo", "feature")).toBe("origin")
    })
  })

  describe("resolveTrackingBranch", () => {
    it("returns configured upstream", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[2] === "@{upstream}") return "origin/feature"
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBe("origin/feature")
    })

    it("falls back to <remote>/<branch> when no upstream", async () => {
      const git = ops(async (args) => {
        // resolveTrackingBranch: no upstream
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}")
          throw new Error("no upstream")
        // resolveRemote: no upstream, config says "myfork"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "config" && args[1] === "branch.feature.remote") return "myfork"
        // verify myfork/feature exists
        if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "myfork/feature") return "abc123"
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBe("myfork/feature")
    })

    it("falls back to origin/<branch> when no branch config", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}")
          throw new Error("no upstream")
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "config") throw new Error("no config")
        if (args[0] === "branch") return "feature"
        if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "origin/feature") return "abc123"
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBe("origin/feature")
    })

    it("returns undefined when no upstream and no remote ref", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse") throw new Error("no ref")
        if (args[0] === "config") throw new Error("no config")
        if (args[0] === "branch") return ""
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBeUndefined()
    })
  })

  describe("resolveDefaultBranch", () => {
    it("returns <remote>/HEAD symbolic ref", async () => {
      const git = ops(async (args) => {
        // resolveRemote: upstream is configured
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "upstream/main"
        // symbolic-ref for upstream/HEAD
        if (args[0] === "symbolic-ref" && args[2] === "refs/remotes/upstream/HEAD") return "upstream/develop"
        return ""
      })
      expect(await git.resolveDefaultBranch("/repo", "feature")).toBe("upstream/develop")
    })

    it("falls back to origin/HEAD when remote is origin", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "config") throw new Error("no config")
        if (args[0] === "branch") return "feature"
        if (args[0] === "symbolic-ref" && args[2] === "refs/remotes/origin/HEAD") return "origin/main"
        return ""
      })
      expect(await git.resolveDefaultBranch("/repo", "feature")).toBe("origin/main")
    })

    it("returns undefined when <remote>/HEAD is not set", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse") throw new Error("no upstream")
        if (args[0] === "config") throw new Error("no config")
        if (args[0] === "branch") return ""
        if (args[0] === "symbolic-ref") throw new Error("no symbolic ref")
        return ""
      })
      expect(await git.resolveDefaultBranch("/repo")).toBeUndefined()
    })
  })

  describe("hasRemoteRef", () => {
    it("returns true when ref exists", async () => {
      const git = ops(async () => "abc123")
      expect(await git.hasRemoteRef("/repo", "origin/main")).toBe(true)
    })

    it("returns false when ref does not exist", async () => {
      const git = ops(async () => {
        throw new Error("no ref")
      })
      expect(await git.hasRemoteRef("/repo", "origin/nonexistent")).toBe(false)
    })
  })

  describe("aheadBehind", () => {
    it("counts commits ahead and behind using the provided ref", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-list" && args[1] === "--left-right") return "1\t3"
        return ""
      })
      expect(await git.aheadBehind("/repo", "origin/main")).toEqual({ ahead: 3, behind: 1 })
    })

    it("does not fetch from remote", async () => {
      const commands: string[][] = []
      const git = ops(async (args) => {
        commands.push(args)
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t4"
        return ""
      })
      await git.aheadBehind("/repo", "myfork/main")
      const fetches = commands.filter((c) => c[0] === "fetch")
      expect(fetches.length).toBe(0)
    })

    it("returns zeros when rev-list fails", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-list") throw new Error("fatal")
        return ""
      })
      expect(await git.aheadBehind("/repo", "origin/main")).toEqual({ ahead: 0, behind: 0 })
    })

    it("uses the ref directly without double-prefixing", async () => {
      const refs: string[] = []
      const git = ops(async (args) => {
        if (args[0] === "rev-list" && args[1] === "--left-right") {
          refs.push(args[3]!)
          return "0\t1"
        }
        return ""
      })
      const result = await git.aheadBehind("/repo", "origin/main")
      expect(result).toEqual({ ahead: 1, behind: 0 })
      expect(refs[0]).toBe("origin/main...HEAD")
    })
  })

  describe("buildWorktreePatch", () => {
    it("includes tracked and untracked changes", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "one\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "b.txt"), "one\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "two\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "b.txt"), "two\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "c.txt"), "new\n", "utf8")

        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const patch = await git.buildWorktreePatch(cwd, branch)

        expect(patch).toContain("a/a.txt")
        expect(patch).toContain("a/b.txt")
        expect(patch).toContain("a/c.txt")
      })
    })

    it("limits patch to selected files", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "one\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "b.txt"), "one\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "two\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "b.txt"), "two\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "c.txt"), "new\n", "utf8")

        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const patch = await git.buildWorktreePatch(cwd, branch, ["a.txt", "c.txt"])

        expect(patch).toContain("a/a.txt")
        expect(patch).toContain("a/c.txt")
        expect(patch).not.toContain("a/b.txt")
      })
    })

    it("filters absolute paths and .. traversal from selectedFiles", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "one\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "b.txt"), "one\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "two\n", "utf8")
        await fs.writeFile(nodePath.join(cwd, "b.txt"), "two\n", "utf8")

        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const patch = await git.buildWorktreePatch(cwd, branch, ["a.txt", "/etc/passwd", "../../../secret", "", "  "])

        expect(patch).toContain("a/a.txt")
        expect(patch).not.toContain("b.txt")
        expect(patch).not.toContain("passwd")
        expect(patch).not.toContain("secret")
      })
    })
  })

  describe("checkApplyPatch", () => {
    it("returns ok for a clean patch", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "one\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "two\n", "utf8")
        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const patch = await git.buildWorktreePatch(cwd, branch)

        // Reset the file so the patch can apply cleanly to the original state
        runGit(cwd, ["checkout", "--", "a.txt"])
        const result = await git.checkApplyPatch(cwd, patch)
        expect(result.ok).toBe(true)
      })
    })

    it("returns not-ok for an empty patch", async () => {
      const git = new GitOps({ log: () => undefined })
      const result = await git.checkApplyPatch("/tmp", "")
      expect(result.ok).toBe(true)
      expect(result.message).toBe("No changes to apply")
    })

    it("reports conflicts when patch context does not match", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        // File content that does NOT match the patch context
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "completely different content\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        // Craft a patch whose context lines don't exist in the file
        // and has no full-index blob SHAs, so --3way can't recover
        const patch = [
          "diff --git a/a.txt b/a.txt",
          "--- a/a.txt",
          "+++ b/a.txt",
          "@@ -1,3 +1,3 @@",
          " line1",
          "-line2",
          "+patched",
          " line3",
          "",
        ].join("\n")

        const result = await git.checkApplyPatch(cwd, patch)
        expect(result.ok).toBe(false)
        expect(result.conflicts.length).toBeGreaterThan(0)
        expect(result.message).toBeTruthy()
      })
    })
  })

  describe("applyPatch", () => {
    it("applies changes to the working tree", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "one\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "two\n", "utf8")
        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const patch = await git.buildWorktreePatch(cwd, branch)

        runGit(cwd, ["checkout", "--", "a.txt"])
        const result = await git.applyPatch(cwd, patch)
        expect(result.ok).toBe(true)

        const content = await fs.readFile(nodePath.join(cwd, "a.txt"), "utf8")
        expect(content).toBe("two\n")
      })
    })

    it("returns empty patch as success", async () => {
      const git = new GitOps({ log: () => undefined })
      const result = await git.applyPatch("/tmp", "")
      expect(result.ok).toBe(true)
      expect(result.message).toBe("No changes to apply")
    })

    it("returns conflicts when applying a conflicting patch", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "line1\nline2\nline3\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "line1\npatched\nline3\n", "utf8")
        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const patch = await git.buildWorktreePatch(cwd, branch)

        await fs.writeFile(nodePath.join(cwd, "a.txt"), "line1\ndifferent\nline3\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "diverge"])

        const result = await git.applyPatch(cwd, patch)
        expect(result.ok).toBe(false)
        expect(result.conflicts.length).toBeGreaterThan(0)
      })
    })
  })

  describe("workingTreeStats", () => {
    it("parses numstat for tracked changes", async () => {
      const git = ops(async (args) => {
        if (args[0] === "diff") return "3\t1\tsrc/a.ts\n0\t5\tsrc/b.ts"
        if (args[0] === "ls-files") return ""
        return ""
      })
      const stats = await git.workingTreeStats("/repo")
      expect(stats).toEqual({ files: 2, additions: 3, deletions: 6 })
    })

    it("treats binary numstat entries as zero additions and deletions", async () => {
      const git = ops(async (args) => {
        if (args[0] === "diff") return "2\t1\ttext.ts\n-\t-\timage.png"
        if (args[0] === "ls-files") return ""
        return ""
      })
      const stats = await git.workingTreeStats("/repo")
      expect(stats).toEqual({ files: 2, additions: 2, deletions: 1 })
    })

    it("returns zeros for a clean working tree", async () => {
      const git = ops(async (args) => {
        if (args[0] === "diff") return ""
        if (args[0] === "ls-files") return ""
        return ""
      })
      const stats = await git.workingTreeStats("/repo")
      expect(stats).toEqual({ files: 0, additions: 0, deletions: 0 })
    })

    it("returns zeros when git commands fail", async () => {
      const git = ops(async () => {
        throw new Error("not a git repo")
      })
      const stats = await git.workingTreeStats("/repo")
      expect(stats).toEqual({ files: 0, additions: 0, deletions: 0 })
    })

    it("counts untracked file lines as additions", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "init.txt"), "x\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "new.txt"), "a\nb\nc", "utf8")

        const stats = await git.workingTreeStats(cwd)
        expect(stats.files).toBe(1)
        expect(stats.additions).toBe(3)
      })
    })

    it("skips untracked files larger than 1MB", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "init.txt"), "x\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])

        await fs.writeFile(nodePath.join(cwd, "huge.bin"), Buffer.alloc(1_000_001, 0x41))
        await fs.writeFile(nodePath.join(cwd, "small.txt"), "hello", "utf8")

        const stats = await git.workingTreeStats(cwd)
        expect(stats.files).toBe(2)
        // small.txt: "hello".split("\n").length = 1, huge.bin: skipped (0)
        expect(stats.additions).toBe(1)
      })
    })
  })

  describe("dispose", () => {
    it("aborts in-flight runGit calls quickly", async () => {
      let resolved = false
      const git = new GitOps({
        log: () => undefined,
        runGit: async () => {
          await sleep(5000)
          resolved = true
          return "should not reach"
        },
      })

      const start = Date.now()
      const pending = git.currentBranch("/repo")
      git.dispose()
      await pending
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(500)
      expect(resolved).toBe(false)
    })

    it("causes subsequent runGit calls to fail immediately", async () => {
      let called = false
      const git = new GitOps({
        log: () => undefined,
        runGit: async () => {
          called = true
          return "ok"
        },
      })
      git.dispose()

      // currentBranch swallows errors — should return "" without calling runGit
      const result = await git.currentBranch("/repo")
      expect(result).toBe("")
      expect(called).toBe(false)
    })

    it("reports disposed state", () => {
      const git = ops(async () => "ok")
      expect(git.disposed).toBe(false)
      git.dispose()
      expect(git.disposed).toBe(true)
    })

    it("kills in-flight exec (spawn) processes", async () => {
      await withRepo(async (cwd) => {
        const git = new GitOps({ log: () => undefined })
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "one\n", "utf8")
        runGit(cwd, ["add", "-A"])
        runGit(cwd, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"])
        await fs.writeFile(nodePath.join(cwd, "a.txt"), "two\n", "utf8")

        const branch = runGit(cwd, ["branch", "--show-current"]) || "HEAD"
        const pending = git.buildWorktreePatch(cwd, branch)
        // Give spawn a moment to start, then dispose
        await sleep(10)
        git.dispose()

        // Should either reject or return (but process should be killed)
        try {
          await pending
        } catch {
          // expected — aborted
        }
        expect(git.disposed).toBe(true)
      })
    })

    it("is safe to call multiple times", () => {
      const git = ops(async () => "ok")
      git.dispose()
      git.dispose()
      expect(git.disposed).toBe(true)
    })
  })
})
