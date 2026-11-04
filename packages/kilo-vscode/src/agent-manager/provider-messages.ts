// Message handlers split out of AgentManagerProvider so each function stays small. The webview owns session data and
// talks to the server directly; handlers here own worktree state, host actions, and panel lifecycle.
import * as vscode from "vscode"
import type { AgentManagerConnection } from "./connection"
import type { Host, PanelContext } from "./host"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { ProjectContext } from "./project/context"
import type { ProjectScope } from "./project/scope"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { initContextState } from "./project/init"
import { handleProjectMessage, type ProjectMessageDeps } from "./project/messages"
import { STATE_GATED } from "./project/state-gate"
import { handleSection } from "./section-handler"
import { handleTabLayoutMessage } from "./tab-layout"
import { handleRunMessage } from "./run/message"
import { handleDestination, type DestinationState } from "./terminal-destination"
import { normalizeBaseBranch } from "./base-branch"
import { handleBaseUpdate } from "./base-update"
import { pushFixes } from "../kilo-provider/push-fixes-settings"
import { composeDiffId, normalizeScope } from "./diff-scope"
import { resolveWorktreeFile } from "./worktree-file-path"
import type { LifecycleHost } from "./provider-lifecycle"
import type { BranchNamingController } from "./branch-naming"
import type { WorktreeImporter } from "./worktree-importer"
import type { WorktreeDiffController } from "./worktree-diff-controller"
import type { TerminalRouter } from "./terminal-routing"
import type { SessionTerminalManager } from "./SessionTerminalManager"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { RunController } from "./run/controller"
import type { RecoveryMessage } from "./worktree-recovery"
import type { ProjectContexts } from "./project/contexts"

export interface MessageHost {
  connection: AgentManagerConnection
  host: Host
  contexts: ProjectContexts
  projects: ProjectMessageDeps
  scope: ProjectScope
  lifecycle: LifecycleHost
  naming: BranchNamingController
  importer: WorktreeImporter
  diffs: WorktreeDiffController
  terminals: TerminalRouter
  integrated: SessionTerminalManager
  scripts: { manager: ScriptTerminalManager }
  run: RunController
  destination: DestinationState
  panel: () => PanelContext | undefined
  context: () => ProjectContext | undefined
  state: () => WorktreeStateManager | undefined
  stateReady: () => Promise<void> | undefined
  post: (message: AgentManagerOutMessage) => void
  log: (...args: unknown[]) => void
  pushState: (ctx?: ProjectContext) => void
  waitForStateReady: (where: string) => Promise<void>
  openPanel: (preserveFocus?: boolean) => void
  onCreateWorktree: (baseBranch?: string, branchName?: string) => Promise<null>
  onDeleteWorktree: (worktreeId: string) => Promise<null>
  onRemoveStaleWorktree: (worktreeId: string, keepSessions: boolean) => Promise<null>
  recover: (message: RecoveryMessage) => Promise<null>
  projectFor: (m: AgentManagerInMessage) => ProjectContext | undefined
  requestState: () => Promise<void>
  onPromoteSession: (sessionId: string) => Promise<null>
  onAddSessionToWorktree: (worktreeId: string, sessionId?: string) => Promise<null>
  onForkSession: (sessionId: string, worktreeId?: string, messageId?: string) => Promise<null>
  onCloseSession: (sessionId: string) => Promise<null>
  onCreateMultiVersion: (
    message: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>,
  ) => Promise<null>
  continueFromSidebar: (
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ) => Promise<void>
  configureSetupScript: () => Promise<void>
  sendRepoInfo: () => Promise<void>
  sendDiffBranches: (sessionId: string, scope?: string, projectId?: string) => Promise<void>
  openWorktreeDirectory: (worktreeId: string) => void
  openWorktreeFile: (id: string, filePath: string, line?: number, column?: number) => void
  runKey: (worktreeId: string) => string
  view: (sessionIds: string[]) => void
  trackOpenSessions: (sessionIds: string[]) => void
  trackVisibleSession: (sessionId: string | null) => void
  setCaffeination: (enabled: boolean) => Promise<void>
  postCaffeination: () => void
  setReviewMarkdownRender: (value: boolean) => Promise<void>
}

export async function handleMessage(m: AgentManagerInMessage, host: MessageHost): Promise<void> {
  if (await handleProjectMessage(m, host.projects)) return
  const ctx = host.projectFor(m)
  if (!ctx) {
    host.log(`dropping ${m.type}: message targets an unknown project`)
    return
  }
  await host.scope.run(ctx, async () => {
    if (await shouldWaitForState(m, ctx, host)) return
    if (await handleWorktree(m, ctx, host)) return
    if (await handleSession(m, ctx, host)) return
    if (handleUi(m, host)) return
    if (handleState(m, host)) return
    if (await handleImport(m, host)) return
    if (await handleDiff(m, host)) return
    if (host.scripts.manager.intercept(m)) return
    if (host.terminals.handle(m)) return
  })
}

