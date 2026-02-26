import { describe, it, expect } from "bun:test"
import type { HttpClient } from "../../src/services/cli-backend"
import { WorktreeStatsPoller } from "../../src/agent-manager/WorktreeStatsPoller"
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

describe("WorktreeStatsPoller", () => {
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

    const poller = new WorktreeStatsPoller({
      getWorktrees: () => [worktree("a")],
      getHttpClient: () => client,
      onStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      runGit: async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "1"
        return ""
      },
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

    const poller = new WorktreeStatsPoller({
      getWorktrees: () => [worktree("a")],
      getHttpClient: () => client,
      onStats: (stats) => emitted.push(stats),
      log: () => undefined,
      intervalMs: 5,
      runGit: async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return ".git"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "2"
        return ""
      },
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

  it("refreshes upstream remote once for concurrent worktrees", async () => {
    const commands: string[][] = []
    const emitted: Array<Array<{ worktreeId: string; additions: number; deletions: number; commits: number }>> = []

    const client = {
      getWorktreeDiff: async () => diff(0, 0),
    } as unknown as HttpClient

    const poller = new WorktreeStatsPoller({
      getWorktrees: () => [worktree("a"), worktree("b")],
      getHttpClient: () => client,
      onStats: (stats) => emitted.push(stats),
      log: () => undefined,
      intervalMs: 500,
      runGit: async (args) => {
        commands.push(args)
        if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return "/repo/.git"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "upstream/main"
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        if (args[0] === "fetch") return ""
        if (args[0] === "rev-list") return "0"
        return ""
      },
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
