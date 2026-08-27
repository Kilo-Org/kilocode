import { describe, it, expect } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { GitStatsPoller, type WorktreePresenceResult } from "../../src/agent-manager/GitStatsPoller"
import { GitOps, type ExecBufferResult } from "../../src/agent-manager/GitOps"
import type { GitStatsSource } from "../../src/agent-manager/git-stats-snapshot"
import { Semaphore } from "../../src/agent-manager/semaphore"
import type { Worktree } from "../../src/agent-manager/WorktreeStateManager"
import type { WorktreeDiffEntry } from "../../src/agent-manager/types"

function run(dir: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })
  if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))
}

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

function source(
  localDiff: (dir: string, base: string) => Promise<WorktreeDiffEntry[]>,
  branch = "HEAD",
): GitStatsSource {
  let sequence = 0
  return {
    status: async () => {
      const fingerprint = String(++sequence)
      return { branch, dirty: true, head: fingerprint, fingerprint, untracked: [] }
    },
    refs: async () => ({ oids: new Map(), upstreams: new Map() }),
    diff: async (dir, base) => {
      const entries = await localDiff(dir, base)
      return {
        files: entries.length,
        additions: entries.reduce((sum, item) => sum + item.additions, 0),
        deletions: entries.reduce((sum, item) => sum + item.deletions, 0),
      }
    },
  }
}

class RecordingGitOps extends GitOps {
  readonly commands: Array<{ args: string[]; cwd: string }> = []
  worktreeCalls = 0
  aheadCalls = 0

  constructor() {
    super({ log: () => undefined })
  }

  override execGitBuffer(args: string[], cwd: string): Promise<ExecBufferResult> {
    this.commands.push({ args, cwd })
    return super.execGitBuffer(args, cwd)
  }

  override listWorktreePaths(cwd: string): Promise<Map<string, string>> {
    this.worktreeCalls++
    return super.listWorktreePaths(cwd)
  }

  override aheadBehind(cwd: string, base: string): Promise<{ ahead: number; behind: number }> {
    this.aheadCalls++
    return super.aheadBehind(cwd, base)
  }
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
  it("uses isolated ref worktree maps for linked worktrees in two repositories", async () => {
    const roots = await Promise.all([
      fs.promises.mkdtemp(path.join(os.tmpdir(), "gsp-isolated-one-")),
      fs.promises.mkdtemp(path.join(os.tmpdir(), "gsp-isolated-two-")),
    ])
    const linked = roots.map((root) => path.join(root, "linked"))
    try {
      for (const [index, root] of roots.entries()) {
        run(root, ["init", "-b", "main"])
        run(root, ["config", "commit.gpgsign", "false"])
        await fs.promises.writeFile(path.join(root, "file.txt"), `${index}\n`)
        run(root, ["add", "."])
        run(root, ["commit", "-m", "base"])
        run(root, ["remote", "add", "origin", "."])
        run(root, ["update-ref", "refs/remotes/origin/main", "HEAD"])
        run(root, ["branch", "--set-upstream-to=origin/main", "main"])
        run(root, ["worktree", "add", "-b", "feature", linked[index]!, "main"])
      }

      const recorders = roots.map(() => new RecordingGitOps())
      const pollers = roots.map(
        (root, index) =>
          new GitStatsPoller({
            getWorktrees: () => [{ ...worktree(`wt-${index}`), branch: "feature", path: linked[index]! }],
            getWorkspaceRoot: () => root,
            onStats: () => undefined,
            onLocalStats: () => undefined,
            log: () => undefined,
            intervalMs: 500,
            git: recorders[index]!,
          }),
      )

      pollers.forEach((poller) => poller.setEnabled(true))
      await Promise.all(recorders.map((git) => waitFor(() => git.aheadCalls >= 2, 2_000)))
      pollers.forEach((poller) => poller.stop())

      for (const [index, git] of recorders.entries()) {
        expect(git.worktreeCalls).toBe(0)
        expect(git.aheadCalls).toBe(2)
        expect(git.commands.some((item) => item.args[1]?.includes("%(worktreepath)"))).toBe(true)
        expect(git.commands.some((item) => item.cwd === roots[index])).toBe(true)
      }
    } finally {
      await Promise.all(roots.map((root) => fs.promises.rm(root, { recursive: true, force: true })))
    }
  })

