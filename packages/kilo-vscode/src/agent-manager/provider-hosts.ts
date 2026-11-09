// Host adapters passed to the lifecycle, multi-version, and message handlers. Split out of
// AgentManagerProvider so the class file stays readable; the provider supplies itself as the source.
import type { AgentManagerConnection } from "./connection"
import type { Host, PanelContext } from "./host"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "./types"
import type { ProjectContext } from "./project/context"
import type { ProjectContexts } from "./project/contexts"
import type { ProjectMessageDeps } from "./project/messages"
import type { ProjectScope } from "./project/scope"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import type { LifecycleHost } from "./provider-lifecycle"
import type { MultiVersionHost } from "./provider-multi-version"
import type { MessageHost } from "./provider-messages"
import type { BranchNamingController } from "./branch-naming"
import type { WorktreeImporter } from "./worktree-importer"
import type { WorktreeDiffController } from "./worktree-diff-controller"
import type { TerminalRouter } from "./terminal-routing"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { RunController } from "./run/controller"
import type { RecoveryMessage } from "./worktree-recovery"
import type { CreateWorktreeOnDiskOptions, CreateWorktreeOnDiskResult } from "./worktree-create"
import type { GitStatsPoller } from "./GitStatsPoller"
import type { PRStatusBridge } from "./pr-status-bridge"
import { clearScriptTerminals } from "./script-terminal-runtime"
import type { Timing } from "./creation-timing"
import type { CreationBoot } from "./provider-lifecycle"
import type { CreateWorktreeResult } from "./WorktreeManager"

