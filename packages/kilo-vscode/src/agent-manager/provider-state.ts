// State projection for the Agent Manager panel: state pushes, activity, poller skips, presence, run status,
// project catalog, and project activation. Split out of AgentManagerProvider for its file-size cap.
import type { OpenCodeClient } from "@opencode/client"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { ProjectContext } from "./project/context"
import type { ProjectContexts } from "./project/contexts"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import type { PanelContext } from "./host"
import type { AgentManagerConnection } from "./connection"
import type { GitStatsPoller, WorktreePresenceResult } from "./GitStatsPoller"
import type { PRStatusBridge } from "./pr-status-bridge"
import type { ProjectPollers } from "./project/pollers"
import type { RunController } from "./run/controller"
import type { TerminalRouter } from "./terminal-routing"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { HealthScheduler } from "./worktree-health"
import { applyPresence, healthPayload, needsReconcile, staleForState } from "./worktree-health"
import {
  pushProjectSessions,
  reactivateProject,
  registerSessionCatalogHost,
  type SessionCatalogHost,
} from "./project/init"
import { hydrateExpanded } from "./project/hydrate"
import { getReviewMarkdownRender } from "./provider-messages"
import { readTerminalFont } from "./terminal-font"
import { isRestrictedRoot } from "./home-workspace"
import type { DestinationState } from "./terminal-destination"

export interface ProviderStateHost {
  readonly contexts: ProjectContexts
  readonly panel: PanelContext | undefined
  readonly connection: AgentManagerConnection
  readonly activity: { sync(force?: boolean): Promise<void> | void }
  readonly statsPoller: GitStatsPoller
  readonly prBridge: PRStatusBridge
  readonly projectPollers: ProjectPollers
  readonly run: RunController
  readonly terminalRouter: TerminalRouter
  readonly scripts: { manager: ScriptTerminalManager }
  readonly destination: DestinationState
  readonly healthScheduler: HealthScheduler<ProjectContext>
  readonly busySessions: Set<string>
  readonly staleIds: Set<string>
  cachedWorktreeStats: Extract<AgentManagerOutMessage, { type: "agentManager.worktreeStats" }> | undefined
  cachedLocalStats: Extract<AgentManagerOutMessage, { type: "agentManager.localStats" }> | undefined
  visibleSession: string | null
  stateReady: Promise<void> | undefined
  context: ProjectContext | undefined
  state: WorktreeStateManager | undefined
  postToWebview(message: AgentManagerOutMessage): void
  log(...args: unknown[]): void
  /** Backend client of the running server, for the session catalog listing. */
  client(): Promise<OpenCodeClient>
  sendRepoInfo(): Promise<void>
  initializeState(): Promise<void>
  initExpanded(ctx: ProjectContext): void
  syncView(): void
}

export async function requestState(p: ProviderStateHost): Promise<void> {
  await p.terminalRouter.dispose()
  await p.scripts.manager.snapshot()
  void p.activity.sync(true)
  await p.stateReady?.catch((err) => p.log("requestState: stateReady rejected:", err))
  if (!p.state) {
    pushEmptyState(p)
    return
  }
  pushState(p)
  if (p.cachedWorktreeStats) p.postToWebview(p.cachedWorktreeStats)
  if (p.cachedLocalStats) p.postToWebview(p.cachedLocalStats)
  p.prBridge.replay()
}

export function hotWorktrees(p: ProviderStateHost): Set<string> {
  const ids = new Set<string>()
  const target = p.state?.getActiveTarget()
  if (target?.kind === "worktree") ids.add(target.worktreeId)
  if (target?.kind === "session") {
    const id = p.state?.getSession(target.sessionId)?.worktreeId
    if (id) ids.add(id)
  }
  for (const status of p.run.state().runStatuses) {
    if (status.state === "running" || status.state === "stopping") ids.add(status.worktreeId)
  }
  for (const sessionID of p.busySessions) {
    const owner = p.contexts.byLiveSession(sessionID)
    const id = owner?.peekState()?.getSession(sessionID)?.worktreeId ?? p.state?.getSession(sessionID)?.worktreeId
    if (id) ids.add(id)
  }
  return ids
}

export function runStateFor(p: ProviderStateHost, ctx: ProjectContext): ReturnType<RunController["state"]> {
  const state = p.run.state()
  const ids = new Set((ctx.peekState()?.getWorktrees() ?? []).map((wt) => wt.id))
  const localKey = `${ctx.id}:local`
  const runStatuses = state.runStatuses
    .filter((status) => ids.has(status.worktreeId) || status.worktreeId === localKey)
    .map((status) => (status.worktreeId === localKey ? { ...status, worktreeId: "local" } : status))
  return { ...state, runStatuses }
}

export function postRunMessage(p: ProviderStateHost, message: AgentManagerOutMessage): void {
  if (message.type !== "agentManager.runStatus") {
    p.postToWebview(message)
    return
  }
  const qualified = message.worktreeId.endsWith(":local") && message.worktreeId !== "local"
  const owner = qualified
    ? p.contexts.resolve(message.worktreeId.slice(0, -":local".length))
    : p.contexts.byWorktree(message.worktreeId)
  p.postToWebview({
    ...message,
    worktreeId: qualified ? "local" : message.worktreeId,
    ...(owner ? { projectId: owner.id } : {}),
  })
}

export function messageProject(p: ProviderStateHost, m: AgentManagerInMessage): ProjectContext | undefined {
  const pid = (m as { projectId?: unknown }).projectId
  if (typeof pid !== "string") return p.contexts.active()
  return p.contexts.resolve(pid)
}