  it("falls back to worktree listing and aheadBehind for detached worktrees", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-fallback-"))
    const named = path.join(root, "named")
    const detached = path.join(root, "detached")
    try {
      run(root, ["init", "-b", "main"])
      run(root, ["config", "commit.gpgsign", "false"])
      await fs.promises.writeFile(path.join(root, "file.txt"), "base\n")
      run(root, ["add", "."])
      run(root, ["commit", "-m", "base"])
      run(root, ["remote", "add", "origin", "."])
      run(root, ["update-ref", "refs/remotes/origin/main", "HEAD"])
      run(root, ["worktree", "add", "-b", "feature", named, "main"])
      run(root, ["worktree", "add", "--detach", detached, "main"])

      const git = new RecordingGitOps()
      const poller = new GitStatsPoller({
        getWorktrees: () => [
          { ...worktree("named"), branch: "feature", path: named },
          { ...worktree("detached"), branch: "HEAD", path: detached },
        ],
        getWorkspaceRoot: () => root,
        onStats: () => undefined,
        onLocalStats: () => undefined,
        log: () => undefined,
        intervalMs: 500,
        git,
      })

      poller.setEnabled(true)
      await waitFor(() => git.worktreeCalls >= 1 && git.aheadCalls >= 2, 2_000)
      poller.stop()

      expect(git.commands.filter((item) => item.args[0] === "for-each-ref")).toHaveLength(1)
      expect(git.worktreeCalls).toBe(1)
      expect(git.aheadCalls).toBeGreaterThan(0)
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true })
    }
  })

  it("falls back to worktree listing when ref metadata is incomplete", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-incomplete-"))
    const named = path.join(root, "named")
    try {
      run(root, ["init", "-b", "main"])
      run(root, ["config", "commit.gpgsign", "false"])
      await fs.promises.writeFile(path.join(root, "file.txt"), "base\n")
      run(root, ["add", "."])
      run(root, ["commit", "-m", "base"])
      run(root, ["worktree", "add", "-b", "feature", named, "main"])

      const git = new RecordingGitOps()
      const poller = new GitStatsPoller({
        getWorktrees: () => [{ ...worktree("named"), branch: "feature", path: named }],
        getWorkspaceRoot: () => root,
        source: {
          status: async () => ({ branch: "feature", dirty: false, head: "head", fingerprint: "stamp", untracked: [] }),
          refs: async () => ({ oids: new Map([["refs/heads/feature", "head"]]), upstreams: new Map() }),
          diff: async () => ({ files: 0, additions: 0, deletions: 0 }),
        },
        onStats: () => undefined,
        onLocalStats: () => undefined,
        log: () => undefined,
        intervalMs: 500,
        git,
      })

      poller.setEnabled(true)
      await waitFor(() => git.worktreeCalls >= 1, 2_000)
      poller.stop()

      expect(git.worktreeCalls).toBe(1)
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true })
    }
  })

  it("uses only status and shared snapshots on an unchanged second poll", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gsp-optimized-"))
    try {
      const run = (args: string[]) => {
        const result = Bun.spawnSync({
          cmd: ["git", ...args],
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Test",
            GIT_AUTHOR_EMAIL: "test@example.com",
            GIT_COMMITTER_NAME: "Test",
            GIT_COMMITTER_EMAIL: "test@example.com",
          },
        })
        if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))
      }
      run(["init", "-b", "main"])
      await fs.promises.writeFile(path.join(root, "file.txt"), "one\n")
      run(["add", "."])
      run(["commit", "-m", "base"])
      run(["remote", "add", "origin", "."])
      run(["update-ref", "refs/remotes/origin/main", "HEAD"])
      run(["branch", "--set-upstream-to=origin/main", "main"])

      const git = new RecordingGitOps()
      const poller = new GitStatsPoller({
        getWorktrees: () => [],
        getWorkspaceRoot: () => root,
        onStats: () => undefined,
        onLocalStats: () => undefined,
        log: () => undefined,
        intervalMs: 10,
        git,
      })

      poller.setEnabled(true)
      await waitFor(() => git.commands.filter((item) => item.args.includes("--porcelain=v2")).length >= 2, 2_000)
      const statuses = git.commands
        .map((item, index) => ({ ...item, index }))
        .filter((item) => item.args.includes("--porcelain=v2"))
      const second = git.commands.slice(statuses[1]!.index - 1)
      expect(second.filter((item) => item.args.includes("diff"))).toHaveLength(0)
      expect(git.aheadCalls).toBe(1)

      const diffs = git.commands.filter((item) => item.args.includes("diff")).length
      await fs.promises.writeFile(path.join(root, "file.txt"), "changed and larger\n")
      await waitFor(() => git.commands.filter((item) => item.args.includes("diff")).length > diffs, 2_000)

      const ahead = git.aheadCalls
      poller.stop()
      await poller.snapshot(true)
      expect(git.aheadCalls).toBe(ahead + 1)
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true })
    }
  })

  it("keeps hot worktrees on every tick and rotates clean dormant worktrees", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "gsp-shard-"))
    const dirs = ["a", "b", "c"].map((id) => path.join(root, id))
    try {
      const run = (cwd: string, args: string[]) => {
        const result = Bun.spawnSync({
          cmd: ["git", ...args],
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Test",
            GIT_AUTHOR_EMAIL: "test@example.com",
            GIT_COMMITTER_NAME: "Test",
            GIT_COMMITTER_EMAIL: "test@example.com",
          },
        })
        if (result.exitCode !== 0) throw new Error(Buffer.from(result.stderr).toString("utf8"))
      }
      await fs.promises.mkdir(dirs[0]!)
      run(dirs[0]!, ["init", "-b", "main"])
      await fs.promises.writeFile(path.join(dirs[0]!, "file.txt"), "one\n")
      run(dirs[0]!, ["add", "."])
      run(dirs[0]!, ["commit", "-m", "base"])
      run(dirs[0]!, ["remote", "add", "origin", "."])
      run(dirs[0]!, ["update-ref", "refs/remotes/origin/main", "HEAD"])
      run(dirs[0]!, ["branch", "--set-upstream-to=origin/main", "main"])
      run(dirs[0]!, ["worktree", "add", "-b", "branch-b", dirs[1]!, "main"])
      run(dirs[0]!, ["worktree", "add", "-b", "branch-c", dirs[2]!, "main"])

      const git = new RecordingGitOps()
      const hot = new Set(["a"])
      const poller = new GitStatsPoller({
        getWorktrees: () =>
          dirs.map((dir, index) => ({
            ...worktree(String.fromCharCode(97 + index)),
            path: dir,
            branch: index === 0 ? "main" : `branch-${String.fromCharCode(97 + index)}`,
          })),
        getWorkspaceRoot: () => dirs[0],
        getHotWorktreeIds: () => hot,
        onStats: () => undefined,
        onLocalStats: () => undefined,
        log: () => undefined,
        intervalMs: 10,
        dormantIntervalMs: 30,
        git,
      })

      poller.setEnabled(true)
      await waitFor(() => git.commands.filter((item) => item.args.includes("--porcelain=v2")).length >= 15, 3_000)
      poller.stop()
      const counts = new Map<string, number>()
      for (const item of git.commands) {
        if (!item.args.includes("--porcelain=v2")) continue
        counts.set(item.cwd, (counts.get(item.cwd) ?? 0) + 1)
      }
      expect(counts.get(dirs[0]!)).toBeGreaterThan(counts.get(dirs[1]!) ?? 0)
      expect(counts.get(dirs[1]!)).toBeGreaterThan(2)
      expect(counts.get(dirs[2]!)).toBeGreaterThan(2)
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true })
    }
  })

  it("keeps mutual exclusion when a stale fetch finishes after a restart", async () => {
    let calls = 0
    let running = 0
    let max = 0
    let gate: (() => void) | undefined
    const gated = new Promise<void>((resolve) => {
      gate = resolve
    })
    const localDiff = async () => {
      calls += 1
      running += 1
      max = Math.max(max, running)
      if (calls === 1) await gated
      running -= 1
      return [{ ...diff(1, 0)[0], stamp: `s${calls}` }]
    }
    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/tmp",
      source: source(localDiff, "main"),
      onStats: () => undefined,
      onLocalStats: () => undefined,
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "rev-parse" && args[2] === "HEAD") return "main"
        if (args[0] === "symbolic-ref") return "origin/main"
        if (args[0] === "rev-list") return "0	0"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => calls === 1)
    // Restart while the first fetch is in flight, then let it finish. The
    // stale finally must not clear the busy flag owned by the new poll.
    poller.stop()
    poller.setEnabled(true)
    await waitFor(() => calls === 2)
    gate?.()
    await waitFor(() => calls >= 3)
    poller.stop()

    // The gated first fetch and the restarted poll overlapped by
    // construction; no further overlap may occur after the restart.
    expect(max).toBeLessThanOrEqual(2)
  })

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
      source: source(localDiff),
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
      source: source(localDiff),
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
      source: source(async () => {
        throw new Error("should not be called when backend unavailable path")
      }),
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
      source: source(async () => diff(0, 0)),
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
      source: source(async (dir) => {
        calls.push(dir)
        return diff(1, 1)
      }),
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

  it("treats symlink-aliased worktree paths as present via realpath canonicalization", async () => {
    // git worktree list --porcelain realpath-resolves worktree registration, so
    // a worktree registered through a symlink alias (e.g. /tmp -> /private/tmp
    // on macOS) is reported under its realpath. The probe must canonicalize the
    // session's lexical alias the same way, or a real worktree is marked missing
    // and its stats are excluded.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-symlink-"))
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "gsp-symlink-real-"))
    const alias = path.join(root, "alias")
    fs.symlinkSync(real, alias)

    const presence: WorktreePresenceResult[] = []
    const calls: string[] = []
    const emitted: Array<Array<{ worktreeId: string; additions: number; deletions: number }>> = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [{ ...worktree("a"), path: alias }],
      getWorkspaceRoot: () => root,
      source: source(async (dir) => {
        calls.push(dir)
        return diff(3, 2)
      }),
      onStats: (stats) => emitted.push(stats),
      onLocalStats: () => undefined,
      onWorktreePresence: (result) => presence.push(result),
      log: () => undefined,
      intervalMs: 5,
      git: gitOps(async (args) => {
        if (args[0] === "worktree") {
          return `worktree ${real}\nbranch refs/heads/branch-a\n`
        }
        if (args[0] === "rev-parse" && args[3] === "@{upstream}") return "origin/main"
        if (args[0] === "rev-list") return "1"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => presence.length >= 1 && emitted.length >= 1)
    poller.stop()
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(real, { recursive: true, force: true })

    expect(presence[0]).toEqual({
      worktrees: [{ worktreeId: "a", missing: false, branch: "branch-a" }],
      degraded: false,
    })
    expect(calls.some((dir) => dir === alias)).toBe(true)
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
      source: source(localDiff, "feature"),
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

  it("uses advertised remote HEAD when local <remote>/HEAD is stale", async () => {
    const emitted: Array<{
      branch: string
      files: number
      additions: number
      deletions: number
      ahead: number
      behind: number
    }> = []
    const bases: string[] = []

    const poller = new GitStatsPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/workspace",
      source: source(async (_dir, base) => {
        bases.push(base)
        return diff(10, 4)
      }, "my-feature"),
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
        // The remote moved to develop, but this clone still records master.
        if (args[0] === "ls-remote") return "ref: refs/heads/develop\tHEAD\nabc123\tHEAD"
        if (args[0] === "symbolic-ref" && args[2] === "refs/remotes/myfork/HEAD") return "myfork/master"
        if (args[0] === "branch") return "my-feature"
        if (args[0] === "rev-list" && args[1] === "--left-right") return "0\t5"
        return ""
      }),
    })

    poller.setEnabled(true)
    await waitFor(() => emitted.length >= 1)
    poller.stop()

    expect(emitted[0]).toEqual({ branch: "my-feature", files: 1, additions: 10, deletions: 4, ahead: 5, behind: 0 })
    expect(bases[0]).toBe("myfork/develop")
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
      source: source(async () => diff(0, 0), "orphan-branch"),
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
      source: source(async () => diff(0, 0)),
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
    // The injected diff source is a synchronous promise. The poller does not
    // wrap it in a semaphore because GitOps gates at the child-process layer,
    // many worktrees can have their diffs computed concurrently without
    // contending for a dedicated outer gate.
    let running = 0
    let peak = 0
    let ticks = 0

    const wts = Array.from({ length: 5 }, (_, i) => worktree(String(i)))
    const poller = new GitStatsPoller({
      getWorktrees: () => wts,
      getWorkspaceRoot: () => undefined,
      source: source(async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(20)
        running--
        return diff(1, 0)
      }),
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
      source: source(async () => diff(1, 0)),
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
