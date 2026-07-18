import { GitStatsPoller, type WorktreePresenceResult } from "./GitStatsPoller"
import type { GitOps } from "./GitOps"
import { PRStatusBridge } from "./pr-status-bridge"
import type { WorktreeStateManager, Worktree } from "./WorktreeStateManager"
import type { WorktreeManager } from "./WorktreeManager"
import type { AgentManagerOutMessage } from "./types"
import type { Project } from "./project-registry"
import type { Semaphore } from "./semaphore"

export class ProjectGitError extends Error {
  override name = "ProjectGitError"

  constructor(
    public readonly code: "project_required" | "unknown_project",
    public readonly projectId?: string,
  ) {
    super(code === "project_required" ? "Project context required" : `Unknown project: ${projectId}`)
  }
}

interface ProjectGitContext {
  id: string
  root: string
  getWorktreeManager(): WorktreeManager | undefined
  getStateManager(): WorktreeStateManager | undefined
  getGitScope(build: () => ProjectGitScope | undefined): ProjectGitScope | undefined
}

interface ProjectGitScope {
  id: string
  root: string
  manager: WorktreeManager
  state: WorktreeStateManager
  stats: GitStatsPoller
  pr: PRStatusBridge
}

interface ProjectGitDeps {
  git: GitOps
  localDiff: (dir: string, base: string) => Promise<import("./types").WorktreeDiffEntry[]>
  post: (message: AgentManagerOutMessage) => void
  openExternal: (url: string) => void
  updatePresence: (id: string, result: WorktreePresenceResult) => void
  log: (...args: unknown[]) => void
  semaphore?: Semaphore
}

function createProjectGitScope(ctx: ProjectGitContext, deps: ProjectGitDeps): ProjectGitScope | undefined {
  const manager = ctx.getWorktreeManager()
  const state = ctx.getStateManager()
  if (!manager || !state) return undefined

  const stats = new GitStatsPoller({
    projectId: ctx.id,
    getWorktrees: () => state.getWorktrees(),
    resolveWorkspaceRoot: (id) => (id === ctx.id ? ctx.root : undefined),
    localDiff: deps.localDiff,
    git: deps.git,
    semaphore: deps.semaphore,
    onStats: (value) => deps.post({ type: "agentManager.worktreeStats", projectId: ctx.id, stats: value }),
    onLocalStats: (value) => deps.post({ type: "agentManager.localStats", projectId: ctx.id, stats: value }),
    onWorktreePresence: (value) => deps.updatePresence(ctx.id, value),
    log: (...args) => deps.log(...args),
  })

  const pr = PRStatusBridge.create({
    projectId: ctx.id,
    getWorktrees: () => state.getWorktrees(),
    resolveWorkspaceRoot: (id) => (id === ctx.id ? ctx.root : undefined),
    postToWebview: deps.post,
    updateWorktreePR: (id, number, url, status) => state.updateWorktreePR(id, number, url, status),
    hasPersistedPR: (id) => !!state.getWorktree(id)?.prNumber,
    openExternal: deps.openExternal,
    log: (...args) => deps.log(...args),
    semaphore: deps.semaphore,
  })

  return { id: ctx.id, root: ctx.root, manager, state, stats, pr }
}

export function shouldPollProject(project: Pick<Project, "collapsed"> | undefined, active: boolean): boolean {
  return project === undefined || !project.collapsed || active
}

export function setProjectPolling(scope: ProjectGitScope, project: Project, active: boolean, visible: boolean): void {
  scope.stats.setVisible(visible)
  scope.pr.poller.setVisible(visible)
  const enabled = visible && shouldPollProject(project, active)
  scope.stats.setEnabled(enabled)
  scope.pr.poller.setEnabled(enabled)
}

function projectIsActive(scope: ProjectGitScope, sessionId: string | undefined): boolean {
  return sessionId !== undefined && scope.state.getSession(sessionId) !== undefined
}

