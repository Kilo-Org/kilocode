import * as cp from "child_process"
import * as nodePath from "path"
import type { HttpClient } from "../services/cli-backend"
import type { Worktree } from "./WorktreeStateManager"

export interface WorktreeStats {
  worktreeId: string
  additions: number
  deletions: number
  commits: number
}

export interface LocalStats {
  branch: string
  additions: number
  deletions: number
  commits: number
}

interface GitStatsPollerOptions {
  getWorktrees: () => Worktree[]
  getWorkspaceRoot: () => string | undefined
  getHttpClient: () => HttpClient
  onStats: (stats: WorktreeStats[]) => void
  onLocalStats: (stats: LocalStats) => void
  log: (...args: unknown[]) => void
  intervalMs?: number
  refreshMs?: number
  runGit?: (args: string[], cwd: string) => Promise<string>
}

export class GitStatsPoller {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active = false
  private busy = false
  private lastHash: string | undefined
  private lastLocalHash: string | undefined
  private lastStats: Record<string, { additions: number; deletions: number; commits: number }> = {}
  private lastFetch = new Map<string, number>()
  private inflightFetch = new Map<string, Promise<void>>()
  private readonly intervalMs: number
  private readonly refreshMs: number
  private readonly runGit: (args: string[], cwd: string) => Promise<string>

