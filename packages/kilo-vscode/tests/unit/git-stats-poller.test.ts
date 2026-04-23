import { describe, it, expect } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { GitStatsPoller, type WorktreePresenceResult } from "../../src/agent-manager/GitStatsPoller"
import { GitOps } from "../../src/agent-manager/GitOps"
import { Semaphore } from "../../src/agent-manager/semaphore"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"
import type { WorktreeDiffEntry } from "../../src/agent-manager/types"

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

function worktree(id: string, remote = "origin"): Worktree {
  return {
    id,
    branch: `branch-${id}`,
    path: `/tmp/${id}`,
    parentBranch: "main",
    remote,
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function diff(additions: number, deletions: number): WorktreeDiffEntry[] {
  return [
    {
      file: "file.ts",
      patch: "",
      before: "",
      after: "",
      additions,
      deletions,
      status: "modified",
      tracked: true,
      generatedLike: false,
      summarized: true,
      stamp: `${additions}:${deletions}`,
    },
  ]
}

function gitOps(handler: (args: string[], cwd: string) => Promise<string>): GitOps {
  return new GitOps({ log: () => undefined, runGit: handler })
}

describe("GitOps", () => {
  it("resolveDefaultBranch returns undefined on cache hit when there is no remote HEAD", async () => {
    let calls = 0
    const git = new GitOps({
      log: () => undefined,
      runGit: async (args) => {
        calls++
        if (args[0] === "symbolic-ref") throw new Error("no remote HEAD")
        if (args[0] === "branch" && args[1] === "--show-current") return "main"
        if (args[0] === "config" && args[1] === "branch.main.remote") return "origin"
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") throw new Error("no upstream")
        return ""
      },
    })

    // First call sets cache
    const first = await git.resolveDefaultBranch("/test")
    expect(first).toBeUndefined()
    expect(calls).toBeGreaterThan(0)

    // Second call reads from cache
    const beforeSecondCall = calls
    const second = await git.resolveDefaultBranch("/test")
    expect(second).toBeUndefined()
    // Should not have made any new git calls for the exact same resolution
    expect(calls).toBe(beforeSecondCall)
  })
})

describe("GitStatsPoller", () => {
  it("does not overlap polling runs", async () => {
    let running = 0
    let max = 0
    let calls = 0

    const localDiff = async () => {
      calls += 1
      running += 1
      max = Math.max(max, running)
      await sleep(40)
      running -= 1
      return diff(2, 1)
    }

    const poller = new GitStatsPoller({
      getWorktrees: () => [worktree("a")],
      getWorkspaceRoot: () => undefined,
      localDiff,
      onStats: () => undefined,
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t1"
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
    const emitted: Array<
      Array<{ worktreeId: string; files: number; additions: number; deletions: number; ahead: number; behind: number }>
    > = []

    const localDiff = async () => {
      calls += 1
      if (calls === 1) return diff(7, 3)
      throw new Error("transient backend failure")
    }

    const poller = new GitStatsPoller({
      getWorktrees: () => [worktree("a")],
      getWorkspaceRoot: () => undefined,
      localDiff,
      onStats: (stats) => emitted.push(stats),
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t2"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => calls >= 2)
    poller.stop()

    expect(emitted.length).toBeGreaterThan(0)
    const first = emitted[0]
    if (!first) throw new Error("expected emitted stats")
    expect(first[0]).toEqual({ worktreeId: "a", files: 1, additions: 7, deletions: 3, ahead: 2, behind: 0 })
    const hasZeros = emitted.some((batch) =>
      batch.some((item) => item.additions === 0 && item.deletions === 0 && item.ahead === 0),
    )
    expect(hasZeros).toBe(false)
  })

  it("emits present worktree probes on the poll loop", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-presence-"))
    const wtPath = path.join(root, "wt-a")
    fs.mkdirSync(wtPath, { recursive: true })

    const presence: WorktreePresenceResult[] = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [{ ...worktree("a"), path: wtPath }],
      getWorkspaceRoot: () => root,
      localDiff: async () => {
        throw new Error("should not be called when backend unavailable path")
      },
      onStats: () => undefined,
      onLocalStats: () => undefined,
      onWorktreePresence: (result) => presence.push(result),
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "worktree") {
          return `worktree ${wtPath}\nbranch refs/heads/branch-a\n`
        }
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => presence.length >= 1)
    poller.stop()
    fs.rmSync(root, { recursive: true, force: true })

    expect(presence[0]).toEqual({
      worktrees: [{ worktreeId: "a", missing: false, branch: "branch-a" }],
      degraded: false,
    })
  })

  it("emits degraded probe when git worktree listing fails", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-presence-fail-"))
    const wtPath = path.join(root, "wt-a")
    fs.mkdirSync(wtPath, { recursive: true })

    const presence: WorktreePresenceResult[] = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [{ ...worktree("a"), path: wtPath }],
      getWorkspaceRoot: () => root,
      localDiff: async () => diff(0, 0),
      onStats: () => undefined,
      onLocalStats: () => undefined,
      onWorktreePresence: (result) => presence.push(result),
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "worktree") {
          throw new Error("git worktree list failed")
        }
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => presence.length >= 1)
    poller.stop()
    fs.rmSync(root, { recursive: true, force: true })

    expect(presence[0]).toEqual({ worktrees: [], degraded: true })
  })

  it("skips stats fetch for missing worktrees detected by presence probe", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-skip-missing-"))
    const wtAPath = path.join(root, "wt-a")
    const wtBPath = path.join(root, "wt-b")
    fs.mkdirSync(wtAPath, { recursive: true })

    const calls: string[] = []
    const emitted: Array<Array<{ worktreeId: string; additions: number; deletions: number }>> = []
    const presence: WorktreePresenceResult[] = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [
        { ...worktree("a"), path: wtAPath },
        { ...worktree("b"), path: wtBPath },
      ],
      getWorkspaceRoot: () => root,
      localDiff: async (dir) => {
        calls.push(dir)
        return diff(1, 1)
      },
      onStats: (stats) => emitted.push(stats),
      onLocalStats: () => undefined,
      onWorktreePresence: (result) => presence.push(result),
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "worktree") {
          return `worktree ${wtAPath}\nbranch refs/heads/branch-a\n`
        }
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "rev-list") return "1"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => calls.length >= 1)
    poller.stop()
    fs.rmSync(root, { recursive: true, force: true })

    expect(calls.some((cwd) => cwd === wtBPath)).toBe(false)
    expect(presence[0]).toEqual({
      worktrees: [
        { worktreeId: "a", missing: false, branch: "branch-a" },
        { worktreeId: "b", missing: true, branch: undefined },
      ],
      degraded: false,
    })
    expect(emitted[0]?.map((item) => item.worktreeId)).toEqual(["a"])
  })

  it("preserves local stats when diff fails after initial success", async () => {
    let diffCalls = 0
    const emitted: Array<{
      branch: string
      files: number
      additions: number
      deletions: number
      ahead: number
      behind: number
    }> = []

    const localDiff = async () => {
      diffCalls += 1
      if (diffCalls === 1) return diff(5, 2)
      throw new Error("transient backend failure")
    }

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      localDiff,
      onStats: () => undefined,
      onLocalStats: (stats) => emitted.push(stats),
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "HEAD") return "feature"
        if (args[0] === "rev-parse" && args[1] === "--abbrev-ref" && args[2] === "@{upstream}") return "origin/feature"
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t3"
        if (args[0] === "branch") return "feature"
        if (args[0] === "config") return "origin"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => diffCalls >= 2)
    poller.stop()

    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted[0]).toEqual({ branch: "feature", files: 1, additions: 5, deletions: 2, ahead: 3, behind: 0 })
    expect(emitted.length).toBe(1)
  })

  it("falls back to <remote>/HEAD when no upstream and no <remote>/<branch>", async () => {
    const emitted: Array<{
      branch: string
      files: number
      additions: number
      deletions: number
      ahead: number
      behind: number
    }> = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      localDiff: async () => diff(10, 4),
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
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t5"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    expect(emitted[0]).toEqual({ branch: "my-feature", files: 1, additions: 10, deletions: 4, ahead: 5, behind: 0 })
  })

  it("falls back to workingTreeStats when no tracking, no default branch, and no remote refs exist", async () => {
    const emitted: Array<{
      branch: string
      files: number
      additions: number
      deletions: number
      ahead: number
      behind: number
    }> = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      localDiff: async () => diff(0, 0),
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
        // workingTreeStats fallback: no tracked changes, no untracked files
        if (args[0] === "diff") return ""
        if (args[0] === "ls-files") return ""
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    expect(emitted[0]).toEqual({
      branch: "orphan-branch",
      files: 0,
      additions: 0,
      deletions: 0,
      ahead: 0,
      behind: 0,
    })
  })

  it("does not fetch from remote for ahead/behind counts", async () => {
    const commands: string[][] = []
    const emitted: Array<
      Array<{ worktreeId: string; files: number; additions: number; deletions: number; ahead: number; behind: number }>
    > = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [worktree("a", "upstream"), worktree("b", "upstream")],
      getWorkspaceRoot: () => undefined,
      localDiff: async () => diff(0, 0),
      onStats: (stats) => emitted.push(stats),
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 500,
      git: gitOps(async (args) => {
        commands.push(args)
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t0"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    const fetches = commands.filter((cmd) => cmd[0] === "fetch")
    expect(fetches.length).toBe(0)
  })

  it("runs diffs in parallel without stalling (no extra semaphore layer)", async () => {
    // localDiff is a synchronous promise — since the poller no longer wraps
    // it in a semaphore (GitOps.execGit() gates at the child-process layer),
    // many worktrees can have their diffs computed concurrently without
    // contending for a dedicated outer gate.
    let running = 0
    let peak = 0
    let ticks = 0

    const wts = Array.from({ length: 5 }, (_, i) => worktree(String(i)))
    const poller = new GitStatsPoller({
      getWorktrees: () => wts,
      getWorkspaceRoot: () => undefined,
      localDiff: async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(20)
        running--
        return diff(1, 0)
      },
      onStats: () => {
        ticks++
      },
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t0"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => ticks >= 1)
    poller.stop()

    // All 5 diffs can run in parallel (no artificial cap at this layer).
    expect(peak).toBeGreaterThan(1)
  })

  it("runs concurrent diffs without deadlock when GitOps semaphore is shared", async () => {
    // Wire the SAME semaphore into GitOps to prove the aheadBehind path
    // (which goes through GitOps.raw) does not deadlock with the diff path.
    const sem = new Semaphore(2)
    let ticks = 0

    const wts = Array.from({ length: 5 }, (_, i) => worktree(String(i)))
    const poller = new GitStatsPoller({
      getWorktrees: () => wts,
      getWorkspaceRoot: () => undefined,
      localDiff: async () => diff(1, 0),
      onStats: () => {
        ticks++
      },
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      semaphore: sem,
      git: new GitOps({
        log: () => undefined,
        semaphore: sem,
        runGit: async (args) => {
          if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t0"
          return ""
        },
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => ticks >= 1)
    poller.stop()

    expect(ticks).toBeGreaterThan(0)
  })
})
