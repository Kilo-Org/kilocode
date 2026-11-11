// Public provider surface (focus, reveal, sidebar entry points, diagnostics, shutdown) split out of
// AgentManagerProvider so the class file stays readable. Every function receives the provider as a host value.
import type { ProjectContext } from "./project/context"
import type { ProjectContexts } from "./project/contexts"
import type { ProjectScope } from "./project/scope"
import type { AgentManagerConnection } from "./connection"
import type { Host, OutputHandle, PanelContext } from "./host"
import type { GitOps } from "./GitOps"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import type { WorktreeManager } from "./WorktreeManager"
import type { TerminalRouter } from "./terminal-routing"
import type { WorktreeDiffController } from "./worktree-diff-controller"
import type { DiffSourceCatalog } from "../diff/sources/catalog"
import type { CaffeinationService } from "../services/caffeination"
import type { BranchNamingController } from "./branch-naming"
import type { AgentManagerOutMessage } from "./types"
import type { CreateWorktreeOnDiskOptions, CreateWorktreeOnDiskResult } from "./worktree-create"
import { focusPanelPrompt, revealPanel } from "./focus-panel"
import { revealManagedSession } from "./reveal-session"
import { continueInWorktree, type ContinueContext } from "./continue-in-worktree"
import { runDoctor } from "./worktree-doctor"
import { reconcileProject } from "./project/init"
import { samePath } from "./project/paths"
import type { CreateWorktreeResult } from "./WorktreeManager"

export interface ProviderApiHost {
  readonly contexts: ProjectContexts
  readonly projectScope: ProjectScope
  readonly connection: AgentManagerConnection
  readonly host: Host
  readonly outputChannel: OutputHandle
  readonly gitOps: GitOps
  readonly prBridge: { poller: { paused(): string[]; stop(): void } }
  readonly statsPoller: { paused(): string[]; stop(): void }
  readonly diffs: WorktreeDiffController
  readonly diffCatalog: DiffSourceCatalog
  readonly naming: BranchNamingController
  readonly healthScheduler: { dispose(): void }
  readonly projectPollers: { dispose(): void }
  readonly relay: { dispose(): void }
  readonly terminalRouter: TerminalRouter
  readonly scripts: { dispose(): Promise<void> }
  readonly caffeination: CaffeinationService
  readonly orchestration: { dispose(): void }
  readonly run: { dispose(): void }
  readonly activity: { dispose(): void }
  readonly unsubTool: () => void
  readonly unsubEvents: () => void
  readonly unsubFont: () => void
  readonly unsubProjects: () => void
  panel: PanelContext | undefined
  closing: Promise<void> | undefined
  stateReady: Promise<void> | undefined
  readonly state: WorktreeStateManager | undefined
  readonly context: ProjectContext | undefined
  openPanel(preserveFocus?: boolean): void
  postToWebview(message: AgentManagerOutMessage): void
  log(...args: unknown[]): void
  getRoot(): string | undefined
  getStateManager(): WorktreeStateManager | undefined
  getWorktreeManager(): WorktreeManager | undefined
  createWorktreeOnDisk(opts?: CreateWorktreeOnDiskOptions): Promise<CreateWorktreeOnDiskResult | null>
  runSetupScriptForWorktree(path: string, branch: string | undefined, id: string): Promise<void>
  onCreateWorktree(baseBranch?: string, branchName?: string): Promise<null>
  onDeleteWorktree(id: string): Promise<null>
  registerWorktreeSession(sessionId: string, directory: string): void
  notifyWorktreeReady(
    sessionId: string,
    result: CreateWorktreeResult,
    worktreeId?: string,
  ): void
  waitForStateReady(where: string): Promise<void>
  waitForPanelReady(panel: PanelContext): Promise<boolean>
  waitForPanelActive(panel: PanelContext): Promise<boolean>
  activateProject(ctx: ProjectContext): void
  pushProjects(): void
}

export function focusPanel(p: ProviderApiHost): void {
  const panel = p.panel
  if (!panel) return
  revealPanel(panel, false, () => focusPanelPrompt(panel, p.waitForPanelReady(panel), p.waitForPanelActive(panel)))
}

export function isActive(p: ProviderApiHost): boolean {
  return p.panel?.active === true
}

export function waitForReady(p: ProviderApiHost): Promise<boolean> {
  const panel = p.panel
  if (!panel) return Promise.resolve(false)
  return p.waitForPanelReady(panel)
}

export function getSessionDirectories(p: ProviderApiHost): ReadonlyMap<string, string> {
  const directories = new Map<string, string>()
  for (const ctx of p.contexts.values()) {
    const state = ctx.peekState()
    for (const session of state?.getSessions() ?? []) {
      const worktree = session.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
      directories.set(session.id, worktree?.path ?? ctx.root)
    }
  }
  return directories
}

export function revealSession(p: ProviderApiHost, sessionId: string): Promise<boolean> {
  return revealManagedSession(sessionId, p.contexts, {
    directories: () => getSessionDirectories(p),
    activate: (ctx) => p.activateProject(ctx),
    projects: () => p.pushProjects(),
    open: () => p.openPanel(),
    state: () => p.waitForStateReady("revealSession"),
    ready: () => waitForReady(p),
    post: (message) => p.panel?.postMessage(message),
  })
}

