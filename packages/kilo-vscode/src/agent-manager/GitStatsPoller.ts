import * as fs from "fs"
import * as path from "path"
import { remoteRef, type Worktree } from "./WorktreeStateManager"
import type { GitOps } from "./GitOps"
import type { Semaphore } from "./semaphore"
import { findTrackedBranch } from "./project/paths"
import type { WorktreeDiffEntry } from "./types"

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
  /**
   * Compute diff summaries locally (in the extension host) rather than over
   * HTTP to `kilo serve`. Keeps git spawning out of the Bun process, which
   * leaks native memory on Windows (oven-sh/bun#18265).
   */
  localDiff: (dir: string, base: string) => Promise<WorktreeDiffEntry[]>
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
  private lastStats: Record<string, WorktreeStats> = {}
  private readonly intervalMs: number
  private readonly hiddenIntervalMs: number
  private readonly git: GitOps
  private skipWorktreeIds = new Set<string>()
  private visible = true
  private generation = 0

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

  /** Replace the entire skip set with the given IDs. */
  syncSkips(ids: Set<string>): WorktreeStats[] | undefined {
    this.skipWorktreeIds = ids
    const stats = Object.values(this.lastStats).filter((item) => !ids.has(item.worktreeId))
    if (stats.length === 0) return undefined
    const hash = this.hash(stats)
    if (hash === this.lastHash) return undefined
    this.lastHash = hash
    return stats
  }

  /** Pre-emptively exclude a single worktree (e.g. before deletion). */
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
    this.generation++
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

  async snapshot(refresh = false): Promise<{ worktrees: WorktreeStats[]; local?: LocalStats }> {
    if (refresh && !this.busy) {
      this.busy = true
      await Promise.all([this.fetchWorktreeStats(true), this.fetchLocalStats()]).finally(() => {
        this.busy = false
      })
    }
    return {
      worktrees: Object.values(this.lastStats),
      ...(this.lastLocalStats ? { local: this.lastLocalStats } : {}),
    }
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
    const generation = this.generation
    return this.fetch(generation).finally(() => {
      // stop() already reset busy and bumped the generation, so a stale
      // fetch must not touch busy: a restarted poll may own it right now.
      if (generation !== this.generation) return
      this.busy = false
      this.schedule(this.currentInterval())
    })
  }

  private async fetch(generation = this.generation): Promise<void> {
    await Promise.all([this.fetchWorktreeStats(false, generation), this.fetchLocalStats(generation)])
  }

  private async fetchWorktreeStats(includeSkipped = false, generation = this.generation): Promise<void> {
    const worktrees = this.options.getWorktrees()
    if (worktrees.length === 0) return

    const presence = await this.probeWorktreePresence(worktrees)
    if (generation !== this.generation) return
    this.options.onWorktreePresence?.(presence)

    const missing = new Set(
      presence.degraded ? [] : presence.worktrees.filter((item) => item.missing).map((item) => item.worktreeId),
    )
    const available = worktrees.filter((wt) => !missing.has(wt.id))
    const ids = new Set(available.map((wt) => wt.id))
    for (const id of Object.keys(this.lastStats)) {
      if (!ids.has(id)) delete this.lastStats[id]
    }
    const active = includeSkipped ? available : available.filter((wt) => !this.skipWorktreeIds.has(wt.id))
    if (active.length === 0) {
      if (available.length > 0) return
      if (this.lastHash === "") return
      this.lastHash = ""
      this.lastStats = {}
      this.options.onStats([])
      return
    }

    // localDiff runs in-process via GitOps.execGit() which already acquires
    // the shared semaphore internally; same goes for aheadBehind via
    // GitOps.raw(). Wrapping either again here would deadlock.
    const stats = (
      await Promise.all(
        active.map(async (wt) => {
          try {
            const base = remoteRef(wt)
            const [diffs, ab] = await Promise.all([
              this.options.localDiff(wt.path, base),
              this.git.aheadBehind(wt.path, base),
            ])
            const files = diffs.length
            const additions = diffs.reduce((sum, diff) => sum + diff.additions, 0)
            const deletions = diffs.reduce((sum, diff) => sum + diff.deletions, 0)
            return { worktreeId: wt.id, files, additions, deletions, ahead: ab.ahead, behind: ab.behind }
          } catch (err) {
            this.options.log(`Failed to fetch worktree stats for ${wt.branch} (${wt.path}):`, err)
            return this.lastStats[wt.id]
          }
        }),
      )
    ).filter((item): item is WorktreeStats => !!item)
    if (generation !== this.generation) return

    for (const item of stats) this.lastStats[item.worktreeId] = item

    const visible = Object.values(this.lastStats).filter((item) => !this.skipWorktreeIds.has(item.worktreeId))
    if (visible.length === 0) return

    const hash = this.hash(visible)
    if (hash === this.lastHash) return
    this.lastHash = hash
    this.options.onStats(visible)
  }

  private hash(stats: WorktreeStats[]): string {
    return stats
      .map(
        (item) => `${item.worktreeId}:${item.files}:${item.additions}:${item.deletions}:${item.ahead}:${item.behind}`,
      )
      .join("|")
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
        const exists = await fs.promises.access(abs).then(
          () => true,
          () => false,
        )
        const branch = exists ? findTrackedBranch(tracked, abs) : undefined
        const missing = !exists || branch === undefined
        return { worktreeId: wt.id, missing, branch }
      }),
    )

    return { worktrees: worktreeStatuses, degraded: false }
  }

  private async fetchLocalStats(generation = this.generation): Promise<void> {
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
        if (base) {
          this.options.log(`Local stats: using localDiff with base=${base}`)
          const [diffs, ab] = await Promise.all([this.options.localDiff(root, base), this.git.aheadBehind(root, base)])
          files = diffs.length
          additions = diffs.reduce((sum, d) => sum + d.additions, 0)
          deletions = diffs.reduce((sum, d) => sum + d.deletions, 0)
          ahead = ab.ahead
          behind = ab.behind
        } else {
          this.options.log(`Local stats: fallback to workingTreeStats (no base branch)`)
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
      if (generation !== this.generation) return

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