async function shouldWaitForState(m: AgentManagerInMessage, ctx: ProjectContext, host: MessageHost): Promise<boolean> {
  const gated = m.type === "agentManager.terminal.create" ? m.worktreeId !== null : STATE_GATED.has(m.type)
  if (!gated) return false
  const result = await initContextState(ctx, (...args) => host.log(...args))
  if (result.current && result.ok) return false
  host.log(`dropping ${m.type}: project ${ctx.id} not ready (current=${result.current}, ok=${result.ok})`)
  return true
}

async function handleWorktree(
  m: AgentManagerInMessage,
  ctx: ProjectContext,
  host: MessageHost,
): Promise<boolean> {
  if (m.type === "agentManager.createWorktree") {
    await host.onCreateWorktree(m.baseBranch, m.branchName)
    return true
  }
  if (m.type === "agentManager.deleteWorktree") {
    await host.onDeleteWorktree(m.worktreeId)
    return true
  }
  if (m.type === "agentManager.removeStaleWorktree") {
    await host.onRemoveStaleWorktree(m.worktreeId, m.keepSessions === true)
    return true
  }
  if (
    m.type === "agentManager.restoreWorktree" ||
    m.type === "agentManager.cleanOrphanDirectories" ||
    m.type === "agentManager.revealPath"
  ) {
    await host.recover(m)
    return true
  }
  if (m.type === "agentManager.promoteSession") {
    await host.onPromoteSession(m.sessionId)
    return true
  }
  if (m.type === "agentManager.addSessionToWorktree") {
    await host.onAddSessionToWorktree(m.worktreeId, m.sessionId)
    return true
  }
  if (m.type === "agentManager.updateFromBase") {
    await handleBaseUpdate(m, ctx, host.lifecycle, pushFixes())
    return true
  }
  return false
}

async function handleSession(m: AgentManagerInMessage, ctx: ProjectContext, host: MessageHost): Promise<boolean> {
  if (m.type === "agentManager.forkSession") {
    await host.onForkSession(m.sessionId, m.worktreeId, m.messageId)
    return true
  }
  if (m.type === "agentManager.closeSession") {
    await host.onCloseSession(m.sessionId)
    return true
  }
  if (m.type === "agentManager.openLocally") {
    const state = ctx.peekState()
    if (state?.getSession(m.sessionId)) {
      state.moveSession(m.sessionId, null)
      host.pushState()
    }
    return true
  }
  if (m.type === "continueInWorktree") {
    void host.continueFromSidebar(m.sessionId, (status, detail, error) => {
      host.log(`continueInWorktree: ${status}${detail ? ` ${detail}` : ""}${error ? ` (${error})` : ""}`)
      if (error) host.post({ type: "error", message: error })
    })
    return true
  }
  if (m.type === "agentManager.persistSession" || m.type === "agentManager.forgetSession") {
    await host.stateReady()?.then(() => {
      const state = ctx.peekState()
      if (!state) return
      if (m.type === "agentManager.persistSession") {
        if (!state.getSession(m.sessionId)) state.addSession(m.sessionId, null)
        return
      }
      state.removeSession(m.sessionId)
    })
    return true
  }
  if (m.type === "agentManager.openSessions") {
    host.trackOpenSessions(m.sessionIDs)
    return true
  }
  if (m.type === "agentManager.visibleSession") {
    host.trackVisibleSession(m.sessionID)
    return true
  }
  if (m.type === "agentManager.promptSent") {
    host.naming.prompt({
      sessionID: m.sessionId,
      text: m.text.trim(),
      providerID: m.providerID,
      modelID: m.modelID,
    })
    return true
  }
  if (m.type === "agentManager.requestCaffeination") {
    host.postCaffeination()
    return true
  }
  if (m.type === "agentManager.setCaffeination") {
    await host.setCaffeination(m.enabled)
    return true
  }
  return false
}

function handleUi(m: AgentManagerInMessage, host: MessageHost): boolean {
  if (m.type === "agentManager.configureSetupScript") {
    void host.configureSetupScript()
    return true
  }
  if (handleDestination(host.destination, m, (message) => host.log("[XTerm]", message))) return true
  if (handleRunMessage(host.run, m, (id) => host.runKey(id))) return true
  if (m.type === "agentManager.showTerminal") {
    host.integrated.showTerminal(m.sessionId, host.state())
    return true
  }
  if (m.type === "agentManager.showLocalTerminal") {
    host.integrated.showLocalTerminal()
    return true
  }
  if (m.type === "agentManager.showWorktreeTerminal") {
    host.integrated.showWorktreeTerminal(m.worktreeId, host.state())
    return true
  }
  if (m.type === "agentManager.showExistingLocalTerminal") {
    host.integrated.syncLocalOnSessionSwitch()
    return true
  }
  if (m.type === "agentManager.openWorktree") {
    host.openWorktreeDirectory(m.worktreeId)
    return true
  }
  if (m.type === "agentManager.copyToClipboard") {
    void host.host.copyToClipboard(m.text)
    return true
  }
  if (m.type === "agentManager.requestRepoInfo") {
    void host.sendRepoInfo()
    return true
  }
  if (m.type === "agentManager.createMultiVersion") {
    void host.onCreateMultiVersion(m)
    return true
  }
  if (m.type === "agentManager.renameWorktree") {
    const state = host.state()
    if (state) {
      state.updateWorktreeLabel(m.worktreeId, m.label)
      host.pushState()
    }
    return true
  }
  if (m.type === "agentManager.requestState") {
    void host.requestState()
    return true
  }
  return false
}