export function getWorktreeDirectories(p: ProviderApiHost): string[] {
  return p.getStateManager()?.getWorktrees().map((wt) => wt.path) ?? []
}

export async function continueFromSidebar(
  p: ProviderApiHost,
  sessionId: string,
  progress: (status: string, detail?: string, error?: string) => void,
): Promise<void> {
  const root = p.getRoot()
  if (!root) {
    progress("error", undefined, "No workspace folder open")
    return
  }
  p.openPanel()
  await p.waitForStateReady("continueFromSidebar")
  await continueInWorktree(worktreeContext(p, root), sessionId, progress)
}

/**
 * Continues a session in a new worktree of the project the request targets. The sidebar continues its own project;
 * the Agent Manager panel continues a session of whichever project it shows.
 */
export async function continueInActiveProject(
  p: ProviderApiHost,
  sessionId: string,
  progress: (status: string, detail?: string, error?: string) => void,
): Promise<void> {
  const root = p.getRoot()
  if (!root) {
    progress("error", undefined, "No workspace folder open")
    return
  }
  await p.waitForStateReady("continueInWorktree")
  await continueInWorktree(worktreeContext(p, root), sessionId, progress)
}

function worktreeContext(p: ProviderApiHost, root: string): ContinueContext {
  return {
    root,
    binary: p.gitOps.path,
    client: () => p.connection.client(),
    createWorktreeOnDisk: (opts) => p.createWorktreeOnDisk(opts),
    runSetupScript: (target, branch, id) => p.runSetupScriptForWorktree(target, branch, id),
    cleanupWorktree: async (id) => {
      await p.onDeleteWorktree(id)
    },
    notifyError: (error, result, id) => {
      p.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: error,
        branch: result.branch,
        worktreeId: id,
      })
    },
    getStateManager: () => p.getStateManager(),
    registerWorktreeSession: (sid, dir) => p.registerWorktreeSession(sid, dir),
    notifyReady: (sid, result, wid) => p.notifyWorktreeReady(sid, result, wid),
    notifyForked: (session, from, wid) =>
      p.postToWebview({
        type: "agentManager.sessionForked",
        projectId: p.context?.id,
        sessionId: session.id,
        forkedFromId: from,
        worktreeId: wid,
        session,
      }),
    log: (...args) => p.log(...args),
  }
}

export async function createFromSidebar(p: ProviderApiHost, baseBranch?: string, branchName?: string): Promise<void> {
  p.openPanel()
  if (!p.panel || !(await p.waitForPanelReady(p.panel))) return
  await p.waitForStateReady("createFromSidebar")
  await p.onCreateWorktree(baseBranch, branchName)
}

export async function openAdvancedWorktree(p: ProviderApiHost): Promise<void> {
  p.openPanel()
  if (!p.panel || !(await p.waitForPanelActive(p.panel)) || !(await p.waitForPanelReady(p.panel))) return
  await p.waitForStateReady("openAdvancedWorktree")
  queueMicrotask(() => p.postToWebview({ type: "action", action: "advancedWorktree" }))
}

export function diagnose(p: ProviderApiHost): Promise<void> {
  return runDoctor(p.context, {
    reconcile: (ctx) => reconcileProject(ctx, (...args: unknown[]) => p.log(...args)),
    quarantined: () => [...p.prBridge.poller.paused(), ...p.statsPoller.paused()],
    out: p.outputChannel,
    log: (...args) => p.log(...args),
  })
}

export function postMessage(p: ProviderApiHost, message: unknown): void {
  p.panel?.postMessage(message)
}

export function shutdown(p: ProviderApiHost): Promise<void> {
  if (!p.closing) p.closing = disposeAsync(p)
  return p.closing
}

export async function disposeAsync(p: ProviderApiHost): Promise<void> {
  await p.stateReady?.catch((err) => p.log("dispose: stateReady rejected:", err))
  await p.contexts.dispose()
  p.unsubTool()
  p.activity.dispose()
  p.unsubEvents()
  p.unsubFont()
  p.unsubProjects()
  await p.scripts.dispose()
  await p.caffeination.dispose()
  p.orchestration.dispose()
  p.diffs.stop()
  p.diffCatalog.dispose()
  p.naming.dispose()
  p.healthScheduler.dispose()
  p.statsPoller.stop()
  p.projectPollers.dispose()
  p.gitOps.dispose()
  p.prBridge.poller.stop()
  p.run.dispose()
  p.relay.dispose()
  await p.terminalRouter.dispose()
  const panel = p.panel
  p.panel = undefined
  panel?.dispose()
  p.outputChannel.dispose()
  p.host.dispose()
}

/** The worktree registry the server sees must follow the extension-owned worktrees. */
export async function syncWorktrees(p: ProviderApiHost): Promise<void> {
  const root = p.getRoot()
  if (!root) return
  const client = await p.connection.client().catch(() => undefined)
  if (!client) return
  const projects = await client.project.list().catch(() => [])
  const project = projects.find((item) => samePath(item.canonical, root))
  if (!project) return
  await client.worktree
    .refresh({ projectID: project.id })
    .catch((error: unknown) => p.log("Failed to refresh worktree registry:", error))
}
