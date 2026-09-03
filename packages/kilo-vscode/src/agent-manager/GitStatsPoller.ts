import * as fs from "fs"
import * as path from "path"
import { remoteRef, type Worktree } from "./WorktreeStateManager"
import type { GitOps } from "./GitOps"
import type { Semaphore } from "./semaphore"
import { findTrackedBranch } from "./project/paths"
import {
  GitStatsSnapshot,
  refOID,
  shortRef,
  type DiffStats,
  type RefSnapshot,
  type GitStatsSource,
} from "./git-stats-snapshot"

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
  getHotWorktreeIds?: () => Set<string>
  /** Override the real Git source in scheduler and failure-path tests. */
  source?: GitStatsSource
  git: GitOps
  onStats: (stats: WorktreeStats[]) => void
  onLocalStats: (stats: LocalStats) => void
  onWorktreePresence?: (result: WorktreePresenceResult) => void
  log: (...args: unknown[]) => void
  intervalMs?: number
  /** Shared concurrency gate for child process spawning. */
  semaphore?: Semaphore
  hiddenIntervalMs?: number
  dormantIntervalMs?: number
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
  private readonly dormantIntervalMs: number
  private readonly git: GitOps
  private readonly snapshots: GitStatsSource
  private readonly cache = new Map<string, CachedStats>()
  private localCache: CachedStats | undefined
  private skipWorktreeIds = new Set<string>()
  private visible = true
  private generation = 0
  private cursor = 0

  constructor(private readonly options: GitStatsPollerOptions) {
    this.intervalMs = options.intervalMs ?? 5000
    this.hiddenIntervalMs = options.hiddenIntervalMs ?? 60000
    this.dormantIntervalMs = options.dormantIntervalMs ?? 30000
    this.git = options.git
    this.snapshots = options.source ?? new GitStatsSnapshot(options.git)
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
    this.cache.clear()
    this.localCache = undefined
    this.cursor = 0
  }

  async snapshot(refresh = false): Promise<{ worktrees: WorktreeStats[]; local?: LocalStats }> {
    if (refresh && !this.busy) {
      this.busy = true
      const refs = await this.fetchRefs()
      await Promise.all([
        this.fetchWorktreeStats(true, this.generation, refs),
        this.fetchLocalStats(this.generation, refs, true),
      ]).finally(() => {
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
    const refs = await this.fetchRefs()
    await Promise.all([this.fetchWorktreeStats(false, generation, refs), this.fetchLocalStats(generation, refs)])
  }

  private async fetchWorktreeStats(
    includeSkipped = false,
    generation = this.generation,
    refs?: RefSnapshot,
  ): Promise<void> {
    const worktrees = this.options.getWorktrees()
    if (worktrees.length === 0) return

    const presence = await this.probeWorktreePresence(worktrees, refs)
    if (generation !== this.generation) return
    this.options.onWorktreePresence?.(presence)

    const missing = new Set(
      presence.degraded ? [] : presence.worktrees.filter((item) => item.missing).map((item) => item.worktreeId),
    )
    const available = worktrees.filter((wt) => !missing.has(wt.id))
    const ids = new Set(available.map((wt) => wt.id))
    for (const id of Object.keys(this.lastStats)) {
      if (!ids.has(id)) {
        delete this.lastStats[id]
        this.cache.delete(id)
      }
    }
    const candidates = includeSkipped ? available : available.filter((wt) => !this.skipWorktreeIds.has(wt.id))
    const active = includeSkipped ? candidates : this.select(candidates)
    if (active.length === 0) {
      if (available.length > 0) return
      if (this.lastHash === "") return
      this.lastHash = ""
      this.lastStats = {}
      this.options.onStats([])
      return
    }

    const stats = await this.fetchOptimized(active, refs, includeSkipped)
    if (generation !== this.generation) return

    for (const item of stats) this.lastStats[item.worktreeId] = item

    const visible = Object.values(this.lastStats).filter((item) => !this.skipWorktreeIds.has(item.worktreeId))
    if (visible.length === 0) return

    const hash = this.hash(visible)
    if (hash === this.lastHash) return
    this.lastHash = hash
    this.options.onStats(visible)
  }

  private async fetchOptimized(worktrees: Worktree[], refs: RefSnapshot | undefined, refresh: boolean) {
    const rows = await Promise.all(
      worktrees.map(async (wt) => {
        const base = remoteRef(wt)
        const baseOID = refOID(refs, base)
        try {
          const status = await this.snapshots.status(wt.path)
          const cached = this.cache.get(wt.id)
          const same =
            !refresh &&
            !!baseOID &&
            cached?.base === base &&
            cached.baseOID === baseOID &&
            cached.fingerprint === status.fingerprint
          const diff = same ? cached.diff : await this.snapshots.diff(wt.path, base, status.untracked)
          const ahead =
            !refresh && baseOID && cached?.head === status.head && cached.baseOID === baseOID
              ? cached.ahead
              : await this.git.aheadBehind(wt.path, base)
          return { wt, base, baseOID, status, diff, ahead }
        } catch (err) {
          this.options.log(`Failed to fetch worktree stats for ${wt.branch} (${wt.path}):`, err)
          return { wt, prior: this.lastStats[wt.id] }
        }
      }),
    )
    return rows
      .map((row) => {
        if ("prior" in row) return row.prior
        const stats = { worktreeId: row.wt.id, ...row.diff, ...row.ahead }
        this.cache.set(row.wt.id, {
          base: row.base,
          baseOID: row.baseOID,
          head: row.status.head,
          fingerprint: row.status.fingerprint,
          diff: row.diff,
          dirty: row.status.dirty,
          clean: row.status.dirty ? 0 : (this.cache.get(row.wt.id)?.clean ?? 0) + 1,
          ahead: row.ahead,
        })
        return stats
      })
      .filter((item): item is WorktreeStats => !!item)
  }

  private select(worktrees: Worktree[]): Worktree[] {
    if (!this.visible || worktrees.length === 0) return worktrees
    const hot = this.options.getHotWorktreeIds?.() ?? new Set<string>()
    const selected = worktrees.filter((wt) => {
      const cached = this.cache.get(wt.id)
      return hot.has(wt.id) || !cached || cached.dirty || cached.clean < 2
    })
    const ids = new Set(selected.map((wt) => wt.id))
    const dormant = worktrees.filter((wt) => !ids.has(wt.id))
    if (dormant.length === 0) return selected
    const ticks = Math.max(1, Math.ceil(this.dormantIntervalMs / this.intervalMs))
    const count = Math.max(1, Math.ceil(dormant.length / ticks))
    for (let i = 0; i < count; i++) {
      selected.push(dormant[(this.cursor + i) % dormant.length]!)
    }
    this.cursor = (this.cursor + count) % dormant.length
    return selected
  }

  private hash(stats: WorktreeStats[]): string {
    return stats
      .map(
        (item) => `${item.worktreeId}:${item.files}:${item.additions}:${item.deletions}:${item.ahead}:${item.behind}`,
      )
      .join("|")
  }

  private async probeWorktreePresence(worktrees: Worktree[], refs?: RefSnapshot): Promise<WorktreePresenceResult> {
    const root = this.options.getWorkspaceRoot()
    if (!root) {
      return { worktrees: [], degraded: true }
    }

    const paths = refs?.worktreePaths
    if (paths) {
      const items = await Promise.all(worktrees.map((wt) => this.presence(wt, root, paths)))
      if (items.every((item) => !item.missing)) return { worktrees: items, degraded: false }
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

  private async presence(wt: Worktree, root: string, paths: Map<string, string>): Promise<WorktreePresence> {
    const abs = path.isAbsolute(wt.path) ? wt.path : path.join(root, wt.path)
    const exists = await fs.promises.access(abs).then(
      () => true,
      () => false,
    )
    const branch = exists ? findTrackedBranch(paths, abs) : undefined
    return { worktreeId: wt.id, missing: !exists || branch === undefined, branch }
  }

  private async fetchLocalStats(generation = this.generation, refs?: RefSnapshot, refresh = false): Promise<void> {
    const root = this.options.getWorkspaceRoot()
    if (!root) return

    try {
      const status = await this.snapshots.status(root)
      const branch = status.branch
      if (!branch || branch === "HEAD") return
      const stats = await this.local(root, branch, status, refs, refresh).catch((err) => {
        this.options.log("Failed to fetch local diff stats:", err)
        return undefined
      })
      if (!stats) return
      if (generation !== this.generation) return

      const hash = `local:${branch}:${stats.files}:${stats.additions}:${stats.deletions}:${stats.ahead}:${stats.behind}`
      if (hash === this.lastLocalHash) {
        this.options.log(`Local stats: unchanged (${hash})`)
        return
      }
      this.lastLocalHash = hash

      this.options.log(
        `Local stats: emitting files=${stats.files} +${stats.additions} -${stats.deletions} ↑${stats.ahead} ↓${stats.behind}`,
      )
      this.lastLocalStats = stats
      this.options.onLocalStats(stats)
    } catch (err) {
      this.options.log("Failed to fetch local stats:", err)
    }
  }

  private async local(
    root: string,
    branch: string,
    status: Awaited<ReturnType<GitStatsSource["status"]>>,
    refs: RefSnapshot | undefined,
    refresh: boolean,
  ): Promise<LocalStats> {
    const trackingRef = refs?.upstreams.get(`refs/heads/${branch}`)
    const tracking = trackingRef ? shortRef(trackingRef) : await this.git.resolveTrackingBranch(root, branch)
    const base = tracking ?? (await this.git.resolveDefaultBranch(root, branch))
    if (!base) {
      const stats = await this.git.workingTreeStats(root)
      return { branch, ...stats, ahead: 0, behind: 0 }
    }
    const baseOID = refOID(refs, base)
    const cached = this.localCache
    const same =
      !refresh &&
      !!baseOID &&
      cached?.base === base &&
      cached.baseOID === baseOID &&
      cached.fingerprint === status.fingerprint
    const diff = same ? cached.diff : await this.snapshots.diff(root, base, status.untracked)
    const ahead =
      !refresh && baseOID && cached?.head === status.head && cached.baseOID === baseOID
        ? cached.ahead
        : await this.git.aheadBehind(root, base)
    this.localCache = {
      base,
      baseOID,
      head: status.head,
      fingerprint: status.fingerprint,
      diff,
      dirty: status.dirty,
      clean: status.dirty ? 0 : (cached?.clean ?? 0) + 1,
      ahead,
    }
    return { branch, ...diff, ...ahead }
  }

  private async fetchRefs(): Promise<RefSnapshot | undefined> {
    const root = this.options.getWorkspaceRoot()
    if (!root) return undefined
    return this.snapshots.refs(root).catch((err) => {
      this.options.log("Failed to read project refs:", err)
      return undefined
    })
  }
}

interface CachedStats {
  base: string
  baseOID?: string
  head: string
  fingerprint: string
  diff: DiffStats
  dirty: boolean
  clean: number
  ahead: { ahead: number; behind: number }
}