function projectState(scope: ProjectGitScope, project: Project) {
  return Promise.all([scope.manager.currentBranch(), scope.manager.defaultBranch()])
    .then(([branch, defaultBranch]) => ({
      type: "agentManager.state" as const,
      projectId: project.id,
      worktrees: scope.state.getWorktrees(),
      sessions: scope.state.getSessions(),
      sections: scope.state.getSections(),
      staleWorktreeIds: [],
      tabOrder: scope.state.getTabOrder(),
      worktreeOrder: scope.state.getWorktreeOrder(),
      sessionsCollapsed: scope.state.getSessionsCollapsed(),
      sidebarCollapsed: scope.state.getSidebarCollapsed(),
      reviewDiffStyle: scope.state.getReviewDiffStyle(),
      isGitRepo: branch.length > 0,
      branch,
      defaultBranch,
      defaultBaseBranch: scope.state.getDefaultBaseBranch() ?? defaultBranch,
    }))
    .catch(() => ({
      type: "agentManager.state" as const,
      projectId: project.id,
      worktrees: scope.state.getWorktrees(),
      sessions: scope.state.getSessions(),
      sections: scope.state.getSections(),
      staleWorktreeIds: [],
      tabOrder: scope.state.getTabOrder(),
      worktreeOrder: scope.state.getWorktreeOrder(),
      sessionsCollapsed: scope.state.getSessionsCollapsed(),
      sidebarCollapsed: scope.state.getSidebarCollapsed(),
      reviewDiffStyle: scope.state.getReviewDiffStyle(),
      isGitRepo: false,
    }))
}

interface ProjectGitRouting {
  loaded(): Promise<void>
  snapshot(): { projects: Project[] }
  getProject(id: string): Project | undefined
  projectFor(id: string): unknown
}

type ProjectGitControllerDeps = Omit<ProjectGitDeps, "updatePresence"> & {
  visible: () => boolean
  active: () => string | undefined
  poll?: (project: Project) => boolean
  error: (error: ProjectGitError) => void
}

export class ProjectGitCoordinator {
  private readonly loaded = new Set<string>()

  constructor(
    private readonly routing: ProjectGitRouting,
    private readonly deps: ProjectGitControllerDeps,
  ) {}

  manager(id: string): WorktreeManager | undefined {
    if (!this.routing.getProject(id)) {
      this.deps.error(new ProjectGitError("unknown_project", id))
      return undefined
    }
    return this.scope(id)?.manager
  }

  state(id: string): WorktreeStateManager | undefined {
    return this.scope(id)?.state
  }

  requireProject(id: string | undefined): boolean {
    if (id || this.routing.snapshot().projects.length === 0) return true
    this.deps.error(new ProjectGitError("project_required"))
    return false
  }

  handlePR(message: Record<string, unknown>): boolean {
    if (message.type !== "agentManager.refreshPR" && message.type !== "agentManager.openPR") return false
    const id = typeof message.projectId === "string" ? message.projectId : undefined
    if (!id) return !this.requireProject(id)
    if (!this.routing.getProject(id)) {
      this.deps.error(new ProjectGitError("unknown_project", id))
      return true
    }
    return this.scope(id)?.pr.handleMessage(message) ?? true
  }

  activate(id: string): void {
    for (const project of this.routing.snapshot().projects) {
      const scope = this.scope(project.id)
      scope?.pr.poller.setActiveWorktreeId(scope.state.getSession(id)?.worktreeId ?? undefined)
    }
    void this.refresh()
  }

  async refresh(): Promise<void> {
    await this.routing.loaded()
    for (const project of this.routing.snapshot().projects) {
      const scope = this.scope(project.id)
      if (!scope) continue
      if (!this.loaded.has(project.id)) {
        await scope.state.load()
        this.loaded.add(project.id)
      }
      const visible = this.deps.visible() && (this.deps.poll?.(project) ?? true)
      setProjectPolling(scope, project, projectIsActive(scope, this.deps.active()), visible)
      this.deps.post(await projectState(scope, project))
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.routing.snapshot().projects.map((project) => this.scope(project.id)?.state.flush()))
  }

  stop(): void {
    for (const project of this.routing.snapshot().projects) {
      const scope = this.scope(project.id)
      scope?.stats.stop()
      scope?.pr.poller.stop()
    }
  }

  private scope(id: string): ProjectGitScope | undefined {
    const context = this.routing.projectFor(id) as ProjectGitContext | undefined
    if (!context) return undefined
    const scope = context.getGitScope(() =>
      createProjectGitScope(context, {
        ...this.deps,
        updatePresence: (_, result) => this.updatePresence(id, result),
      }),
    )
    return scope
  }

  private updatePresence(id: string, result: WorktreePresenceResult): void {
    if (result.degraded) return
    const scope = this.scope(id)
    if (!scope) return
    const changed = result.worktrees
      .map((item) => item.branch !== undefined && scope.state.updateWorktreeBranch(item.worktreeId, item.branch))
      .some(Boolean)
    if (changed) void this.refresh()
  }
}
