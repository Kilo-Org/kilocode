import * as fs from "fs"
import * as path from "path"
import type { KiloClient, FileDiff } from "@kilocode/sdk/v2/client"
import { remoteRef, type Worktree } from "./WorktreeStateManager"
import type { GitOps } from "./GitOps"
import { normalizePath } from "./git-import"

export interface WorktreeStats {
  worktreeId: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

export interface LocalStats {
  branch: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

export interface WorktreePresence {
  worktreeId: string
  missing: boolean
}

export interface WorktreePresenceResult {
  worktrees: WorktreePresence[]
  degraded: boolean
}

// kilocode_change start - lightweight stats response type
interface DiffStats {
  files: number
  additions: number
  deletions: number
}
// kilocode_change end

interface GitStatsPollerOptions {
  getWorktrees: () => Worktree[]
  getWorkspaceRoot: () => string | undefined
  getClient: () => KiloClient
  getServerConfig?: () => { baseUrl: string; password: string } | null // kilocode_change
  git: GitOps
  onStats: (stats: WorktreeStats[]) => void
  onLocalStats: (stats: LocalStats) => void
  onWorktreePresence?: (result: WorktreePresenceResult) => void
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
  private lastStats: Record<
    string,
    { files: number; additions: number; deletions: number; ahead: number; behind: number }
  > = {}
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
        return this.options.getClient()
      } catch (err) {
        this.options.log("Failed to get client for stats:", err)
        return undefined
      }
    })()

    await Promise.all([this.fetchWorktreeStats(client), this.fetchLocalStats(client)])
  }

  private async fetchWorktreeStats(client: KiloClient | undefined): Promise<void> {
    const worktrees = this.options.getWorktrees()
    if (worktrees.length === 0) return

    const presence = await this.probeWorktreePresence(worktrees)
    this.options.onWorktreePresence?.(presence)

    if (!client) return

    const missing = new Set(
      presence.degraded ? [] : presence.worktrees.filter((item) => item.missing).map((item) => item.worktreeId),
    )
    const active = worktrees.filter((wt) => !missing.has(wt.id))
    if (active.length === 0) {
      if (this.lastHash === "") return
      this.lastHash = ""
      this.lastStats = {}
      this.options.onStats([])
      return
    }

    // kilocode_change start - use lightweight stats endpoint, fetch worktrees sequentially to avoid git contention
    const tStats = performance.now()
    const stats: WorktreeStats[] = []
    for (const wt of active) {
      try {
        const tWt = performance.now()
        const base = remoteRef(wt)
        const [diffStats, ab] = await Promise.all([
          this.resolveDiffStats(wt.path, base, client),
          this.git.aheadBehind(wt.path, base, wt.remote),
        ])
        this.options.log(`[PERF] GitStatsPoller worktree ${wt.branch}: ${Math.round(performance.now() - tWt)}ms`)
        if (diffStats) {
          stats.push({
            worktreeId: wt.id,
            files: diffStats.files,
            additions: diffStats.additions,
            deletions: diffStats.deletions,
            ahead: ab.ahead,
            behind: ab.behind,
          })
        }
      } catch (err) {
        this.options.log(`Failed to fetch worktree stats for ${wt.branch} (${wt.path}):`, err)
        const prev = this.lastStats[wt.id]
        if (!prev) continue
        stats.push({
          worktreeId: wt.id,
          files: prev.files,
          additions: prev.additions,
          deletions: prev.deletions,
          ahead: prev.ahead,
          behind: prev.behind,
        })
      }
    }
    this.options.log(
      `[PERF] GitStatsPoller fetchWorktreeStats TOTAL: ${Math.round(performance.now() - tStats)}ms, ${active.length} worktrees`,
    )
    // kilocode_change end

    if (stats.length === 0) return

    const hash = stats
      .map(
        (item) => `${item.worktreeId}:${item.files}:${item.additions}:${item.deletions}:${item.ahead}:${item.behind}`,
      )
      .join("|")
    if (hash === this.lastHash) return
    this.lastHash = hash
    this.lastStats = stats.reduce(
      (acc, item) => {
        acc[item.worktreeId] = {
          files: item.files,
          additions: item.additions,
          deletions: item.deletions,
          ahead: item.ahead,
          behind: item.behind,
        }
        return acc
      },
      {} as Record<string, { files: number; additions: number; deletions: number; ahead: number; behind: number }>,
    )

    this.options.onStats(stats)
  }

  private async probeWorktreePresence(worktrees: Worktree[]): Promise<WorktreePresenceResult> {
    const root = this.options.getWorkspaceRoot()
    if (!root) {
      return { worktrees: [], degraded: true }
    }

    const tracked = await this.git.listWorktreePaths(root).catch((err) => {
      this.options.log("Failed to list worktree paths:", err)
      return undefined
    })
    if (!tracked) {
      return { worktrees: [], degraded: true }
    }

    const worktreeStatuses = await Promise.all(
      worktrees.map(async (wt) => {
        const abs = path.isAbsolute(wt.path) ? wt.path : path.join(root, wt.path)
        const normalized = normalizePath(abs)
        const exists = await fs.promises.access(abs).then(
          () => true,
          () => false,
        )
        const missing = !exists || !tracked.has(normalized)
        return { worktreeId: wt.id, missing }
      }),
    )

    return { worktrees: worktreeStatuses, degraded: false }
  }

  private async fetchLocalStats(client: KiloClient | undefined): Promise<void> {
    const root = this.options.getWorkspaceRoot()
    if (!root) return

    try {
      const branch = await this.git.currentBranch(root)
      if (!branch || branch === "HEAD") return

      const tracking = await this.git.resolveTrackingBranch(root, branch)
      const base = tracking ?? (await this.git.resolveDefaultBranch(root, branch))
      const remote = await this.git.resolveRemote(root, branch).catch(() => undefined)

      let files: number
      let additions: number
      let deletions: number
      let ahead: number
      let behind: number
      try {
        // kilocode_change start - use lightweight stats endpoint
        if (base) {
          this.options.log(`Local stats: using stats endpoint with base=${base}`)
          const [diffStats, ab] = await Promise.all([
            this.resolveDiffStats(root, base, client),
            this.git.aheadBehind(root, base, remote),
          ])
          if (diffStats) {
            files = diffStats.files
            additions = diffStats.additions
            deletions = diffStats.deletions
            ahead = ab.ahead
            behind = ab.behind
          } else {
            // Stats endpoint not available, fall back to git
            const wt = await this.git.workingTreeStats(root)
            files = wt.files
            additions = wt.additions
            deletions = wt.deletions
            ahead = ab.ahead
            behind = ab.behind
          }
        } else {
          // kilocode_change end
          this.options.log(`Local stats: fallback to workingTreeStats (base=${base ?? "none"} client=${!!client})`)
          const wt = await this.git.workingTreeStats(root)
          files = wt.files
          additions = wt.additions
          deletions = wt.deletions
          ahead = 0
          behind = 0
        }
      } catch (err) {
        this.options.log("Failed to fetch local diff stats:", err)
        if (this.lastLocalStats && this.lastLocalStats.branch === branch) return
        return
      }

      const hash = `local:${branch}:${files}:${additions}:${deletions}:${ahead}:${behind}`
      if (hash === this.lastLocalHash) {
        this.options.log(`Local stats: unchanged (${hash})`)
        return
      }
      this.lastLocalHash = hash

      this.options.log(`Local stats: emitting files=${files} +${additions} -${deletions} ↑${ahead} ↓${behind}`)
      const stats: LocalStats = { branch, files, additions, deletions, ahead, behind }
      this.lastLocalStats = stats
      this.options.onLocalStats(stats)
    } catch (err) {
      this.options.log("Failed to fetch local stats:", err)
    }
  }

  // kilocode_change start - lightweight stats fetch via /experimental/worktree/stats
  private async resolveDiffStats(
    directory: string,
    base: string,
    client: KiloClient | undefined,
  ): Promise<DiffStats | undefined> {
    const stats = await this.fetchDiffStats(directory, base)
    if (stats) return stats
    if (!client) return undefined

    const { data: diffs } = await client.worktree.diff({ directory, base }, { throwOnError: true })
    const files = diffs.length
    const additions = diffs.reduce((sum: number, diff: FileDiff) => sum + diff.additions, 0)
    const deletions = diffs.reduce((sum: number, diff: FileDiff) => sum + diff.deletions, 0)
    return { files, additions, deletions }
  }

  private async fetchDiffStats(directory: string, base: string): Promise<DiffStats | undefined> {
    const config = this.options.getServerConfig?.()
    if (!config) return undefined

    const params = new URLSearchParams({ directory, base })
    const response = await fetch(`${config.baseUrl}/experimental/worktree/stats?${params}`, {
      headers: { Authorization: `Basic ${Buffer.from(`kilo:${config.password}`).toString("base64")}` },
    })
    if (!response.ok) return undefined
    return (await response.json()) as DiffStats
  }
  // kilocode_change end
}
