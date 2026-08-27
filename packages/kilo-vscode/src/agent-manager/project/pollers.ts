/**
 * Per-project stats/PR pollers for expanded background projects, plus the
 * factory for the provider's poller trio (extracted from AgentManagerProvider
 * for its file-size cap).
 *
 * The active project is served by the singleton `stats`/`pr` pollers (their
 * getters follow the active context). `ProjectPollers` creates one poller pair
 * per expanded non-active project so every visible project accordion receives
 * live worktree stats, local stats, and PR statuses, each tagged with the
 * owning projectId. VS Code-free and unit-testable: the poller pair factory is
 * injectable.
 */

import type { GitOps } from "../GitOps"
import { GitStatsPoller, type LocalStats, type WorktreePresenceResult, type WorktreeStats } from "../GitStatsPoller"
import { PRStatusBridge } from "../pr-status-bridge"
import type { PRStatus } from "../types"
import type { ProjectContext } from "./context"
import type { ProjectContexts } from "./contexts"
import type { Semaphore } from "../semaphore"
import type { AgentManagerOutMessage } from "../types"
import type { WorktreeStateManager } from "../WorktreeStateManager"

export interface PollerPair {
  stats: { setEnabled(enabled: boolean): void; setVisible(visible: boolean): void; stop(): void }
  pr: {
    poller: { setEnabled(enabled: boolean): void; setVisible(visible: boolean): void; stop(): void }
    replay?(): void
  }
}

export type StatsOutMessage =
  | { type: "agentManager.worktreeStats"; projectId?: string; stats: WorktreeStats[] }
  | { type: "agentManager.localStats"; projectId?: string; stats: LocalStats }
  | { type: "agentManager.prStatus"; projectId?: string; worktreeId: string; pr: PRStatus | null }
  | { type: "agentManager.prError"; projectId?: string; error: "gh_missing" | "gh_auth" | "fetch_failed" }

type StatsMessage = Extract<AgentManagerOutMessage, { type: "agentManager.worktreeStats" | "agentManager.localStats" }>

interface PollerDeps {
  git: GitOps
  semaphore: Semaphore
  hot?: () => Set<string>
  post: (msg: StatsOutMessage) => void
  openExternal: (url: string) => void
  visible: () => boolean
  log: (...args: unknown[]) => void
}

function hot(state: WorktreeStateManager | undefined): Set<string> {
  const result = new Set<string>()
  const target = state?.getActiveTarget()
  if (target?.kind === "worktree") result.add(target.worktreeId)
  if (target?.kind === "session") {
    const id = state?.getSession(target.sessionId)?.worktreeId
    if (id) result.add(id)
  }
  return result
}

/** Create the real poller pair for one project context. */
function createPollerPair(ctx: ProjectContext, deps: PollerDeps): PollerPair {
  const state = () => ctx.peekState()
  const stats = new GitStatsPoller({
    getWorktrees: () => state()?.getWorktrees() ?? [],
    getWorkspaceRoot: () => ctx.root,
    getHotWorktreeIds: deps.hot ?? (() => hot(state())),
    git: deps.git,
    semaphore: deps.semaphore,
    log: deps.log,
    onStats: (stats) => deps.post({ type: "agentManager.worktreeStats", projectId: ctx.id, stats }),
    onLocalStats: (stats) => deps.post({ type: "agentManager.localStats", projectId: ctx.id, stats }),
  })
  const pr = PRStatusBridge.create({
    getWorktrees: () => state()?.getWorktrees() ?? [],
    getWorkspaceRoot: () => ctx.root,
    postToWebview: (m) => deps.post({ ...m, projectId: ctx.id } as StatsOutMessage),
    updateWorktreePR: (id, n, u, s) => state()?.updateWorktreePR(id, n, u, s),
    hasPersistedPR: (id) => !!state()?.getWorktree(id)?.prNumber,
    openExternal: deps.openExternal,
    log: deps.log,
    semaphore: deps.semaphore,
    projectId: () => ctx.id,
  })
  return { stats, pr }
}

export class ProjectPollers {
  private readonly pollers = new Map<string, PollerPair>()
  private readonly cache = new Map<string, { worktrees?: StatsOutMessage; local?: StatsOutMessage }>()

  constructor(
    private readonly deps: PollerDeps,
    private readonly create: (ctx: ProjectContext, deps: PollerDeps) => PollerPair = createPollerPair,
  ) {}