  constructor(private readonly options: GitStatsPollerOptions) {
    this.intervalMs = options.intervalMs ?? 5000
    this.refreshMs = options.refreshMs ?? 120000
    this.runGit =
      options.runGit ??
      ((args, cwd) =>
        new Promise((resolve, reject) => {
          cp.execFile("git", args, { cwd, timeout: 10000 }, (err, stdout) => {
            if (err) reject(err)
            else resolve(stdout.trim())
          })
        }))
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.active) return
      this.start()
      return
    }
    this.stop()
  }

  stop(): void {
    this.active = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.busy = false
    this.lastHash = undefined
    this.lastLocalHash = undefined
    this.lastStats = {}
  }

  private start(): void {
    this.stop()
    this.active = true
    void this.poll()
  }

  private schedule(delay: number): void {
    if (!this.active) return
    this.timer = setTimeout(() => {
      void this.poll()
    }, delay)
  }

  private poll(): Promise<void> {
    if (!this.active) return Promise.resolve()
    if (this.busy) return Promise.resolve()
    this.busy = true
    return this.fetch().finally(() => {
      this.busy = false
      this.schedule(this.intervalMs)
    })
  }

  private async fetch(): Promise<void> {
    const client = (() => {
      try {
        return this.options.getHttpClient()
      } catch (err) {
        this.options.log("Failed to get HTTP client for stats:", err)
        return undefined
      }
    })()

    await Promise.all([this.fetchWorktreeStats(client), this.fetchLocalStats(client)])
  }

  private async fetchWorktreeStats(client: HttpClient | undefined): Promise<void> {
    const worktrees = this.options.getWorktrees()
    if (worktrees.length === 0) return
    if (!client) return

    const stats = (
      await Promise.all(
        worktrees.map(async (wt) => {
          try {
            const diffs = await client.getWorktreeDiff(wt.path, wt.parentBranch)
            const additions = diffs.reduce((sum, diff) => sum + diff.additions, 0)
            const deletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0)
            const commits = await this.countMissingOriginCommits(wt.path, wt.parentBranch)
            return { worktreeId: wt.id, additions, deletions, commits }
          } catch (err) {
            this.options.log(`Failed to fetch worktree stats for ${wt.branch} (${wt.path}):`, err)
            const prev = this.lastStats[wt.id]
            if (!prev) return undefined
            return {
              worktreeId: wt.id,
              additions: prev.additions,
              deletions: prev.deletions,
              commits: prev.commits,
            }
          }
        }),
      )
    ).filter((item): item is WorktreeStats => !!item)

    if (stats.length === 0) return

    const hash = stats.map((item) => `${item.worktreeId}:${item.additions}:${item.deletions}:${item.commits}`).join("|")
    if (hash === this.lastHash) return
    this.lastHash = hash
    this.lastStats = stats.reduce(
      (acc, item) => {
        acc[item.worktreeId] = {
          additions: item.additions,
          deletions: item.deletions,
          commits: item.commits,
        }
        return acc
      },
      {} as Record<string, { additions: number; deletions: number; commits: number }>,
    )

    this.options.onStats(stats)
  }

  private async fetchLocalStats(client: HttpClient | undefined): Promise<void> {
    const root = this.options.getWorkspaceRoot()
    if (!root) return

    try {
      const branch = await this.gitExec(["rev-parse", "--abbrev-ref", "HEAD"], root).catch(() => "")
      if (!branch || branch === "HEAD") return

      const tracking = await this.resolveTrackingBranch(root, branch)

      const [additions, deletions, commits] = await (async () => {
        if (!tracking || !client) return [0, 0, 0] as const
        try {
          const diffs = await client.getWorktreeDiff(root, tracking)
          return [
            diffs.reduce((sum, d) => sum + d.additions, 0),
            diffs.reduce((sum, d) => sum + d.deletions, 0),
            await this.countMissingOriginCommits(root, tracking),
          ] as const
        } catch (err) {
          this.options.log("Failed to fetch local diff stats:", err)
          return [0, 0, 0] as const
        }
      })()

      const hash = `local:${branch}:${additions}:${deletions}:${commits}`
      if (hash === this.lastLocalHash) return
      this.lastLocalHash = hash

      this.options.onLocalStats({ branch, additions, deletions, commits })
    } catch (err) {
      this.options.log("Failed to fetch local stats:", err)
    }
  }

  private async resolveTrackingBranch(cwd: string, branch: string): Promise<string | undefined> {
    const upstream = await this.gitExec(["rev-parse", "--abbrev-ref", "@{upstream}"], cwd).catch(() => "")
    if (upstream) return upstream

    const ref = `origin/${branch}`
    const resolved = await this.gitExec(["rev-parse", "--verify", ref], cwd).catch(() => "")
    if (resolved) return ref

    return undefined
  }

  private gitExec(args: string[], cwd: string): Promise<string> {
    return this.runGit(args, cwd)
  }

  private hasRemoteRef(cwd: string, ref: string): Promise<boolean> {
    return this.gitExec(["rev-parse", "--verify", "--quiet", `refs/remotes/${ref}`], cwd)
      .then(() => true)
      .catch(() => false)
  }

  private async refreshRemote(cwd: string, remote: string): Promise<void> {
    if (!remote) return

    const commonRaw = await this.gitExec(["rev-parse", "--git-common-dir"], cwd).catch(() => cwd)
    const common = nodePath.isAbsolute(commonRaw) ? commonRaw : nodePath.resolve(cwd, commonRaw)
    const key = `${common}:${remote}`

    const existing = this.inflightFetch.get(key)
    if (existing) return existing

    const prev = this.lastFetch.get(key) ?? 0
    const now = Date.now()
    if (now - prev < this.refreshMs) return
    this.lastFetch.set(key, now)

    const job = this.gitExec(["fetch", "--quiet", "--no-tags", remote], cwd)
      .catch((err) => {
        this.options.log(`Failed to refresh remote refs for ${cwd}:`, err)
      })
      .then(() => undefined)
      .finally(() => {
        this.inflightFetch.delete(key)
      })
    this.inflightFetch.set(key, job)
    return job
  }

  private async countMissingOriginCommits(cwd: string, parentBranch: string): Promise<number> {
    const upstream = await this.gitExec(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      cwd,
    ).catch(() => "")

    const branch = await this.gitExec(["branch", "--show-current"], cwd).catch(() => "")
    const branchRemote = branch ? await this.gitExec(["config", `branch.${branch}.remote`], cwd).catch(() => "") : ""
    const upstreamRemote = upstream.includes("/") ? upstream.split("/")[0] : ""
    const remote = upstreamRemote || branchRemote || "origin"
    await this.refreshRemote(cwd, remote)

    if (upstream) {
      const count = await this.gitExec(["rev-list", "--count", `${upstream}..HEAD`], cwd).catch(() => "0")
      return parseInt(count, 10) || 0
    }

    const remoteBranch = branch ? `${remote}/${branch}` : ""
    const hasRemoteBranch = remoteBranch ? await this.hasRemoteRef(cwd, remoteBranch) : false

    const remoteParent = `${remote}/${parentBranch}`
    const hasRemoteParent = await this.hasRemoteRef(cwd, remoteParent)

    const ref = hasRemoteBranch ? remoteBranch : hasRemoteParent ? remoteParent : parentBranch
    const count = await this.gitExec(["rev-list", "--count", `${ref}..HEAD`], cwd).catch(() => "0")
    return parseInt(count, 10) || 0
  }
}
