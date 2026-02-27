import { describe, it, expect } from "bun:test"
import type { HttpClient } from "../../src/services/cli-backend"
import { GitStatsPoller } from "../../src/agent-manager/GitStatsPoller"
import { GitOps } from "../../src/agent-manager/GitOps"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check: () => boolean, timeout = 500): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await sleep(5)
  }
}

function worktree(id: string): Worktree {
  return {
    id,
    branch: `branch-${id}`,
    path: `/tmp/${id}`,
    parentBranch: "main",
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function diff(additions: number, deletions: number) {
  return [{ file: "file.ts", before: "", after: "", additions, deletions, status: "modified" as const }]
}

function gitOps(handler: (args: string[], cwd: string) => Promise<string>): GitOps {
  return new GitOps({ log: () => undefined, runGit: handler })
}

describe("GitStatsPoller", () => {
  it("does not overlap polling runs", async () => {
    let running = 0
    let max = 0
    let calls = 0

    const client = {
      getWorktreeDiff: async () => {
        calls += 1
        running += 1
        max = Math.max(max, running)
        await sleep(40)
        running -= 1
        return diff(2, 1)
      },
    } as unknown as HttpClient

    const poller = new GitStatsPoller({
      getWorktrees: () => [worktree("a")],
      getWorkspaceRoot: () => undefined,
      getHttpClient: () => client,
      onStats: () => undefined,
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "1"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => calls >= 2)
    poller.stop()

    expect(max).toBe(1)
  })

  it("keeps last-known stats when a later poll fails", async () => {
    let calls = 0
    const emitted: Array<Array<{ worktreeId: string; additions: number; deletions: number; commits: number }>> = []

    const client = {
      getWorktreeDiff: async () => {
        calls += 1
        if (calls === 1) return diff(7, 3)
        throw new Error("transient backend failure")
      },
    } as unknown as HttpClient

    const poller = new GitStatsPoller({
      getWorktrees: () => [worktree("a")],
      getWorkspaceRoot: () => undefined,
      getHttpClient: () => client,
      onStats: (stats) => emitted.push(stats),
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "2"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => calls >= 2)
    poller.stop()

    expect(emitted.length).toBeGreaterThan(0)
    const first = emitted[0]
    if (!first) throw new Error("expected emitted stats")
    expect(first[0]).toEqual({ worktreeId: "a", additions: 7, deletions: 3, commits: 2 })
    const hasZeros = emitted.some((batch) =>
      batch.some((item) => item.additions === 0 && item.deletions === 0 && item.commits === 0),
    )
    expect(hasZeros).toBe(false)
  })

  it("preserves local stats when HTTP client fails after initial success", async () => {
    let diffCalls = 0
    const emitted: Array<{ branch: string; additions: number; deletions: number; commits: number }> = []

    const client = {
      getWorktreeDiff: async () => {
        diffCalls += 1
        if (diffCalls === 1) return diff(5, 2)
        throw new Error("transient backend failure")
      },
    } as unknown as HttpClient

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      getHttpClient: () => client,
      onStats: () => undefined,
      onLocalStats: (stats) => emitted.push(stats),
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "feature"
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}") return "origin/feature"
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "3"
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => diffCalls >= 2)
    poller.stop()

    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted[0]).toEqual({ branch: "feature", additions: 5, deletions: 2, commits: 3 })
    expect(emitted.length).toBe(1)
  })

  it("falls back to <remote>/HEAD when no upstream and no <remote>/<branch>", async () => {
    const emitted: Array<{ branch: string; additions: number; deletions: number; commits: number }> = []

    const client = {
      getWorktreeDiff: async () => diff(10, 4),
    } as unknown as HttpClient

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      getHttpClient: () => client,
      onStats: () => undefined,
      onLocalStats: (stats) => emitted.push(stats),
      log: () => undefined,
      intervalMs: 500,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "my-feature"
        // no upstream configured (used by resolveTrackingBranch and resolveRemote)
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}")
          throw new Error("no upstream")
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        // branch.my-feature.remote = myfork
        if (args[0] === "config" && args[1] === "branch.my-feature.remote") return "myfork"
        // myfork/my-feature does not exist
        if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "myfork/my-feature")
          throw new Error("no ref")
        // myfork/HEAD resolves to the default branch
        if (args[0] === "symbolic-ref" && args[2] === "refs/remotes/myfork/HEAD") return "myfork/develop"
        if (args[0] === "branch") return "my-feature"
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "5"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    expect(emitted[0]).toEqual({ branch: "my-feature", additions: 10, deletions: 4, commits: 5 })
  })

  it("emits zeros when no tracking, no default branch, and no remote refs exist", async () => {
    const emitted: Array<{ branch: string; additions: number; deletions: number; commits: number }> = []

    const client = {
      getWorktreeDiff: async () => diff(0, 0),
    } as unknown as HttpClient

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      getHttpClient: () => client,
      onStats: () => undefined,
      onLocalStats: (stats) => emitted.push(stats),
      log: () => undefined,
      intervalMs: 500,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "orphan-branch"
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}")
          throw new Error("no upstream")
        if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "origin/orphan-branch")
          throw new Error("no ref")
        if (args[0] === "symbolic-ref") throw new Error("no symbolic ref")
        if (args[0] === "rev-parse" && args[1] === "--verify" && args[2] === "--quiet") throw new Error("no ref")
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    expect(emitted[0]).toEqual({ branch: "orphan-branch", additions: 0, deletions: 0, commits: 0 })
  })

  it("refreshes upstream remote once for concurrent worktrees", async () => {
    const commands: string[][] = []
    const emitted: Array<Array<{ worktreeId: string; additions: number; deletions: number; commits: number }>> = []

    const client = {
      getWorktreeDiff: async () => diff(0, 0),
    } as unknown as HttpClient

    const poller = new GitStatsPoller({
      getWorktrees: () => [worktree("a"), worktree("b")],
      getWorkspaceRoot: () => undefined,
      getHttpClient: () => client,
      onStats: (stats) => emitted.push(stats),
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 500,
      git: gitOps(async (args) => {
        commands.push(args)
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return "/repo/.git"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "upstream/main"
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "0"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    const fetches = commands.filter((cmd) => cmd[0] === "fetch")
    expect(fetches.length).toBe(1)
    const fetch = fetches[0]
    if (!fetch) throw new Error("expected fetch command")
    expect(fetch[3]).toBe("upstream")
  })
})