  /**
   * Record the latest stats per project on the way to the webview. A poller
   * only emits when something changed, so a webview that mounts (or reloads)
   * after an emit would otherwise keep its stats placeholders forever.
   */
  private recording(id: string): PollerDeps {
    return {
      ...this.deps,
      post: (msg) => {
        const entry = this.cache.get(id) ?? {}
        if (msg.type === "agentManager.worktreeStats") entry.worktrees = msg
        if (msg.type === "agentManager.localStats") entry.local = msg
        this.cache.set(id, entry)
        this.deps.post(msg)
      },
    }
  }

  /** Re-post the latest background project stats and PR statuses. */
  replay(): void {
    for (const [id, pair] of this.pollers) {
      const entry = this.cache.get(id)
      if (entry?.worktrees) this.deps.post(entry.worktrees)
      if (entry?.local) this.deps.post(entry.local)
      pair.pr.replay?.()
    }
  }

  /**
   * Reconcile pollers with the current expanded set: start pollers for
   * expanded, non-active projects whose state is initialized, and
   * stop pollers for projects that were collapsed, removed, or activated.
   */
  sync(contexts: ProjectContexts): void {
    const wanted = new Set<string>()
    for (const snap of contexts.snapshots()) {
      if (snap.active || !snap.expanded || snap.missing) continue
      const ctx = contexts.get(snap.id)
      if (!ctx?.peekState()) continue
      wanted.add(snap.id)
      if (this.pollers.has(snap.id)) continue
      const pair = this.create(ctx, this.recording(snap.id))
      pair.stats.setVisible(this.deps.visible())
      pair.pr.poller.setVisible(this.deps.visible())
      pair.stats.setEnabled(true)
      pair.pr.poller.setEnabled(true)
      this.pollers.set(snap.id, pair)
    }
    for (const [id, pair] of [...this.pollers]) {
      if (wanted.has(id)) continue
      pair.stats.stop()
      pair.pr.poller.stop()
      this.pollers.delete(id)
      this.cache.delete(id)
    }
  }

  setVisible(visible: boolean): void {
    for (const pair of this.pollers.values()) {
      pair.stats.setVisible(visible)
      pair.pr.poller.setVisible(visible)
    }
  }

  dispose(): void {
    for (const pair of this.pollers.values()) {
      pair.stats.stop()
      pair.pr.poller.stop()
    }
    this.pollers.clear()
    this.cache.clear()
  }
}

/** Create the provider's poller trio: singleton active-project pollers plus per-project background pollers. */
export function createPollers(opts: {
  git: GitOps
  semaphore: Semaphore
  state: () => WorktreeStateManager | undefined
  root: () => string | undefined
  activeId: () => string | undefined
  visible: () => boolean
  post: (msg: AgentManagerOutMessage) => void
  cache: (msg: StatsMessage) => void
  presence: (result: WorktreePresenceResult) => void
  openExternal: (url: string) => void
  log: (...args: unknown[]) => void
  hot?: () => Set<string>
}): { stats: GitStatsPoller; pr: PRStatusBridge; projects: ProjectPollers } {
  const stats = new GitStatsPoller({
    getWorktrees: () => opts.state()?.getWorktrees() ?? [],
    getWorkspaceRoot: opts.root,
    getHotWorktreeIds: opts.hot ?? (() => hot(opts.state())),
    semaphore: opts.semaphore,
    onStats: (stats) => {
      const msg = { type: "agentManager.worktreeStats" as const, projectId: opts.activeId(), stats }
      opts.cache(msg)
      opts.post(msg)
    },
    onLocalStats: (stats) => {
      const msg = { type: "agentManager.localStats" as const, projectId: opts.activeId(), stats }
      opts.cache(msg)
      opts.post(msg)
    },
    onWorktreePresence: opts.presence,
    log: opts.log,
    git: opts.git,
  })
  const pr = PRStatusBridge.create({
    getWorktrees: () => opts.state()?.getWorktrees() ?? [],
    getWorkspaceRoot: opts.root,
    postToWebview: (m) => opts.post(m.type === "agentManager.prStatus" ? { ...m, projectId: opts.activeId() } : m),
    updateWorktreePR: (id, n, u, s) => opts.state()?.updateWorktreePR(id, n, u, s),
    hasPersistedPR: (id) => !!opts.state()?.getWorktree(id)?.prNumber,
    openExternal: opts.openExternal,
    log: opts.log,
    semaphore: opts.semaphore,
    projectId: opts.activeId,
  })
  const projects = new ProjectPollers({
    git: opts.git,
    semaphore: opts.semaphore,
    hot: opts.hot,
    post: opts.post,
    openExternal: opts.openExternal,
    visible: opts.visible,
    log: opts.log,
  })
  return { stats, pr, projects }
}
