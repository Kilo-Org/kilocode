import { describe, it, expect } from "bun:test"
import { GitOps } from "../../src/agent-manager/GitOps"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ops(handler: (args: string[], cwd: string) => Promise<string>): GitOps {
  return new GitOps({ log: () => undefined, refreshMs: 120000, runGit: handler })
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

  describe("resolveTrackingBranch", () => {
    it("returns configured upstream", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[2] === "@{upstream}") return "origin/feature"
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBe("origin/feature")
    })

    it("falls back to origin/<branch> when no upstream", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[2] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "origin/feature") return "abc123"
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBe("origin/feature")
    })

    it("returns undefined when no upstream and no remote ref", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse") throw new Error("no ref")
        return ""
      })
      expect(await git.resolveTrackingBranch("/repo", "feature")).toBeUndefined()
    })
  })

  describe("resolveDefaultBranch", () => {
    it("returns origin/HEAD symbolic ref", async () => {
      const git = ops(async (args) => {
        if (args[0] === "symbolic-ref") return "origin/develop"
        return ""
      })
      expect(await git.resolveDefaultBranch("/repo")).toBe("origin/develop")
    })

    it("returns undefined when origin/HEAD is not set", async () => {
      const git = ops(async () => {
        throw new Error("no symbolic ref")
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

  describe("refreshRemote", () => {
    it("fetches the remote", async () => {
      const commands: string[][] = []
      const git = ops(async (args) => {
        commands.push(args)
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return "/repo/.git"
        return ""
      })
      await git.refreshRemote("/repo", "origin")
      const fetches = commands.filter((c) => c[0] === "fetch")
      expect(fetches.length).toBe(1)
      expect(fetches[0][3]).toBe("origin")
    })

    it("skips empty remote name", async () => {
      const commands: string[][] = []
      const git = ops(async (args) => {
        commands.push(args)
        return ""
      })
      await git.refreshRemote("/repo", "")
      expect(commands.length).toBe(0)
    })

    it("throttles repeated fetches for the same remote", async () => {
      const commands: string[][] = []
      const git = ops(async (args) => {
        commands.push(args)
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return "/repo/.git"
        return ""
      })
      await git.refreshRemote("/repo", "origin")
      await git.refreshRemote("/repo", "origin")
      const fetches = commands.filter((c) => c[0] === "fetch")
      expect(fetches.length).toBe(1)
    })

    it("deduplicates inflight fetches", async () => {
      const commands: string[][] = []
      const git = new GitOps({
        log: () => undefined,
        refreshMs: 0,
        runGit: async (args) => {
          commands.push(args)
          if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return "/repo/.git"
          if (args[0] === "fetch") {
            await sleep(50)
            return ""
          }
          return ""
        },
      })
      await Promise.all([git.refreshRemote("/repo", "origin"), git.refreshRemote("/repo", "origin")])
      const fetches = commands.filter((c) => c[0] === "fetch")
      expect(fetches.length).toBe(1)
    })
  })

  describe("countMissingOriginCommits", () => {
    it("counts commits ahead of upstream", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "3"
        return ""
      })
      expect(await git.countMissingOriginCommits("/repo", "main")).toBe(3)
    })

    it("falls back to remote/branch when no upstream", async () => {
      const commands: string[][] = []
      const git = ops(async (args) => {
        commands.push(args)
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "--quiet" &&
          args[3] === "refs/remotes/origin/feature"
        )
          return "abc"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "7"
        return ""
      })
      expect(await git.countMissingOriginCommits("/repo", "main")).toBe(7)
    })

    it("falls back to remote/parentBranch when no upstream and no remote branch", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "--quiet" &&
          args[3] === "refs/remotes/origin/feature"
        )
          throw new Error("no ref")
        if (
          args[0] === "rev-parse" &&
          args[1] === "--verify" &&
          args[2] === "--quiet" &&
          args[3] === "refs/remotes/origin/main"
        )
          return "abc"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "2"
        return ""
      })
      expect(await git.countMissingOriginCommits("/repo", "main")).toBe(2)
    })

    it("returns zero when rev-list fails", async () => {
      const git = ops(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") throw new Error("fatal")
        return ""
      })
      expect(await git.countMissingOriginCommits("/repo", "main")).toBe(0)
    })
  })
})