export function onWorktreePresence(p: ProviderStateHost, result: WorktreePresenceResult): void {
  const state = p.state
  if (!state) return
  const applied = applyPresence(result, p.staleIds, state.getWorktrees(), (id, branch) =>
    state.updateWorktreeBranch(id, branch),
  )
  if (applied.degraded) return p.log("Skipping stale worktree update: degraded worktree probe")
  if (applied.staleChanged || applied.branchChanged) pushState(p)
  if (p.context && needsReconcile(applied, p.context.report)) p.healthScheduler.schedule(p.context)
}

export function syncPollerSkips(p: ProviderStateHost): void {
  const state = p.state
  if (!state) return
  const skipped = new Set<string>()
  for (const section of state.getSections()) {
    if (!section.collapsed) continue
    for (const id of state.getWorktreesInSection(section.id)) skipped.add(id)
  }
  const stats = p.statsPoller.syncSkips(skipped)
  if (!stats) return
  const message = { type: "agentManager.worktreeStats" as const, projectId: p.contexts.active()?.id, stats }
  p.cachedWorktreeStats = message
  p.postToWebview(message)
}

/** Catalog hooks backed by the provider's contexts, backend client, and webview channel. */
function sessionCatalog(p: ProviderStateHost): SessionCatalogHost {
  return {
    contextForDirectory: (directory) => p.contexts.byDirectory(directory),
    contextForSession: (sessionID) => p.contexts.byLiveSession(sessionID),
    list: async (directory) => (await (await p.client()).session.list({ directory, parentID: null })).data,
    get: async (sessionID) => (await p.client()).session.get({ sessionID }),
    post: (message) => p.postToWebview(message),
  }
}

export function pushState(p: ProviderStateHost, ctx?: ProjectContext): void {
  const target = ctx ?? p.context
  const state = target?.peekState()
  if (!target || !state) {
    p.log(`pushState skipped: target=${target?.id ?? "none"}, state=${state ? "ok" : "missing"}`)
    return
  }
  const active = p.contexts.active()?.id === target.id
  const worktrees = state.getWorktrees()
  p.postToWebview({
    type: "agentManager.state",
    projectId: target.id,
    worktrees,
    sessions: state.getSessions(),
    sections: state.getSections(),
    staleWorktreeIds: active ? staleForState(p.staleIds, worktrees) : [],
    ...healthPayload(target.report, worktrees),
    tabOrder: state.getTabOrder(),
    pinnedTabs: state.getPinnedTabs(),
    worktreeOrder: state.getWorktreeOrder(),
    sessionsCollapsed: state.getSessionsCollapsed(),
    sidebarCollapsed: state.getSidebarCollapsed(),
    reviewDiffStyle: state.getReviewDiffStyle(),
    reviewMarkdownRender: getReviewMarkdownRender(),
    terminalDestination: p.destination.value(),
    terminalFont: readTerminalFont(),
    isGitRepo: true,
    restricted: isRestrictedRoot(target.root),
    defaultBaseBranch: state.getDefaultBaseBranch(),
    activeTarget: state.getActiveTarget(),
    ...(active ? runStateFor(p, target) : {}),
  })
  void p.activity.sync()
  const catalog = sessionCatalog(p)
  registerSessionCatalogHost(p.busySessions, catalog)
  void pushProjectSessions(target, catalog.list, catalog.post, (...args) => p.log(...args))
  if (!active) return
  syncPollerSkips(p)
  p.statsPoller.setEnabled(worktrees.length > 0 || p.panel !== undefined)
  p.prBridge.poller.setEnabled(p.panel !== undefined)
}

export function pushEmptyState(p: ProviderStateHost): void {
  void p.activity.sync()
  p.staleIds.clear()
  p.postToWebview({
    type: "agentManager.state",
    worktrees: [],
    sessions: [],
    staleWorktreeIds: [],
    reviewDiffStyle: "unified",
    reviewMarkdownRender: getReviewMarkdownRender(),
    terminalDestination: p.destination.value(),
    terminalFont: readTerminalFont(),
    isGitRepo: false,
    restricted: isRestrictedRoot(p.contexts.active()?.root),
    runStatuses: [],
    runScriptConfigured: false,
  })
}

export function activateProject(p: ProviderStateHost, ctx: ProjectContext): void {
  if (p.contexts.active()?.id !== ctx.id) return
  p.statsPoller.stop()
  p.prBridge.reset()
  p.visibleSession = null
  p.busySessions.clear()
  p.cachedWorktreeStats = p.cachedLocalStats = undefined
  void p.sendRepoInfo()
  if (!reactivateProject(ctx, (target) => pushState(p, target))) p.stateReady = p.initializeState()
  else p.projectPollers.sync(p.contexts)
}

export function onWorkspaceChanged(p: ProviderStateHost): void {
  if (p.contexts.syncPinned()) {
    p.visibleSession = null
    p.stateReady = p.initializeState()
    void p.sendRepoInfo()
  }
  pushProjects(p)
}

export function pushProjects(p: ProviderStateHost): void {
  const projects = p.contexts.snapshots()
  void p.activity.sync()
  p.postToWebview({ type: "agentManager.projects", projects })
  if (p.panel)
    hydrateExpanded(projects, {
      expand: (id) => p.contexts.expand(id),
      push: (ctx) => pushState(p, ctx),
      init: (ctx) => p.initExpanded(ctx),
    })
  p.projectPollers.sync(p.contexts)
  p.projectPollers.replay()
}