function handleState(m: AgentManagerInMessage, host: MessageHost): boolean {
  if (handleTabLayoutMessage(host.state(), m)) return true
  if (m.type === "agentManager.setWorktreeOrder") {
    host.state()?.setWorktreeOrder(m.order)
    host.pushState()
    return true
  }
  if (m.type === "agentManager.setSessionsCollapsed") {
    host.state()?.setSessionsCollapsed(m.collapsed)
    host.pushState()
    return true
  }
  if (m.type === "agentManager.setSidebarCollapsed") {
    host.state()?.setSidebarCollapsed(m.collapsed)
    return true
  }
  if (handleSection(host.state(), m, () => host.pushState(), (...args) => host.log(...args))) return true
  if (m.type === "agentManager.setReviewDiffStyle") {
    host.state()?.setReviewDiffStyle(m.style)
    return true
  }
  if (m.type === "agentManager.setReviewMarkdownRender") {
    void host
      .setReviewMarkdownRender(m.render)
      .catch((err: unknown) =>
        host.log("Failed to set diff markdown rendering:", err instanceof Error ? err.message : String(err)),
      )
      .then(() => host.pushState())
    return true
  }
  if (m.type === "agentManager.setDefaultBaseBranch") {
    host.state()?.setDefaultBaseBranch(normalizeBaseBranch(m.branch))
    host.pushState()
    return true
  }
  return false
}

async function handleImport(m: AgentManagerInMessage, host: MessageHost): Promise<boolean> {
  if (m.type === "agentManager.requestBranches") {
    void host.importer.branches(m.projectId)
    return true
  }
  if (m.type === "agentManager.importFromBranch") {
    void host.importer.branch(m.branch, m.projectId)
    return true
  }
  if (m.type === "agentManager.importFromPR") {
    void host.importer.pr(m.url, m.projectId)
    return true
  }
  return false
}

async function handleDiff(m: AgentManagerInMessage, host: MessageHost): Promise<boolean> {
  const projectId = host.context()?.id
  if (m.type === "agentManager.requestWorktreeDiff") {
    void host.diffs.request(composeDiffId(m.sessionId, normalizeScope(m.scope), m.diffSessionId, m.turnId))
    return true
  }
  if (m.type === "agentManager.requestWorktreeDiffFile") {
    void host.diffs.requestFile(
      composeDiffId(m.sessionId, normalizeScope(m.scope), m.diffSessionId, m.turnId),
      m.file,
    )
    return true
  }
  if (m.type === "agentManager.applyWorktreeDiff") {
    void host.diffs.apply(m.worktreeId, m.selectedFiles)
    return true
  }
  if (m.type === "agentManager.revertWorktreeFile") {
    void host.diffs.revert(composeDiffId(m.sessionId, normalizeScope(m.scope)), m.file)
    return true
  }
  if (m.type === "agentManager.startDiffWatch") {
    host.diffs.start(composeDiffId(m.sessionId, normalizeScope(m.scope), m.diffSessionId, m.turnId))
    return true
  }
  if (m.type === "agentManager.stopDiffWatch") {
    host.diffs.stop()
    return true
  }
  if (m.type === "agentManager.requestDiffBranches") {
    void host.sendDiffBranches(m.sessionId, m.scope, projectId)
    return true
  }
  if (m.type === "agentManager.setDiffBaseBranch") {
    void host.diffs
      .setBase(composeDiffId(m.sessionId, normalizeScope(m.scope)), m.branch)
      .catch((err: unknown) => host.log("Failed to set diff base:", err instanceof Error ? err.message : String(err)))
      .then(() => host.sendDiffBranches(m.sessionId, m.scope, projectId))
    return true
  }
  if (m.type === "agentManager.openFile") {
    host.openWorktreeFile(m.sessionId, m.filePath, m.line, m.column)
    return true
  }
  if (m.type === "agentManager.openExternal") {
    if (URL.canParse(m.url) && ["http:", "https:"].includes(new URL(m.url).protocol)) host.host.openExternal(m.url)
    return true
  }
  if (m.type === "agentManager.copyFilePath") {
    const target = resolveWorktreeFile(host.state(), m.sessionId, m.filePath, host.context()?.root)
    if (target) void Promise.resolve(host.host.copyToClipboard(target))
    return true
  }
  return false
}

/** Set the shared diff markdown preference. */
export async function setReviewMarkdownRender(value: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration("kilo-code.v2")
    .update("diff.renderMarkdown", value, vscode.ConfigurationTarget.Global)
}

export function getReviewMarkdownRender(): boolean {
  return vscode.workspace.getConfiguration("kilo-code.v2").get<boolean>("diff.renderMarkdown", false)
}
