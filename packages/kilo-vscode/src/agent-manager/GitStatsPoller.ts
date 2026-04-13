import * as fs from "fs"
import * as path from "path"
import type { KiloClient, FileDiff } from "@kilocode/sdk/v2/client"
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
  private skipWorktreeIds = new Set<string>()
  private activeWorktreeId: string | undefined
  private tickCount = 0
  /** Poll all worktrees every N ticks; active worktree is polled every tick. */
  private static readonly FULL_SYNC_EVERY = 6
	/** Worktree ID that needs an immediate poll after the current in-flight fetch. */
	private pendingActiveWorktreeId: string | undefined

  constructor(private readonly options: GitStatsPollerOptions) {
    this.intervalMs = options.intervalMs ?? 5000
    this.git = options.git
  }

  skipWorktree(id: string): void {
    this.skipWorktreeIds.add(id)
  }

  unskipWorktree(id: string): void {
    this.skipWorktreeIds.delete(id)
  }

  /**
   * Mark the worktree whose session the user is actively viewing.
   * On most ticks only this worktree will be polled; all worktrees are
   * polled every {@link FULL_SYNC_EVERY} ticks.  Passing `undefined`
   * still uses the periodic full-sync cadence (avoids every-tick load).
   *
   * Mirrors {@link PRStatusPoller.setActiveWorktreeId}.
   */
  setActiveWorktreeId(id: string | undefined): void {
    const prev = this.activeWorktreeId
    this.activeWorktreeId = id
    // Immediately refresh the newly-active worktree so the user sees
    // up-to-date stats without waiting for the next scheduled tick.
    if (id && id !== prev && this.active) {
      if (this.busy) {
        // A fetch is in flight — queue the refresh so it runs right after.
        this.pendingActiveWorktreeId = id
      } else {
        void this.poll()
      }
    }
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
    this.tickCount = 0
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
      // If setActiveWorktreeId was called while we were fetching,
      // trigger the queued refresh immediately instead of waiting.
      if (this.pendingActiveWorktreeId) {
        this.pendingActiveWorktreeId = undefined
        void this.poll()
        return
      }
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
    const available = worktrees.filter((wt) => !missing.has(wt.id) && !this.skipWorktreeIds.has(wt.id))
    if (available.length === 0) {
      if (this.lastHash === "") return
      this.lastHash = ""
      this.lastStats = {}
      this.options.onStats([])
      return
    }

    // Most ticks only poll the active worktree for fast, cheap feedback.
    // Every FULL_SYNC_EVERY ticks poll all available worktrees so that
    // inactive ones stay reasonably current. When no active worktree is
    // set (e.g. after clearSession) non-full-sync ticks are skipped
    // entirely — stats from the last full sync remain cached.
    const isFullSync = this.tickCount % GitStatsPoller.FULL_SYNC_EVERY === 0
    let targets: Worktree[]
    if (isFullSync) {
      targets = available
    } else if (this.activeWorktreeId) {
      targets = available.filter((wt) => wt.id === this.activeWorktreeId)
    } else {
      // No active session and not a full-sync tick — skip polling entirely.
      // Stats from the last full sync remain in lastStats for the webview.
      targets = []
    }
    this.tickCount++

    // Gate the HTTP diffSummary call through the semaphore but NOT the
    // aheadBehind call — that goes through GitOps.raw() which already
    // acquires the same semaphore. Wrapping both would deadlock.
    const gate = this.options.semaphore
    const diff = (dir: string, base: string) => {
      const invoke = () => client.worktree.diffSummary({ directory: dir, base }, { throwOnError: true })
      return gate ? gate.run(invoke) : invoke()
    }
    await Promise.all(
      targets.map(async (wt) => {
        try {
          const base = remoteRef(wt)
          const [{ data: diffs }, ab] = await Promise.all([diff(wt.path, base), this.git.aheadBehind(wt.path, base)])
          const files = diffs.length
          const additions = diffs.reduce((sum: number, d: FileDiff) => sum + d.additions, 0)
          const deletions = diffs.reduce((sum: number, d: FileDiff) => sum + d.deletions, 0)
          this.lastStats[wt.id] = { files, additions, deletions, ahead: ab.ahead, behind: ab.behind }
        } catch (err) {
          this.options.log(`Failed to fetch worktree stats for ${wt.branch} (${wt.path}):`, err)
          // Keep the previous stats so the UI doesn't flash to zero.
        }
      }),
    )

    // Compute the hash across ALL non-missing worktrees (using cached
    // values for any that were not polled this tick).  This ensures the
    // hash is stable across partial and full polls, and that the webview
    // always receives a complete snapshot.
    const allStats: WorktreeStats[] = available.map((wt) => {
      const s = this.lastStats[wt.id]
      return s
        ? { worktreeId: wt.id, ...s }
        : { worktreeId: wt.id, files: 0, additions: 0, deletions: 0, ahead: 0, behind: 0 }
    })

    const hash = allStats
      .map(
        (item) => `${item.worktreeId}:${item.files}:${item.additions}:${item.deletions}:${item.ahead}:${item.behind}`,
      )
      .join("|")
    if (hash === this.lastHash) return
    this.lastHash = hash

    this.options.onStats(allStats)
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
          additions = diffs.reduce((sum: number, d: FileDiff) => sum + d.additions, 0)
          deletions = diffs.reduce((sum: number, d: FileDiff) => sum + d.deletions, 0)
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
