import type { HttpClient } from "../services/cli-backend"
import type { Worktree } from "./WorktreeStateManager"
import type { GitOps } from "./GitOps"

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
  git: GitOps
  onStats: (stats: WorktreeStats[]) => void
  onLocalStats: (stats: LocalStats) => void
  log: (...args: unknown[]) => void
  intervalMs?: number
}

export class GitStatsPoller {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active = false
  private busy = false
  private lastHash: string | undefined
  private lastLocalHash: string | undefined
  private lastLocalStats: LocalStats | undefined
  private lastStats: Record<string, { additions: number; deletions: number; commits: number }> = {}
  private readonly intervalMs: number
  private readonly git: GitOps

  constructor(private readonly options: GitStatsPollerOptions) {
    this.intervalMs = options.intervalMs ?? 5000
    this.git = options.git
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
    this.lastLocalStats = undefined
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
            const commits = await this.git.countMissingOriginCommits(wt.path, wt.parentBranch)
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
      const branch = await this.git.currentBranch(root)
      if (!branch || branch === "HEAD") return

      const tracking = await this.git.resolveTrackingBranch(root, branch)

      // When the HTTP client is unavailable, preserve last-known stats rather
      // than emitting zeros (which would falsely indicate a clean state).
      if (!client) {
        if (this.lastLocalStats && this.lastLocalStats.branch === branch) return
        const stats: LocalStats = { branch, additions: 0, deletions: 0, commits: 0 }
        const hash = `local:${branch}:0:0:0`
        if (hash === this.lastLocalHash) return
        this.lastLocalHash = hash
        this.lastLocalStats = stats
        this.options.onLocalStats(stats)
        return
      }

      // When no tracking branch exists (e.g. new local branch with no upstream
      // and no origin/<branch> ref), compute diff+commit stats against the
      // repo's default branch so the UI still shows meaningful numbers.
      const base = tracking ?? (await this.git.resolveDefaultBranch(root, branch))

      let additions: number
      let deletions: number
      let commits: number
      try {
        if (base) {
          const diffs = await client.getWorktreeDiff(root, base)
          additions = diffs.reduce((sum, d) => sum + d.additions, 0)
          deletions = diffs.reduce((sum, d) => sum + d.deletions, 0)
          commits = await this.git.countMissingOriginCommits(root, base)
        } else {
          additions = 0
          deletions = 0
          commits = 0
        }
      } catch (err) {
        this.options.log("Failed to fetch local diff stats:", err)
        if (this.lastLocalStats && this.lastLocalStats.branch === branch) return
        return
      }

      const hash = `local:${branch}:${additions}:${deletions}:${commits}`
      if (hash === this.lastLocalHash) return
      this.lastLocalHash = hash

      const stats: LocalStats = { branch, additions, deletions, commits }
      this.lastLocalStats = stats
      this.options.onLocalStats(stats)
    } catch (err) {
      this.options.log("Failed to fetch local stats:", err)
    }
  }
}