export interface ProviderHostsSource {
  readonly connection: AgentManagerConnection
  readonly host: Host
  readonly contexts: ProjectContexts
  readonly projects: ProjectMessageDeps
  readonly projectScope: ProjectScope
  readonly naming: BranchNamingController
  readonly importer: WorktreeImporter
  readonly diffs: WorktreeDiffController
  readonly terminalRouter: TerminalRouter
  readonly scripts: { manager: ScriptTerminalManager }
  readonly run: RunController
  readonly statsPoller: GitStatsPoller
  readonly prBridge: PRStatusBridge
  readonly panel: PanelContext | undefined
  readonly context: ProjectContext | undefined
  readonly state: WorktreeStateManager | undefined
  readonly stateReady: Promise<void> | undefined
  createWorktreeOnDisk(opts?: CreateWorktreeOnDiskOptions): Promise<CreateWorktreeOnDiskResult | null>
  getSetupScriptService(): { hasScript(): boolean } | undefined
  runSetupScriptForWorktree(path: string, branch: string | undefined, id: string, early?: () => Promise<void>): Promise<void>
  createSessionInWorktree(
    path: string,
    branch: string,
    id?: string,
    timing?: Timing,
    model?: { providerID: string; modelID: string; variant?: string },
    agent?: string,
    boot?: CreationBoot,
  ): Promise<SessionInfo | null>
  notifyWorktreeReady(sessionId: string, result: CreateWorktreeResult, worktreeId?: string): void
  interrupt(ids: readonly string[]): Promise<void>
  pushState(ctx?: ProjectContext): void
  registerWorktreeSession(sessionId: string, directory: string): void
  acquirePtyCleanup(directory: string): Promise<() => void>
  postToWebview(message: AgentManagerOutMessage): void
  log(...args: unknown[]): void
  openPanel(preserveFocus?: boolean): void
  waitForStateReady(where: string): Promise<void>
  onCreateWorktree(baseBranch?: string, branchName?: string): Promise<null>
  onDeleteWorktree(id: string): Promise<null>
  onRemoveStaleWorktree(id: string, keepSessions: boolean): Promise<null>
  recover(message: RecoveryMessage): Promise<null>
  requestState(): Promise<void>
  onPromoteSession(id: string): Promise<null>
  onAddSessionToWorktree(worktreeId: string, sessionId?: string): Promise<null>
  onForkSession(sessionId: string, worktreeId?: string, messageId?: string): Promise<null>
  onCloseSession(sessionId: string): Promise<null>
  onCreateMultiVersion(
    message: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>,
  ): Promise<null>
  continueFromSidebar(
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void>
  continueInWorktree(
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void>
  configureSetupScript(): Promise<void>
  sendRepoInfo(): Promise<void>
  sendDiffBranches(sessionId: string, scope?: string, projectId?: string): Promise<void>
  openWorktreeDirectory(id: string): void
  openWorktreeFile(id: string, file: string, line?: number, column?: number): void
  readDocument(sessionId: string, file: string, contextKey?: string): Promise<void>
  validateFiles(id: string, sessionId: string, paths: string[]): Promise<void>
  runKey(id: string): string
  trackOpenSessions(ids: string[]): void
  trackVisibleSession(id: string | null): void
  setCaffeination(enabled: boolean): Promise<void>
  postCaffeination(): void
  setReviewMarkdownRender(value: boolean): Promise<void>
  messageProject(m: AgentManagerInMessage): ProjectContext | undefined
  client(): Promise<OpenCodeClient>
}

export function messageHost(p: ProviderHostsSource): MessageHost {
  return {
    connection: p.connection,
    host: p.host,
    contexts: p.contexts,
    projects: p.projects,
    scope: p.projectScope,
    lifecycle: lifecycleHost(p),
    naming: p.naming,
    importer: p.importer,
    diffs: p.diffs,
    terminals: p.terminalRouter,
    scripts: p.scripts,
    run: p.run,
    panel: () => p.panel,
    context: () => p.context,
    state: () => p.state,
    stateReady: () => p.stateReady,
    post: (out) => p.postToWebview(out),
    log: (...args) => p.log(...args),
    pushState: (ctx) => p.pushState(ctx),
    waitForStateReady: (where) => p.waitForStateReady(where),
    openPanel: (preserve) => p.openPanel(preserve),
    onCreateWorktree: (baseBranch, branchName) => p.onCreateWorktree(baseBranch, branchName),
    onDeleteWorktree: (id) => p.onDeleteWorktree(id),
    onRemoveStaleWorktree: (id, keep) => p.onRemoveStaleWorktree(id, keep),
    recover: (message) => p.recover(message),
    projectFor: (m) => p.messageProject(m),
    requestState: () => p.requestState(),
    onPromoteSession: (id) => p.onPromoteSession(id),
    onAddSessionToWorktree: (id, session) => p.onAddSessionToWorktree(id, session),
    onForkSession: (id, worktree, message) => p.onForkSession(id, worktree, message),
    onCloseSession: (id) => p.onCloseSession(id),
    onCreateMultiVersion: (msg) => p.onCreateMultiVersion(msg),
    continueFromSidebar: (id, progress) => p.continueFromSidebar(id, progress),
    continueInWorktree: (id, progress) => p.continueInWorktree(id, progress),
    configureSetupScript: () => p.configureSetupScript(),
    sendRepoInfo: () => p.sendRepoInfo(),
    sendDiffBranches: (id, scope, project) => p.sendDiffBranches(id, scope, project),
    openWorktreeDirectory: (id) => p.openWorktreeDirectory(id),
    openWorktreeFile: (id, file, line, column) => p.openWorktreeFile(id, file, line, column),
    readDocument: (sessionId, file, contextKey) => p.readDocument(sessionId, file, contextKey),
    validateFiles: (id, sessionId, paths) => p.validateFiles(id, sessionId, paths),
    runKey: (id) => p.runKey(id),
    view: (ids) => p.connection.view(ids),
    trackOpenSessions: (ids) => p.trackOpenSessions(ids),
    trackVisibleSession: (id) => p.trackVisibleSession(id),
    setCaffeination: (enabled) => p.setCaffeination(enabled),
    postCaffeination: () => p.postCaffeination(),
    setReviewMarkdownRender: (value) => p.setReviewMarkdownRender(value),
  }
}

export function lifecycleHost(p: ProviderHostsSource): LifecycleHost {
  return {
    createOnDisk: (opts) => p.createWorktreeOnDisk(opts),
    hasScript: () => p.getSetupScriptService()?.hasScript() ?? false,
    runSetup: (dir, branch, id, early) => p.runSetupScriptForWorktree(dir, branch, id, early),
    createSession: (dir, branch, id, timing, model) => p.createSessionInWorktree(dir, branch, id, timing, model),
    notifyReady: (sid, result, id) => p.notifyWorktreeReady(sid, result, id),
    abort: (ids) => p.interrupt(ids),
    push: () => p.pushState(),
    register: (sid, dir) => p.registerWorktreeSession(sid, dir),
    skipStats: (id) => p.statsPoller.skipWorktree(id),
    unskipStats: (id) => p.statsPoller.unskipWorktree(id),
    removePR: (id) => p.prBridge.remove(id),
    removeRun: (id) => p.run.remove(id),
    clearRun: (id) => clearScriptTerminals(p.scripts.manager, id, p.context?.id),
    forgetName: (id) => p.naming.forget(id),
    stopDiffs: (target, orphaned) => {
      if (p.diffs.shouldStopForWorktree(target, orphaned)) p.diffs.stop()
    },
    autoName: () => p.host.autoBranchNaming(),
    client: () => p.client(),
    acquirePtyCleanup: (directory) => p.acquirePtyCleanup(directory),
    post: (message) => p.postToWebview(message),
    notify: (message) => p.host.showError(message),
    log: (...args) => p.log(...args),
  }
}

export function multiVersionHost(p: ProviderHostsSource): MultiVersionHost {
  return {
    ...lifecycleHost(p),
    promptName: (input) => p.naming.prompt(input),
    error: (message) => p.host.showError(message),
  }
}

export type { MultiVersionHost }
