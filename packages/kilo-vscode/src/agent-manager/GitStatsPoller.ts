import * as fs from "fs"
import * as path from "path"
import type { KiloClient, SnapshotFileDiff } from "@kilocode/sdk/v2/client"
import { remoteRef, type Worktree } from "./WorktreeStateManager"
import type { GitOps } from "./GitOps"
import type { Semaphore } from "./semaphore"
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
  /** Current branch from `git worktree list`, if available. */
  branch?: string
}

export interface WorktreePresenceResult {
  worktrees: WorktreePresence[]
  degraded: boolean
}

interface GitStatsPollerOptions {
  getWorktrees: () => Worktree[]
  getWorkspaceRoot: () => string | undefined
  getClient: () => KiloClient
  git: GitOps
  onStats: (stats: WorktreeStats[]) => void
  onLocalStats: (stats: LocalStats) => void
  onWorktreePresence?: (result: WorktreePresenceResult) => void
  log: (...args: unknown[]) => void
  intervalMs?: number
  /** Shared concurrency gate for child process spawning. */
  semaphore?: Semaphore
  hiddenIntervalMs?: number
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
  private readonly hiddenIntervalMs: number
  private readonly git: GitOps
  private skipWorktreeIds = new Set<string>()
  private visible = true

  constructor(private readonly options: GitStatsPollerOptions) {
    this.intervalMs = options.intervalMs ?? 5000
    this.hiddenIntervalMs = options.hiddenIntervalMs ?? 60000
    this.git = options.git
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    if (this.active && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
      this.schedule(this.visible ? this.intervalMs : this.hiddenIntervalMs)
    }
  }

  skipWorktree(id: string): void {
    this.skipWorktreeIds.add(id)
  }

  unskipWorktree(id: string): void {
    this.skipWorktreeIds.delete(id)
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.active) return
      this.active = true
      void this.poll()
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

  private currentInterval(): number {
    return this.visible ? this.intervalMs : this.hiddenIntervalMs
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
      this.schedule(this.currentInterval())
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
    const active = worktrees.filter((wt) => !missing.has(wt.id) && !this.skipWorktreeIds.has(wt.id))
    if (active.length === 0) {
      if (this.lastHash === "") return
      this.lastHash = ""
      this.lastStats = {}
      this.options.onStats([])
      return
    }

    // Gate the HTTP diffSummary call through the semaphore but NOT the
    // aheadBehind call — that goes through GitOps.raw() which already
    // acquires the same semaphore. Wrapping both would deadlock.
    const gate = this.options.semaphore
    const diff = (dir: string, base: string) => {
      const invoke = () => client.worktree.diffSummary({ directory: dir, base }, { throwOnError: true })
      return gate ? gate.run(invoke) : invoke()
    }
    const stats = (
      await Promise.all(
        active.map(async (wt) => {
          try {
            const base = remoteRef(wt)
            const [{ data: diffs }, ab] = await Promise.all([diff(wt.path, base), this.git.aheadBehind(wt.path, base)])
            const files = diffs.length
            const additions = diffs.reduce((sum: number, diff: SnapshotFileDiff) => sum + diff.additions, 0)
            const deletions = diffs.reduce((sum: number, diff: SnapshotFileDiff) => sum + diff.deletions, 0)
            return { worktreeId: wt.id, files, additions, deletions, ahead: ab.ahead, behind: ab.behind }
          } catch (err) {
            this.options.log(`Failed to fetch worktree stats for ${wt.branch} (${wt.path}):`, err)
            const prev = this.lastStats[wt.id]
            if (!prev) return undefined
            return {
              worktreeId: wt.id,
              files: prev.files,
              additions: prev.additions,
              deletions: prev.deletions,
              ahead: prev.ahead,
              behind: prev.behind,
            }
          }
        }),
      )
    ).filter((item): item is WorktreeStats => !!item)

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
        const branch = tracked.get(normalized)
        return { worktreeId: wt.id, missing, branch }
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

      let files: number
      let additions: number
      let deletions: number
      let ahead: number
      let behind: number
      try {
        if (base && client) {
          this.options.log(`Local stats: using HTTP client with base=${base}`)
          const gate = this.options.semaphore
          const invoke = () => client.worktree.diffSummary({ directory: root, base }, { throwOnError: true })
          const [{ data: diffs }, ab] = await Promise.all([
            gate ? gate.run(invoke) : invoke(),
            this.git.aheadBehind(root, base),
          ])
          files = diffs.length
          additions = diffs.reduce((sum: number, d: SnapshotFileDiff) => sum + d.additions, 0)
          deletions = diffs.reduce((sum: number, d: SnapshotFileDiff) => sum + d.deletions, 0)
          ahead = ab.ahead
          behind = ab.behind
        } else {
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
}
