import * as fs from "fs"
import * as path from "path"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { getErrorMessage } from "../kilo-provider-utils"
import { resolveLocalDiffTarget } from "../diff/shared/target"
import { getDiffMarkdownRender, setDiffMarkdownRender } from "../review-settings"
import { isAbsolutePath } from "../path-utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { remoteRef, WorktreeStateManager, type Worktree } from "./WorktreeStateManager"
import { handleSection } from "./section-handler"
import { normalizeBaseBranch } from "./base-branch"
import { GitStatsPoller, type LocalStats, type WorktreePresenceResult, type WorktreeStats } from "./GitStatsPoller"
import { PRStatusBridge } from "./pr-status-bridge"
import { GitOps } from "./GitOps"
import { versionedName } from "./branch-name"
import { BranchNamingController } from "./branch-naming"
import { SetupScriptService } from "./SetupScriptService"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { copyEnvFiles } from "./env-copy"
import { SessionTerminalManager } from "./SessionTerminalManager"
import { createTerminalHost } from "./terminal-host"
import { TerminalRouter } from "./terminal-routing"
import { executeVscodeTask } from "./task-runner"
import { startVscodeRunTask } from "./run/task"
import { RunController } from "./run/controller"
import { handleRunMessage } from "./run/message"
import { forkSession } from "./fork-session"
import { AgentManagerVisiblePresence } from "./am-visible-presence"
import { continueInWorktree } from "./continue-in-worktree"
import { WorktreeDiffController } from "./worktree-diff-controller"
import { WorktreeImporter } from "./worktree-importer"
import {
  createWorktreeOnDisk,
  type CreateWorktreeOnDiskOptions,
  type CreateWorktreeOnDiskResult,
} from "./worktree-create"
import { recordPromotionHandoff } from "./promotion-handoff"
import { restoreWorktrees } from "./state-recovery"
import { createLocalDiff, diffSummary as localDiffSummary } from "./local-diff"
import { parseToolRequest, startFromTool, type ToolRequest } from "./tool-start"
import { stopSessionProcesses } from "../kilo-provider/background-process"
import { sandboxSessionMetadata } from "../shared/sandbox-session"
import { AgentManagerOrchestrationBridge } from "./orchestration-bridge"
import { pruneSubagents } from "./prune-subagents"

import { startSession } from "./mcp-warmup"
import { readTerminalFont, watchTerminalFont } from "./terminal-font"
import { buildKeybindingMap } from "./format-keybinding"
import { resolveVersionModels, buildInitialMessages, type CreatedVersion } from "./multi-version"
import { ensureSandbox } from "./sandbox-bootstrap"
import { Semaphore } from "./semaphore"
import { PLATFORM } from "./constants"
import type { AgentManagerOutMessage, AgentManagerInMessage } from "./types"
import type { Host, PanelContext, OutputHandle, Disposable } from "./host"
export class AgentManagerProvider implements Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"
  private panel: PanelContext | undefined
  private outputChannel: OutputHandle
  private worktrees: WorktreeManager | undefined
  private state: WorktreeStateManager | undefined
  private setupScript: SetupScriptService | undefined
  private importer: WorktreeImporter
  private terminalManager: SessionTerminalManager
  private terminalRouter: TerminalRouter
  private run: RunController
  private stateReady: Promise<void> | undefined
  private statsPoller: GitStatsPoller
  private prBridge!: PRStatusBridge
  private orchestration: AgentManagerOrchestrationBridge
  private gitOps: GitOps
  private diffs: WorktreeDiffController
  private naming: BranchNamingController
  private staleWorktreeIds = new Set<string>()
  private toolRequests = new Set<string>()
  private cachedWorktreeStats: { type: "agentManager.worktreeStats"; stats: WorktreeStats[] } | undefined
  private cachedLocalStats: { type: "agentManager.localStats"; stats: LocalStats } | undefined
  private unsubTool: (() => void) | undefined
  private unsubStatus: (() => void) | undefined
  private unsubFont: (() => void) | undefined
  private closing: Promise<void> | undefined
  private onVisibilityChange: ((visible: boolean) => void) | undefined
  // Tracks sessions owned by this panel until they are explicitly closed.
  private panelSessions = new Set<string>()

  /** Session ID most recently loaded via `loadMessages`; updated synchronously. */
  private activeSessionId: string | undefined
  private visiblePresence = new AgentManagerVisiblePresence(
    (ids) => this.connectionService.registerVisible("agent-manager", ids),
    () => this.panel?.visible ?? false,
    (ids) => this.connectionService.registerAttached("agent-manager", ids),
  )
  constructor(
    private readonly host: Host,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = host.createOutput("Kilo Agent Manager")
    this.terminalManager = new SessionTerminalManager(
      (msg) => this.outputChannel.appendLine(`[SessionTerminal] ${msg}`),
      createTerminalHost(),
    )
    this.terminalRouter = new TerminalRouter({
      getClient: () => this.connectionService.getClient(),
      getServerConfig: () => this.connectionService.getServerConfig() ?? undefined,
      getRoot: () => this.getRoot(),
      getWorktreePath: (id) => this.getStateManager()?.getWorktree(id)?.path,
      log: (...args) => this.log("[XTerm]", ...args),
      post: (msg) => this.postToWebview(msg),
      getTerminalFont: () => readTerminalFont(),
    })
    this.unsubFont = watchTerminalFont((font) => {
      this.postToWebview({ type: "agentManager.terminal.fontChanged", font })
    })
    this.run = new RunController({
      root: () => this.getRoot(),
      state: () => this.getStateManager(),
      open: (file) => this.host.openDocument(file),
      start: startVscodeRunTask,
      post: (status) => this.postToWebview({ type: "agentManager.runStatus", ...status }),
      error: (message) => this.postToWebview({ type: "error", message }),
      log: (msg) => this.outputChannel.appendLine(`[RunScript] ${msg}`),
      refresh: () => this.pushState(),
    })
    this.importer = new WorktreeImporter({
      manager: () => this.getWorktreeManager(),
      state: () => this.getStateManager(),
      post: (msg) => this.postToWebview(msg),
      push: () => this.pushState(),
      setup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
      session: (dir, branch, id) => this.createSessionInWorktree(dir, branch, id),
      register: (sid, dir) => this.registerWorktreeSession(sid, dir),
      ready: (sid, result, id) => this.notifyWorktreeReady(sid, result, id),
      log: (...args) => this.log(...args),
    })
    const semaphore = new Semaphore(3)
    this.gitOps = new GitOps({ log: (...args) => this.log(...args), semaphore })
    this.naming = new BranchNamingController({
      state: () => this.getStateManager(),
      manager: () => this.getWorktreeManager(),
      client: (dir) => this.connectionService.getClientAsync(dir),
      settings: () => this.host.autoBranchNaming(),
      push: () => this.pushState(),
      log: (msg) => this.log(msg),
    })
    const local = createLocalDiff(this.gitOps, (...args) => this.log(...args))
    this.diffs = new WorktreeDiffController({
      getState: () => this.getStateManager(),
      getRoot: () => this.getRoot(),
      getStateReady: () => this.stateReady,
      git: this.gitOps,
      localDiff: local.summary,
      localDiffFile: local.file,
      post: (msg) => this.postToWebview(msg),
      log: (...args) => this.log(...args),
    })
    this.statsPoller = new GitStatsPoller({
      getWorktrees: () => this.state?.getWorktrees() ?? [],
      getWorkspaceRoot: () => this.getRoot(),
      localDiff: (dir, base) => localDiffSummary(this.gitOps, dir, base, (...args) => this.log(...args)),
      semaphore,
      onStats: (stats) => {
        const msg = { type: "agentManager.worktreeStats" as const, stats }
        this.cachedWorktreeStats = msg
        this.postToWebview(msg)
      },
      onLocalStats: (stats) => {
        const msg = { type: "agentManager.localStats" as const, stats }
        this.cachedLocalStats = msg
        this.postToWebview(msg)
      },
      onWorktreePresence: (presence) => {
        this.onWorktreePresence(presence)
      },
      log: (...args) => this.log(...args),
      git: this.gitOps,
    })
    this.prBridge = PRStatusBridge.create({
      getWorktrees: () => this.state?.getWorktrees() ?? [],
      getWorkspaceRoot: () => this.getRoot(),
      postToWebview: (m) => this.postToWebview(m),
      updateWorktreePR: (id, n, u, s) => this.state?.updateWorktreePR(id, n, u, s),
      hasPersistedPR: (id: string) => !!this.state?.getWorktree(id)?.prNumber,
      openExternal: (u) => this.host.openExternal(u),
      log: (...a) => this.log(...a),
      semaphore,
    })
    this.orchestration = new AgentManagerOrchestrationBridge(this.connectionService, {
      root: () => this.getRoot(),
      state: () => this.state,
      ready: async () => {
        this.stateReady ??= this.initializeState()
        await this.stateReady
        return this.state
      },
      stats: (refresh) => this.statsPoller.snapshot(refresh),
      prs: () => this.prBridge.snapshot(),
      managed: (id) => this.panelSessions.has(id) || !!this.state?.getSession(id),
      close: async (id) => {
        await this.onCloseSession(id)
      },
      log: (...args) => this.log(...args),
    })
    this.unsubTool = this.connectionService.onEventFiltered(
      (event) => (event as { type?: string }).type === "kilocode.agent_manager.start",
      (event, directory) => this.onToolEvent(event, directory),
    )
    this.unsubStatus = this.connectionService.onEventFiltered(
      (event) => (event as { type?: string }).type === "session.status",
      (event) => this.onSessionStatus(event),
    )
  }

  private onSessionStatus(event: unknown): void {
    const props = (event as { properties?: { sessionID?: string; status?: { type?: string } } }).properties
    const sid = props?.sessionID
    const type = props?.status?.type
    if (!sid || !type) return
    if (type === "idle") this.naming.idle(sid)
    else this.naming.busy(sid)
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  public openPanel(preserveFocus?: boolean): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal(preserveFocus)
      if (!preserveFocus) this.postToWebview({ type: "action", action: "focusInput" })
      return
    }
    this.log("Opening Agent Manager panel")
    this.host.capture("Agent Manager Opened", { source: PLATFORM })

    this.attachPanel(
      this.host.openPanel({
        onBeforeMessage: (msg) => this.onMessage(msg),
        worktreeDirectories: () => this.getWorktreeDirectories(),
      }),
    )
  }

  public onPanelVisibilityChange(cb: (visible: boolean) => void): void {
    this.onVisibilityChange = cb
  }

  /** Restore the Agent Manager panel from a previously serialized state.
   *  The caller (extension.ts / vscode-host.ts) wraps the raw panel before passing it. */
  public deserializePanel(ctx: PanelContext): void {
    if (this.panel) {
      this.log("Panel already exists during deserialization, disposing duplicate")
      ctx.dispose()
      return
    }
    this.log("Deserializing Agent Manager panel")
    this.attachPanel(ctx)
  }

  /** Message interceptor — exposed for the deserialization path in extension.ts. */
  public handleMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return this.onMessage(msg)
  }

  /** Wire up a panel context (shared by openPanel and deserializePanel). */
  private attachPanel(ctx: PanelContext): void {
    if (this.panel) {
      this.log("Disposing previous panel before attaching new one")
      const panel = this.panel
      this.panel = undefined
      panel.dispose()
    }
    this.panel = ctx

    this.statsPoller.setVisible(ctx.visible)
    this.onVisibilityChange?.(ctx.visible)
    ctx.onDidChangeVisibility((visible) => {
      this.statsPoller.setVisible(visible)
      this.visiblePresence.flush()
    })

    ctx.sessions.onFollowupAdopted((session, directory) => {
      this.adoptFollowupInWorktree(session, directory)
    })

    this.stateReady = this.initializeState()
    void this.sendRepoInfo()
    this.sendKeybindings()
    this.prBridge.attachPanel(ctx)
    ctx.onDidDispose(() => {
      // Only clear if this is still the active panel — a newer panel may
      // have already replaced us via attachPanel.
      if (this.panel === ctx) {
        this.log("Panel disposed")
        const ids = [...this.panelSessions]
        if (this.activeSessionId) ids.push(this.activeSessionId)
        this.panelSessions.clear()
        void ctx.sessions.abortSessions(ids).catch((err) => this.log("Failed to abort sessions on panel close:", err))
        this.statsPoller.stop()
        this.prBridge.poller.stop()
        this.diffs.stop()
        this.activeSessionId = undefined
        this.visiblePresence.clear()
        this.panel = undefined
        this.onVisibilityChange?.(false)
      }
      ctx.sessions.dispose()
    })
  }

  // State initialization

  private async initializeState(): Promise<void> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.pushEmptyState()
      return
    }

    await this.ensureGitExclude(manager)
    const loaded = await state.load()
    manager.cleanupOrphanedTempDirs()

    if (loaded.status === "failed" && !(await state.prepareRecovery())) {
      this.postToWebview({ type: "error", message: "Agent Manager state could not be recovered." })
      this.pushState()
      return
    }

    await this.recoverWorktrees(manager, state)

    // When the .kilocode → .kilo migration rewrote git worktree refs, nudge
    // VS Code's git extension to re-discover them. Without this, worktrees
    // won't appear in Source Control until the next VS Code restart.
    if (loaded.refsFixed > 0) {
      this.log(`Migration fixed ${loaded.refsFixed} git worktree ref(s), refreshing git`)
      this.host.refreshGit()
    }

    for (const wt of state.getWorktrees()) {
      for (const s of state.getSessions(wt.id)) this.panel?.sessions.setSessionDirectory(s.id, wt.path)
    }
    await pruneSubagents(state, this.panel?.sessions, (message) => this.log(message))
    for (const s of state.getSessions()) this.panel?.sessions.trackSession(s.id)
    this.pushState()

    // Refresh sessions so worktree sessions appear in the list
    if (state.getSessions().length > 0) {
      this.panel?.sessions.refreshSessions()
    }

    // Recover any pending permission/question prompts that were missed during
    // panel recreation or SSE reconnection. Must run after all worktree sessions
    // are registered with their directory overrides so the recovery queries the
    // correct CLI backend Instances.
    this.panel?.sessions.recoverPendingPrompts()
  }

  private async ensureGitExclude(manager: WorktreeManager): Promise<void> {
    await manager.ensureGitExclude().catch((err) => {
      this.log("Failed to update git exclude:", err)
    })
  }

  private async recoverWorktrees(manager: WorktreeManager, state: WorktreeStateManager): Promise<void> {
    const infos = await manager.discoverWorktrees().catch((err) => {
      this.log("Failed to discover worktrees during state recovery:", err)
      return []
    })
    if (infos.length === 0) return

    const result = restoreWorktrees(state, infos)
    if (result.worktrees === 0 && result.sessions === 0) return

    this.log(`Recovered ${result.worktrees} worktree(s) and ${result.sessions} session(s) from disk`)
    await state.flush()
  }

  // Message interceptor

  private async onMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.prBridge.handleMessage(msg)) return null
    if (msg.type === "requestFileSearch" && typeof msg.sessionID !== "string" && this.activeSessionId) {
      return { ...msg, sessionID: this.activeSessionId }
    }
    msg = await this.contextMessage(msg)
    const m = msg as unknown as AgentManagerInMessage
    if (this.shouldWaitForState(m)) await this.waitForStateReady(m.type)
    this.onBranchPrompt(m)

    const worktree = await this.onWorktreeMessage(m)
    if (worktree !== undefined) return worktree
    const session = this.onSessionMessage(m, msg)
    if (session !== undefined) return session
    const ui = this.onUiMessage(m, msg)
    if (ui !== undefined) return ui
    const state = this.onStateMessage(m)
    if (state !== undefined) return state
    const imports = this.onImportMessage(m)
    if (imports !== undefined) return imports
    const diff = this.onDiffMessage(m)
    if (diff !== undefined) return diff
    const bridge = this.onBridgeMessage(m)
    if (bridge !== undefined) return bridge
    if (this.terminalRouter.handle(m)) return null

    return msg
  }

  private onBranchPrompt(m: AgentManagerInMessage): void {
    if (m.type !== "sendMessage" && m.type !== "sendCommand") return
    const sessionID = m.sessionID ?? m.draftID ?? this.activeSessionId
    if (!sessionID) return
    const text = m.type === "sendMessage" ? m.text.trim() : `/${m.command} ${m.arguments}`.trim()
    if (!text) return
    this.naming.prompt({ sessionID, text, providerID: m.providerID, modelID: m.modelID })
  }

  private async contextMessage(msg: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (msg.type !== "requestGitChangesContext") return msg
    const ctx = typeof msg.agentManagerContext === "string" ? msg.agentManagerContext : undefined
    const target = ctx ? await this.contextTarget(ctx) : undefined
    const sid = typeof msg.sessionID === "string" ? msg.sessionID : this.activeSessionId
    const next = sid && typeof msg.sessionID !== "string" ? { ...msg, sessionID: sid } : msg
    if (target) return { ...next, ...target }
    if (!sid) return next

    const state = this.getStateManager()
    const session = state?.getSession(sid)
    const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
    if (!worktree) return next
    return { ...next, contextDirectory: worktree.path, gitChangesBase: remoteRef(worktree) }
  }

  private async contextTarget(ctx: string): Promise<Record<string, unknown> | undefined> {
    if (ctx === "local") {
      const root = this.getRoot()
      if (!root) return undefined
      const target = await resolveLocalDiffTarget(this.gitOps, (...args) => this.log(...args), root)
      if (!target) return { contextDirectory: root }
      return { contextDirectory: target.directory, gitChangesBase: target.baseBranch }
    }

    const worktree = this.getStateManager()?.getWorktree(ctx)
    if (!worktree) return undefined
    return { contextDirectory: worktree.path, gitChangesBase: remoteRef(worktree) }
  }

  private async onWorktreeMessage(m: AgentManagerInMessage): Promise<Record<string, unknown> | null | undefined> {
    if (m.type === "agentManager.createWorktree") return this.onCreateWorktree(m.baseBranch, m.branchName)
    if (m.type === "agentManager.deleteWorktree") return this.onDeleteWorktree(m.worktreeId)
    if (m.type === "agentManager.removeStaleWorktree") return this.onRemoveStaleWorktree(m.worktreeId)
    if (m.type === "agentManager.promoteSession") return this.onPromoteSession(m.sessionId)
    if (m.type === "agentManager.addSessionToWorktree") return this.onAddSessionToWorktree(m.worktreeId, m.sessionId)
    if (m.type === "agentManager.forkSession") return this.onForkSession(m.sessionId, m.worktreeId, m.messageId)
    if (m.type === "agentManager.closeSession") return this.onCloseSession(m.sessionId)
  }

  private onSessionMessage(
    m: AgentManagerInMessage,
    msg: Record<string, unknown>,
  ): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.openLocally") {
      this.panel?.sessions.clearSessionDirectory(m.sessionId)
      const state = this.getStateManager()
      if (state?.getSession(m.sessionId)) {
        state.moveSession(m.sessionId, null)
        this.pushState()
      }
      return null
    }

    if (m.type === "continueInWorktree") {
      void this.continueFromSidebar(m.sessionId, (status, detail, error) => {
        this.panel?.postMessage({ type: "continueInWorktreeProgress", status, detail, error })
      })
      return null
    }

    if (m.type === "agentManager.persistSession" || m.type === "agentManager.forgetSession") {
      const persist = m.type === "agentManager.persistSession"
      if (persist && m.draftID) {
        this.panel?.sessions.acknowledgeDraft(m.draftID, m.sessionId)
        this.panelSessions.delete(m.draftID)
        this.panelSessions.add(m.sessionId)
      }
      void this.stateReady?.then(() => {
        const state = this.getStateManager()
        if (!state) return
        if (persist) {
          if (!state.getSession(m.sessionId)) state.addSession(m.sessionId, null)
          return
        }
        state.removeSession(m.sessionId)
      })
      return null
    }

    if (
      m.type === "requestSandboxDefault" ||
      m.type === "setSandboxDefault" ||
      ((m.type === "sendMessage" || m.type === "sendCommand" || m.type === "toggleSandbox") && !m.sessionID)
    ) {
      if (m.type === "sendMessage" || m.type === "sendCommand") {
        if (m.draftID) this.panelSessions.add(m.draftID)
      }
      const ctx = typeof m.agentManagerContext === "string" ? m.agentManagerContext : undefined
      const worktree = ctx && ctx !== "local" ? this.getStateManager()?.getWorktree(ctx) : undefined
      if (worktree) {
        if ("draftID" in m && m.draftID) this.activeSessionId = m.draftID
        return { ...msg, contextDirectory: worktree.path }
      }
    }

    if (
      (m.type === "sendMessage" || m.type === "sendCommand" || m.type === "toggleSandbox") &&
      m.draftID &&
      !m.sessionID
    ) {
      this.activeSessionId = m.draftID
      return msg
    }

    if (m.type === "requestTerminalContext") {
      if (!m.sessionID || this.terminalManager.prepareContext(m.sessionID)) return msg
      this.panel?.postMessage({
        type: "terminalContextError",
        requestId: m.requestId,
        error: "No terminal is associated with this session",
      })
      return null
    }

    if (m.type === "loadMessages") {
      this.activeSessionId = m.sessionID
      this.terminalManager.syncOnSessionSwitch(m.sessionID)
      this.prBridge.poller.setActiveWorktreeId(this.state?.getSession(m.sessionID)?.worktreeId ?? undefined)
      return msg
    }

    if (m.type === "clearSession") {
      this.activeSessionId = undefined
      this.visiblePresence.setDisplayed(null)
      void Promise.resolve().then(() => {
        if (!this.panel || !this.state) return
        for (const id of this.state.worktreeSessionIds()) {
          this.panel.sessions.trackSession(id)
        }
      })
      return msg
    }

    if (m.type === "abort") {
      this.host.capture("Agent Manager Session Stopped", {
        source: PLATFORM,
        sessionId: m.sessionID,
      })
      return msg
    }

    if (m.type === "agentManager.openSessions") {
      for (const id of m.sessionIDs) this.panelSessions.add(id)
    }
    if (m.type === "agentManager.openSessions" || m.type === "agentManager.visibleSession") {
      this.visiblePresence.handle(m)
      return null
    }
  }

  private onUiMessage(
    m: AgentManagerInMessage,
    msg: Record<string, unknown>,
  ): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.configureSetupScript") {
      void this.configureSetupScript()
      return null
    }
    if (handleRunMessage(this.run, m)) return null
    if (m.type === "agentManager.showTerminal") {
      this.terminalManager.showTerminal(m.sessionId, this.state)
      return null
    }
    if (m.type === "agentManager.showLocalTerminal") {
      this.terminalManager.showLocalTerminal()
      return null
    }
    if (m.type === "agentManager.openWorktree") {
      this.openWorktreeDirectory(m.worktreeId)
      return null
    }
    if (m.type === "agentManager.copyToClipboard") {
      this.host.copyToClipboard(m.text)
      return null
    }
    if (m.type === "previewImage") return msg
    if (m.type === "saveImage") return msg
    if (m.type === "agentManager.showExistingLocalTerminal") {
      this.terminalManager.syncLocalOnSessionSwitch()
      return null
    }
    if (m.type === "agentManager.requestRepoInfo") {
      void this.sendRepoInfo()
      return null
    }
    if (m.type === "agentManager.createMultiVersion") {
      void this.onCreateMultiVersion(m)
      return null
    }
    if (m.type === "agentManager.renameWorktree") {
      const state = this.getStateManager()
      if (state) {
        state.updateWorktreeLabel(m.worktreeId, m.label)
        this.pushState()
      }
      return null
    }
  }

  private onStateMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.requestState") {
      this.onRequestState()
      return null
    }
    if (m.type === "agentManager.setTabOrder") {
      this.state?.setTabOrder(m.key, m.order)
      return null
    }
    if (m.type === "agentManager.setWorktreeOrder") {
      this.state?.setWorktreeOrder(m.order)
      return null
    }
    if (m.type === "agentManager.setSessionsCollapsed") {
      this.state?.setSessionsCollapsed(m.collapsed)
      return null
    }
    if (m.type === "agentManager.setSidebarCollapsed") {
      this.state?.setSidebarCollapsed(m.collapsed)
      return null
    }
    if (this.handleSection(m)) return null
    if (m.type === "agentManager.setReviewDiffStyle") {
      this.state?.setReviewDiffStyle(m.style)
      return null
    }
    if (m.type === "agentManager.setReviewMarkdownRender") {
      void setDiffMarkdownRender(m.render).then(() => this.pushState())
      return null
    }
    if (m.type === "agentManager.setDefaultBaseBranch") {
      this.state?.setDefaultBaseBranch(normalizeBaseBranch(m.branch))
      this.pushState()
      return null
    }
  }

  private onImportMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.requestBranches") {
      void this.importer.branches()
      return null
    }
    if (m.type === "agentManager.requestExternalWorktrees") {
      void this.importer.external()
      return null
    }
    if (m.type === "agentManager.importFromBranch") {
      void this.importer.branch(m.branch)
      return null
    }
    if (m.type === "agentManager.importFromPR") {
      void this.importer.pr(m.url)
      return null
    }
    if (m.type === "agentManager.importExternalWorktree") {
      void this.importer.path(m.path, m.branch)
      return null
    }
    if (m.type === "agentManager.importAllExternalWorktrees") {
      void this.importer.all()
      return null
    }
  }

  private onDiffMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type === "agentManager.requestWorktreeDiff") {
      void this.diffs.request(m.sessionId)
      return null
    }
    if (m.type === "agentManager.requestWorktreeDiffFile") {
      void this.diffs.requestFile(m.sessionId, m.file)
      return null
    }
    if (m.type === "agentManager.applyWorktreeDiff") {
      void this.diffs.apply(m.worktreeId, m.selectedFiles)
      return null
    }
    if (m.type === "agentManager.revertWorktreeFile") {
      void this.diffs.revert(m.sessionId, m.file)
      return null
    }
    if (m.type === "agentManager.startDiffWatch") {
      this.diffs.start(m.sessionId)
      return null
    }
    if (m.type === "agentManager.stopDiffWatch") {
      this.diffs.stop()
      return null
    }
    if (m.type === "agentManager.openFile") {
      this.openWorktreeFile(m.sessionId, m.filePath, m.line, m.column)
      return null
    }
  }

  private onBridgeMessage(m: AgentManagerInMessage): Record<string, unknown> | null | undefined {
    if (m.type !== "openFile") return undefined

    const sessionId = this.activeSessionId
    const state = this.getStateManager()
    if (sessionId && state?.directoryFor(sessionId)) {
      this.openWorktreeFile(sessionId, m.filePath, m.line, m.column)
      return null
    }
  }

  private onRequestState(): void {
    void this.stateReady
      ?.then(() => {
        // When the folder is not a git repo (or has no folder open),
        // this.state is never created. pushState() silently returns in that
        // case, so re-send the empty/non-git state explicitly.
        if (!this.state) {
          this.pushEmptyState()
          return
        }
        this.pushState()
        // Re-send cached stats so the webview gets them even if the poller
        // already emitted before the webview was ready to receive messages.
        if (this.cachedWorktreeStats) this.postToWebview(this.cachedWorktreeStats)
        if (this.cachedLocalStats) this.postToWebview(this.cachedLocalStats)
        this.prBridge.replay()
        // Refresh sessions after pushState so the webview's sessionsLoaded
        // handler is guaranteed to be registered (requestState fires from
        // onMount). Without this, the initial refreshSessions() in
        // initializeState() can race ahead of webview mount, causing
        // sessionsLoaded to never flip to true.
        if (this.state.getSessions().length > 0) {
          this.panel?.sessions.refreshSessions()
        }
      })
      .catch((err) => {
        this.log("initializeState failed, pushing partial state:", err)
        if (!this.state) {
          this.pushEmptyState()
          return
        }
        this.pushState()
      })
  }

  // Shared helpers

  /** Create a git worktree on disk and register it in state. Returns null on failure. */
  private async createWorktreeOnDisk(opts?: CreateWorktreeOnDiskOptions): Promise<CreateWorktreeOnDiskResult | null> {
    return createWorktreeOnDisk(
      {
        getWorktreeManager: () => this.getWorktreeManager(),
        getStateManager: () => this.getStateManager(),
        postToWebview: (message) => this.postToWebview(message),
        capture: (event, properties) => this.host.capture(event, properties),
        pushState: () => this.pushState(),
        log: (...args) => this.log(...args),
      },
      opts,
    )
  }

  /** Create a CLI session in a worktree directory. Returns null on failure. */
  private async createSessionInWorktree(
    worktreePath: string,
    branch: string,
    worktreeId?: string,
    source?: { sandboxInheritanceToken?: string },
  ): Promise<Session | null> {
    let client: KiloClient
    try {
      client = this.connectionService.getClient()
    } catch (err) {
      this.log("createSessionInWorktree: client not available:", err)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Not connected to CLI backend",
        worktreeId,
      })
      this.host.capture("Agent Manager Session Error", {
        source: PLATFORM,
        error: "Not connected to CLI backend",
        context: "createSession",
      })
      return null
    }

    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "starting",
      message: "Starting session...",
      branch,
      worktreeId,
    })

    try {
      const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, client, worktreePath)
      const { data: session } = await startSession(
        client,
        worktreePath,
        () =>
          client.session.create(
            {
              directory: worktreePath,
              platform: PLATFORM,
              metadata,
              ...(source?.sandboxInheritanceToken ? { sandboxInheritanceToken: source.sandboxInheritanceToken } : {}),
            },
            { throwOnError: true },
          ),
        (...args) => this.log(...args),
      )
      return session
    } catch (error) {
      const err = getErrorMessage(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
        worktreeId,
      })
      this.host.capture("Agent Manager Session Error", {
        source: PLATFORM,
        error: err,
        context: "createSession",
      })
      return null
    }
  }

  /** Remove a worktree whose session could not be safely initialized. */
  private async discardWorktree(id: string, dir: string, branch: string, sessionId?: string): Promise<void> {
    this.getStateManager()?.removeWorktree(id)
    this.pushState()

    if (sessionId) {
      try {
        await this.connectionService
          .getClient()
          .session.delete({ sessionID: sessionId, directory: dir }, { throwOnError: true })
      } catch (err) {
        this.log(`Failed to delete session ${sessionId} after worktree setup failed:`, err)
      }
    }

    try {
      await this.getWorktreeManager()?.removeWorktree(dir, branch)
    } catch (err) {
      this.log(`Failed to remove worktree ${id} after setup failed:`, err)
    }
  }

  /** Send worktreeSetup.ready + sessionMeta + pushState after worktree creation. */
  private notifyWorktreeReady(sessionId: string, result: CreateWorktreeResult, worktreeId?: string): void {
    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Worktree ready",
      sessionId,
      branch: result.branch,
      worktreeId,
    })
    this.postToWebview({
      type: "agentManager.sessionMeta",
      sessionId,
      mode: "worktree",
      branch: result.branch,
      path: result.path,
      parentBranch: result.parentBranch,
    })
  }

  private async waitForStateReady(context: string): Promise<void> {
    if (!this.stateReady) return
    await this.stateReady.catch((err) => this.log(`${context}: stateReady rejected, continuing:`, err))
  }

  private shouldWaitForState(m: AgentManagerInMessage): boolean {
    switch (m.type) {
      case "agentManager.deleteWorktree":
      case "agentManager.removeStaleWorktree":
      case "agentManager.openLocally":
      case "agentManager.addSessionToWorktree":
      case "agentManager.closeSession":
      case "agentManager.persistSession":
      case "agentManager.forgetSession":
      case "agentManager.renameWorktree":
      case "agentManager.requestBranches":
      case "agentManager.importFromBranch":
      case "agentManager.importFromPR":
      case "agentManager.importExternalWorktree":
      case "agentManager.importAllExternalWorktrees":
      case "agentManager.setTabOrder":
      case "agentManager.setWorktreeOrder":
      case "agentManager.setSessionsCollapsed":
      case "agentManager.setSidebarCollapsed":
      case "agentManager.setReviewDiffStyle":
      case "agentManager.setDefaultBaseBranch":
      case "agentManager.createSection":
      case "agentManager.renameSection":
      case "agentManager.deleteSection":
      case "agentManager.setSectionColor":
      case "agentManager.toggleSectionCollapsed":
      case "agentManager.moveToSection":
      case "agentManager.moveSection":
        return true
      default:
        return false
    }
  }

  private onToolEvent(event: unknown, directory?: string): void {
    const properties = (event as { properties?: unknown }).properties
    const req = parseToolRequest(properties)
    if (!req) return
    if (directory) {
      req.directory = directory
    }
    void this.startToolRequest(req)
  }

  private async startToolRequest(req: ToolRequest): Promise<void> {
    await startFromTool(
      {
        getClient: () => this.connectionService.getClient(),
        getRoot: () => this.getRoot(),
        getState: () => this.getStateManager(),
        getPanel: () => this.panel,
        openPanel: (preserveFocus) => this.openPanel(preserveFocus),
        waitReady: (context) => this.waitForStateReady(context),
        createWorktree: (opts) => this.createWorktreeOnDisk(opts),
        claimRequest: (id) => {
          if (this.toolRequests.has(id)) return false
          const oldest = this.toolRequests.size >= 100 ? this.toolRequests.values().next().value : undefined
          if (oldest) this.toolRequests.delete(oldest)
          this.toolRequests.add(id)
          return true
        },
        cleanupWorktree: async (wid, dir) => {
          this.getStateManager()?.removeWorktree(wid)
          await this.getWorktreeManager()?.removeWorktree(dir)
          this.pushState()
        },
        setup: (dir, branch, id) => this.runSetupScriptForWorktree(dir, branch, id),
        createSessionInWorktree: (dir, branch, id, source) => this.createSessionInWorktree(dir, branch, id, source),
        sessionMetadata: (client, dir) => sandboxSessionMetadata(this.connectionService.sandboxPreference, client, dir),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        notifyReady: (sid, result, wid) => this.notifyWorktreeReady(sid, result, wid),
        push: () => this.pushState(),
        post: (msg) => this.postToWebview(msg as AgentManagerOutMessage),
        capture: (event, props) => this.host.capture(event, props),
        log: (...args) => this.log(...args),
        error: (msg) => this.host.showError(msg),
      },
      req,
    )
  }

  // Worktree actions

  /** Create a new worktree with an auto-created first session. */
  private async onCreateWorktree(baseBranch?: string, branchName?: string): Promise<null> {
    await this.waitForStateReady("onCreateWorktree")

    const created = await this.createWorktreeOnDisk({ baseBranch, branchName })
    if (!created) return null

    // Run setup script for new worktree (blocks until complete, shows in overlay)
    await this.runSetupScriptForWorktree(created.result.path, created.result.branch, created.worktree.id)

    const session = await this.createSessionInWorktree(created.result.path, created.result.branch, created.worktree.id)
    if (!session) {
      const state = this.getStateManager()
      const manager = this.getWorktreeManager()
      state?.removeWorktree(created.worktree.id)
      await manager?.removeWorktree(created.result.path)
      this.pushState()
      return null
    }

    const state = this.getStateManager()!
    state.addSession(session.id, created.worktree.id)
    if (!branchName && this.host.autoBranchNaming().enabled) state.armAutoName(created.worktree.id, session.id)
    this.registerWorktreeSession(session.id, created.result.path)
    // Push state before registerSession so the webview's sessionCreated handler
    // sees the worktree mapping and routes the session to the worktree tab.
    this.notifyWorktreeReady(session.id, created.result, created.worktree.id)
    this.panel?.sessions.registerSession(session)
    this.host.capture("Agent Manager Session Started", {
      source: PLATFORM,
      sessionId: session.id,
      worktreeId: created.worktree.id,
      branch: created.result.branch,
    })
    this.log(`Created worktree ${created.worktree.id} with session ${session.id}`)
    return null
  }

  /** Delete a worktree and dissociate its sessions. */
  private async onDeleteWorktree(worktreeId: string): Promise<null> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) return null
    const worktree = state.getWorktree(worktreeId)
    if (!worktree) {
      this.log(`Worktree ${worktreeId} not found in state`)
      return null
    }
    // Remove from state BEFORE disk removal so pollers immediately stop targeting this worktree.
    // Pre-emptive skip covers any in-flight poll that already captured getWorktrees().
    this.statsPoller.skipWorktree(worktreeId)
    this.prBridge.remove(worktreeId)
    this.run.remove(worktreeId)
    this.naming.forget(worktreeId)
    const orphaned = state.removeWorktree(worktreeId)
    if (this.diffs.shouldStopForWorktree(worktree.path, orphaned)) {
      this.diffs.stop()
    }
    for (const s of orphaned) this.panel?.sessions.clearSessionDirectory(s.id)
    this.pushState()
    // Disk removal after state is clean — pollers no longer reference this worktree.
    const branch = worktree.branchOwned === false ? undefined : (worktree.originalBranch ?? worktree.branch)
    try {
      await manager.removeWorktree(worktree.path, branch)
    } catch (error) {
      this.log(`Failed to remove worktree from disk: ${error}`)
    }
    this.log(`Deleted worktree ${worktreeId}${branch ? ` (${branch})` : ""}`)
    return null
  }

  /** Remove a stale worktree entry from state without touching the filesystem. */
  private async onRemoveStaleWorktree(worktreeId: string): Promise<null> {
    const state = this.getStateManager()
    if (!state) return null
    if (!this.staleWorktreeIds.has(worktreeId)) {
      this.log(`Ignored stale removal for non-stale worktree ${worktreeId}`)
      return null
    }

    const worktree = state.getWorktree(worktreeId)
    if (!worktree) {
      this.clearStaleTracking(worktreeId)
      this.pushState()
      return null
    }

    this.naming.forget(worktreeId)
    const orphaned = state.removeWorktree(worktreeId)
    if (this.diffs.shouldStopForWorktree(worktree.path, orphaned)) {
      this.diffs.stop()
    }
    for (const session of orphaned) {
      this.panel?.sessions.clearSessionDirectory(session.id)
    }
    this.clearStaleTracking(worktreeId)
    this.pushState()
    this.log(`Removed stale worktree entry ${worktreeId} (${worktree.branch})`)
    return null
  }

  /** Promote a session: create a worktree and move the session into it. */
  private async onPromoteSession(sessionId: string): Promise<null> {
    await this.waitForStateReady("onPromoteSession")
    const created = await this.createWorktreeOnDisk({})
    if (!created) return null

    // Run setup script for new worktree (blocks until complete, shows in overlay)
    await this.runSetupScriptForWorktree(created.result.path, created.result.branch, created.worktree.id)

    const state = this.getStateManager()!
    if (!state.getSession(sessionId)) {
      state.addSession(sessionId, created.worktree.id)
    } else {
      state.moveSession(sessionId, created.worktree.id)
    }

    this.registerWorktreeSession(sessionId, created.result.path)
    await this.recordPromotionHandoff(sessionId, created.result.path, created.result.branch)
    this.notifyWorktreeReady(sessionId, created.result, created.worktree.id)
    this.log(`Promoted session ${sessionId} to worktree ${created.worktree.id}`)
    return null
  }

  private async recordPromotionHandoff(sessionId: string, dir: string, branch: string): Promise<void> {
    try {
      await recordPromotionHandoff({
        client: this.connectionService.getClient(),
        sessionId,
        directory: dir,
        branch,
      })
    } catch (err) {
      this.log("Failed to record worktree promotion handoff:", getErrorMessage(err))
    }
  }

  /** Add a new session to an existing worktree. */
  private async onAddSessionToWorktree(worktreeId: string, sessionId?: string): Promise<null> {
    let client: KiloClient
    try {
      client = this.connectionService.getClient()
    } catch (err) {
      this.log("onAddSessionToWorktree: client not available:", err)
      this.postToWebview({ type: "error", message: "Not connected to CLI backend" })
      return null
    }

    const state = this.getStateManager()
    if (!state) return null

    const worktree = state.getWorktree(worktreeId)
    if (!worktree) {
      this.log(`Worktree ${worktreeId} not found`)
      return null
    }

    if (sessionId) {
      if (state.getSession(sessionId)) state.moveSession(sessionId, worktreeId)
      else state.addSession(sessionId, worktreeId)
      this.registerWorktreeSession(sessionId, worktree.path)
      this.pushState()
      this.postToWebview({
        type: "agentManager.sessionAdded",
        sessionId,
        worktreeId,
      })
      this.host.capture("Agent Manager Session Started", {
        source: PLATFORM,
        sessionId,
        worktreeId,
        existing: true,
      })
      this.log(`Added existing session ${sessionId} to worktree ${worktreeId}`)
      return null
    }

    let session: Session
    try {
      const metadata = await sandboxSessionMetadata(this.connectionService.sandboxPreference, client, worktree.path)
      const { data } = await client.session.create(
        { directory: worktree.path, platform: PLATFORM, metadata },
        { throwOnError: true },
      )
      session = data
    } catch (error) {
      const err = getErrorMessage(error)
      this.postToWebview({ type: "error", message: `Failed to create session: ${err}` })
      this.host.capture("Agent Manager Session Error", {
        source: PLATFORM,
        error: err,
        context: "addSessionToWorktree",
        worktreeId,
      })
      return null
    }

    state.addSession(session.id, worktreeId)
    this.registerWorktreeSession(session.id, worktree.path)
    this.pushState()
    this.postToWebview({
      type: "agentManager.sessionAdded",
      sessionId: session.id,
      worktreeId,
    })

    if (this.panel) {
      this.panel.sessions.registerSession(session)
    }

    this.host.capture("Agent Manager Session Started", {
      source: PLATFORM,
      sessionId: session.id,
      worktreeId,
    })
    this.log(`Added session ${session.id} to worktree ${worktreeId}`)
    return null
  }

  private onForkSession(sessionId: string, worktreeId?: string, messageId?: string) {
    return forkSession(
      {
        getClient: () => this.connectionService.getClient(),
        state: this.getStateManager(),
        directory: this.getRoot(),
        postError: (msg) => this.postToWebview({ type: "error", message: msg }),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        pushState: () => this.pushState(),
        notifyForked: (s, from, wt) =>
          this.postToWebview({
            type: "agentManager.sessionForked",
            sessionId: s.id,
            forkedFromId: from,
            worktreeId: wt,
          }),
        registerSession: (s) => this.panel?.sessions.registerSession(s),
        log: (...args) => this.log(...args),
      },
      sessionId,
      worktreeId,
      messageId,
    )
  }

  /** Stop a session and remove it from Agent Manager. */
  private async onCloseSession(sessionId: string): Promise<null> {
    const state = this.getStateManager()
    const dirs = this.panel?.sessions.getSessionDirectories()
    const dir = state?.directoryFor(sessionId) ?? dirs?.get(sessionId) ?? this.getRoot() ?? process.cwd()
    await this.panel?.sessions.abortSessions([sessionId])
    this.panelSessions.delete(sessionId)
    try {
      await stopSessionProcesses(this.connectionService.getClient(), sessionId, dir)
    } catch (err) {
      this.log("onCloseSession: client not available:", err)
    }

    state?.removeSession(sessionId)
    this.panel?.sessions.clearSessionDirectory(sessionId)
    if (state) this.pushState()
    this.postToWebview({ type: "agentManager.sessionClosed", sessionId })
    this.log(`Closed session ${sessionId}`)
    return null
  }

  // Multi-version worktree creation

  /** Create N worktree sessions for the same prompt (multi-version mode). */
  private async onCreateMultiVersion(
    msg: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>,
  ): Promise<null> {
    await this.waitForStateReady("onCreateMultiVersion")
    const text = msg.text?.trim() || undefined

    const worktreeName = msg.name?.trim() || undefined
    const agent = msg.agent
    const files = msg.files
    const baseBranch = msg.baseBranch
    const branchName = msg.branchName?.trim() || undefined

    const fallback = msg.providerID && msg.modelID ? { providerID: msg.providerID, modelID: msg.modelID } : undefined
    const resolved = resolveVersionModels(msg.modelAllocations, fallback, Number(msg.versions) || 1)
    const { models, versions, providerID, modelID } = resolved

    // Generate a shared group ID for multi-version worktrees
    const groupId = versions > 1 ? `grp-${Date.now()}` : undefined

    this.log(
      `Creating ${versions} worktrees${models.length > 0 ? " (model comparison)" : ""}${text ? ` for: ${text.slice(0, 60)}` : ""}${groupId ? ` (group=${groupId})` : ""}`,
    )

    // Notify webview that multi-version creation has started
    this.postToWebview({
      type: "agentManager.multiVersionProgress",
      status: "creating",
      total: versions,
      completed: 0,
      groupId,
    })

    // Phase 1: Create all worktrees + sessions first
    const created: CreatedVersion[] = []

    for (let i = 0; i < versions; i++) {
      this.log(`Creating worktree ${i + 1}/${versions}`)

      const version = versionedName(branchName || worktreeName, i, versions)
      const wt = await this.createWorktreeOnDisk({
        groupId,
        baseBranch,
        branchName: version.branch,
        name: version.branch,
        label: version.label,
      })
      if (!wt) {
        this.log(`Failed to create worktree for version ${i + 1}`)
        continue
      }

      await this.runSetupScriptForWorktree(wt.result.path, wt.result.branch, wt.worktree.id)

      const session = await this.createSessionInWorktree(wt.result.path, wt.result.branch, wt.worktree.id)
      if (!session) {
        const state = this.getStateManager()
        const manager = this.getWorktreeManager()
        state?.removeWorktree(wt.worktree.id)
        await manager?.removeWorktree(wt.result.path)
        this.log(`Failed to create session for version ${i + 1}`)
        continue
      }

      const state = this.getStateManager()!
      state.addSession(session.id, wt.worktree.id)
      if (!branchName && !worktreeName && this.host.autoBranchNaming().enabled) {
        state.armAutoName(wt.worktree.id, session.id)
      }

      // Sandbox must match the user's choice before this session is exposed or
      // receives its initial prompt. A failed reconciliation aborts this version.
      if (msg.sandbox !== undefined) {
        try {
          await ensureSandbox(this.connectionService.getClient(), session.id, wt.result.path, msg.sandbox)
        } catch (error) {
          const err = getErrorMessage(error)
          this.log(`Failed to configure sandbox for ${session.id}: ${err}`)
          this.postToWebview({
            type: "agentManager.worktreeSetup",
            status: "error",
            message: `Failed to configure sandbox: ${err}`,
            worktreeId: wt.worktree.id,
          })
          this.host.capture("Agent Manager Session Error", {
            source: PLATFORM,
            error: err,
            context: "configureSandbox",
          })
          await this.discardWorktree(wt.worktree.id, wt.result.path, wt.result.branch, session.id)
          continue
        }
      }

      this.registerWorktreeSession(session.id, wt.result.path)
      this.notifyWorktreeReady(session.id, wt.result, wt.worktree.id)

      // Set the per-version model immediately so the UI selector reflects
      // the correct model as soon as the worktree appears, before Phase 2.
      // Uses a dedicated message type to avoid clearing the busy state.
      const versionModel = models[i]
      const earlyProviderID = versionModel?.providerID ?? providerID
      const earlyModelID = versionModel?.modelID ?? modelID
      if (earlyProviderID && earlyModelID) {
        this.postToWebview({
          type: "agentManager.setSessionModel",
          sessionId: session.id,
          providerID: earlyProviderID,
          modelID: earlyModelID,
        })
      }

      created.push({
        worktreeId: wt.worktree.id,
        sessionId: session.id,
        path: wt.result.path,
        branch: wt.result.branch,
        parentBranch: wt.result.parentBranch,
        versionIndex: i,
      })

      this.host.capture("Agent Manager Session Started", {
        source: PLATFORM,
        sessionId: session.id,
        worktreeId: wt.worktree.id,
        branch: wt.result.branch,
        multiVersion: true,
        version: i + 1,
        totalVersions: versions,
        groupId,
      })
      this.log(`Version ${i + 1} worktree ready: session=${session.id}`)

      // Update progress
      this.postToWebview({
        type: "agentManager.multiVersionProgress",
        status: "creating",
        total: versions,
        completed: created.length,
        groupId,
      })
    }

    // Phase 2: Send the initial prompt to all sessions, or clear busy state if no text.
    const messages = buildInitialMessages(created, models, { providerID, modelID }, text, agent, msg.variant, files)
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!
      if (text) {
        this.log(`Sending initial message to version ${i + 1} (session=${msg.sessionId})`)
        this.naming.prompt({
          sessionID: msg.sessionId,
          text,
          providerID: msg.providerID,
          modelID: msg.modelID,
        })
      }
      this.postToWebview({ type: "agentManager.sendInitialMessage", ...msg })
      if (text && i < messages.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }

    // Notify completion
    this.postToWebview({
      type: "agentManager.multiVersionProgress",
      status: "done",
      total: versions,
      completed: created.length,
      groupId,
    })

    if (created.length === 0) {
      this.host.showError(`Failed to create any of the ${versions} multi-version worktrees.`)
    }

    this.log(`Multi-version creation complete: ${created.length}/${versions} versions`)
    return null
  }

  private sendKeybindings(): void {
    const keybindings = this.host.extensionKeybindings()
    const bindings = buildKeybindingMap(keybindings, process.platform === "darwin")
    this.postToWebview({ type: "agentManager.keybindings", bindings })
  }

  // Setup script

  /** Open the worktree setup script in the editor for user configuration. */
  private async configureSetupScript(): Promise<void> {
    const service = this.getSetupScriptService()
    if (!service) return
    try {
      if (!service.hasScript()) {
        await service.createDefaultScript()
      }
      const resolved = service.resolveScript()
      if (!resolved) return
      await this.host.openDocument(resolved.path)
    } catch (error) {
      this.log(`Failed to open setup script: ${error}`)
    }
  }

  /** Copy .env files and run the worktree setup script. Blocks until complete. Shows progress in overlay. */
  private async runSetupScriptForWorktree(worktreePath: string, branch?: string, worktreeId?: string): Promise<void> {
    const root = this.getRoot()
    if (!root) return

    // Always copy .env files from the main repo (before the setup script so it can override)
    await copyEnvFiles(root, worktreePath, (msg) => this.outputChannel.appendLine(`[EnvCopy] ${msg}`))

    try {
      const service = this.getSetupScriptService()
      if (!service || !service.hasScript()) return
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "creating",
        message: "Running setup script...",
        branch,
        worktreeId,
      })
      const runner = new SetupScriptRunner(
        (msg) => this.outputChannel.appendLine(`[SetupScriptRunner] ${msg}`),
        service,
        executeVscodeTask,
      )
      await runner.runIfConfigured({ worktreePath, repoPath: root })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.outputChannel.appendLine(`[AgentManager] Setup script error: ${msg}`)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Setup script failed: ${msg}`,
        branch,
        worktreeId,
      })
    }
  }

  // Repo info

  private async sendRepoInfo(): Promise<void> {
    const manager = this.getWorktreeManager()
    if (!manager) return
    try {
      const branch = await manager.currentBranch()
      const defaultBranch = await manager.defaultBranch()
      this.postToWebview({ type: "agentManager.repoInfo", branch, defaultBranch })
    } catch (error) {
      this.log(`Failed to get current branch: ${error}`)
    }
  }

  // State helpers

  private registerWorktreeSession(sessionId: string, directory: string): void {
    const worktree = this.state?.findWorktreeByPath(directory)
    if (worktree) this.writeMetadata(sessionId, worktree)

    if (!this.panel) return
    this.panel.sessions.setSessionDirectory(sessionId, directory)
    this.panel.sessions.trackSession(sessionId)
    // Recover any permission/question prompts that arrived before the session
    // was tracked. The CLI backend may have emitted permission.asked between
    // session.create() returning and this registration completing.
    this.panel.sessions.recoverPendingPrompts()
  }

  private writeMetadata(sessionId: string, worktree: Worktree): void {
    const manager = this.getWorktreeManager()
    if (!manager) return
    void manager
      .writeMetadata(worktree.path, sessionId, worktree.parentBranch, worktree.remote)
      .catch((err) => this.log(`Failed to write worktree metadata for ${worktree.id}:`, err))
  }

  /** Route a plan follow-up session to its worktree instead of LOCAL. */
  private adoptFollowupInWorktree(session: Session, directory: string): void {
    const state = this.getStateManager()
    if (!state) return
    const worktree = state.findWorktreeByPath(directory)
    if (!worktree) return

    state.addSession(session.id, worktree.id)
    this.registerWorktreeSession(session.id, directory)
    this.pushState()
    this.postToWebview({
      type: "agentManager.sessionAdded",
      sessionId: session.id,
      worktreeId: worktree.id,
    })
    this.log(`Adopted follow-up session ${session.id} into worktree ${worktree.id}`)
  }

  private onWorktreePresence(result: WorktreePresenceResult): void {
    const state = this.state
    if (!state) return

    const worktrees = state.getWorktrees()
    const ids = new Set(worktrees.map((wt) => wt.id))
    this.pruneStaleWorktreeIds(ids)

    if (result.degraded) {
      this.log("Skipping stale worktree update: degraded worktree probe")
      return
    }

    const entries = result.worktrees.filter((item) => ids.has(item.worktreeId))
    if (entries.length === 0) return

    // Sync branches from git worktree list (no extra git calls)
    let branchChanged = false
    for (const entry of entries) {
      if (entry.branch && state.updateWorktreeBranch(entry.worktreeId, entry.branch)) {
        branchChanged = true
      }
    }

    const next = new Set(entries.filter((entry) => entry.missing).map((entry) => entry.worktreeId))
    const staleChanged =
      next.size !== this.staleWorktreeIds.size || [...next].some((worktreeId) => !this.staleWorktreeIds.has(worktreeId))
    this.staleWorktreeIds = next

    if (staleChanged || branchChanged) {
      this.pushState()
    }
  }

  private clearStaleTracking(worktreeId: string): void {
    this.staleWorktreeIds.delete(worktreeId)
  }

  private staleWorktreesForState(worktrees: ReturnType<WorktreeStateManager["getWorktrees"]>): string[] {
    const ids = new Set(worktrees.map((wt) => wt.id))
    this.pruneStaleWorktreeIds(ids)
    return worktrees.filter((wt) => this.staleWorktreeIds.has(wt.id)).map((wt) => wt.id)
  }

  private pruneStaleWorktreeIds(ids: Set<string>): void {
    for (const id of [...this.staleWorktreeIds]) {
      if (ids.has(id)) continue
      this.staleWorktreeIds.delete(id)
    }
  }

  /** Sync the poller's skip set with currently collapsed sections. */
  private syncPollerSkips(): void {
    const state = this.state
    if (!state) return
    const skipped = new Set<string>()
    for (const sec of state.getSections()) {
      if (!sec.collapsed) continue
      for (const id of state.getWorktreesInSection(sec.id)) skipped.add(id)
    }
    const stats = this.statsPoller.syncSkips(skipped)
    if (!stats) return
    const msg = { type: "agentManager.worktreeStats" as const, stats }
    this.cachedWorktreeStats = msg
    this.postToWebview(msg)
  }

  private pushState(): void {
    const state = this.state
    if (!state) return
    const worktrees = state.getWorktrees()
    const staleWorktreeIds = this.staleWorktreesForState(worktrees)
    const run = this.run.state()
    this.postToWebview({
      type: "agentManager.state",
      worktrees,
      sessions: state.getSessions(),
      sections: state.getSections(),
      staleWorktreeIds,
      tabOrder: state.getTabOrder(),
      worktreeOrder: state.getWorktreeOrder(),
      sessionsCollapsed: state.getSessionsCollapsed(),
      sidebarCollapsed: state.getSidebarCollapsed(),
      reviewDiffStyle: state.getReviewDiffStyle(),
      reviewMarkdownRender: getDiffMarkdownRender(),
      isGitRepo: true,
      defaultBaseBranch: state.getDefaultBaseBranch(),
      ...run,
    })

    // Sync skip set before enabling the poller so the first poll cycle
    // already excludes worktrees in collapsed sections.
    this.syncPollerSkips()
    this.statsPoller.setEnabled(worktrees.length > 0 || this.panel !== undefined)
    this.prBridge.poller.setEnabled(worktrees.length > 0)
  }

  /** Push empty state when the folder is not a git repo or has no folder open. */
  private pushEmptyState(): void {
    this.staleWorktreeIds.clear()
    this.postToWebview({
      type: "agentManager.state",
      worktrees: [],
      sessions: [],
      staleWorktreeIds: [],
      reviewDiffStyle: "unified",
      reviewMarkdownRender: getDiffMarkdownRender(),
      isGitRepo: false,
      runStatuses: [],
      runScriptConfigured: false,
    })
  }

  // Manager accessors

  private getRoot(): string | undefined {
    return this.host.workspacePath()
  }

  private getWorktreeManager(): WorktreeManager | undefined {
    if (this.worktrees) return this.worktrees
    const root = this.getRoot()
    if (!root) {
      this.log("getWorktreeManager: no folder available")
      return undefined
    }
    this.worktrees = new WorktreeManager(
      root,
      (msg) => this.outputChannel.appendLine(`[WorktreeManager] ${msg}`),
      this.gitOps,
    )
    return this.worktrees
  }

  private getStateManager(): WorktreeStateManager | undefined {
    if (this.state) return this.state
    const root = this.getRoot()
    if (!root) {
      this.log("getStateManager: no folder available")
      return undefined
    }
    this.state = new WorktreeStateManager(root, (msg) => this.outputChannel.appendLine(`[StateManager] ${msg}`))
    return this.state
  }

  private getSetupScriptService(): SetupScriptService | undefined {
    if (this.setupScript) return this.setupScript
    const root = this.getRoot()
    if (!root) {
      this.log("getSetupScriptService: no folder available")
      return undefined
    }
    this.setupScript = new SetupScriptService(root)
    return this.setupScript
  }

  // Worktree file helpers

  /** Open a worktree directory directly in VS Code. */
  private openWorktreeDirectory(worktreeId: string): void {
    const state = this.getStateManager()
    if (!state) return
    const worktree = state.getWorktree(worktreeId)
    if (!worktree) return
    const target = path.normalize(worktree.path)
    if (!fs.existsSync(target)) {
      this.log(`openWorktreeDirectory: missing path ${target}`)
      this.host.showError("Worktree folder does not exist on disk.")
      return
    }
    this.host.openFolder(target, true)
  }

  /** Open a file from a worktree or local session in the VS Code editor.
   * Absolute paths (Unix `/…` or Windows `C:\…`) are opened directly.
   * Relative paths are resolved against the session's worktree directory
   * (or repo root for local sessions) with symlink-traversal protection. */
  private openWorktreeFile(sessionId: string, filePath: string, line?: number, column?: number): void {
    if (isAbsolutePath(filePath)) {
      this.host.openFile(filePath, line, column)
      return
    }
    const state = this.getStateManager()
    if (!state) return
    const session = state.getSession(sessionId)
    const base = session?.worktreeId ? state.getWorktree(session.worktreeId)?.path : this.getRoot()
    if (!base) return
    // Resolve real paths to prevent symlink traversal and normalize for
    // consistent comparison on both Unix and Windows.
    let resolved: string
    try {
      const root = fs.realpathSync(base)
      resolved = fs.realpathSync(path.resolve(base, filePath))
      // Directory-boundary check: append path.sep so "/foo/bar" won't match "/foo/bar2/..."
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return
    } catch (err) {
      console.error("[Kilo New] AgentManagerProvider: Cannot resolve file path:", err)
      return
    }
    this.host.openFile(resolved, line, column)
  }

  private postToWebview(message: AgentManagerOutMessage): void {
    this.panel?.postMessage(message)
  }

  /**
   * Reveal the Agent Manager panel and focus the prompt input.
   * Used for the keyboard shortcut to switch back from terminal.
   */
  public focusPanel(): void {
    if (!this.panel) return
    this.panel.reveal(false)
    this.postToWebview({ type: "action", action: "focusInput" })
  }

  public isActive(): boolean {
    return this.panel?.active === true
  }

  private async waitForPanel(panel: PanelContext, promise: Promise<void>): Promise<boolean> {
    const done = promise.then(() => true)
    let sub: Disposable | undefined
    const disposed = new Promise<false>((resolve) => {
      sub = panel.onDidDispose(() => {
        sub?.dispose()
        resolve(false)
      })
    })
    void done.finally(() => sub?.dispose())
    const ok = await Promise.race([done, disposed])
    return ok && this.panel === panel
  }

  private waitForPanelReady(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForReady())
  }

  private waitForPanelActive(panel: PanelContext): Promise<boolean> {
    return this.waitForPanel(panel, panel.waitForActive())
  }

  /** Wait for the current panel's webview to be ready before posting to it. False if there is no panel or it closed while waiting. */
  public waitForReady(): Promise<boolean> {
    const panel = this.panel
    if (!panel) return Promise.resolve(false)
    return this.waitForPanelReady(panel)
  }

  public async showMemory(): Promise<void> {
    const panel = this.panel
    const sid = this.activeSessionId
    if (!panel || !sid) {
      this.host.showError("No active Agent Manager session")
      return
    }
    if (!(await this.waitForPanelReady(panel))) return
    if (this.activeSessionId !== sid) return
    try {
      await panel.sessions.showMemory(sid)
    } catch (error) {
      this.host.showError(getErrorMessage(error) || "Failed to show memory")
    }
  }

  public async toggleMemory(): Promise<void> {
    const panel = this.panel
    const sid = this.activeSessionId
    if (!panel || !sid) {
      this.host.showError("No active Agent Manager session")
      return
    }
    if (!(await this.waitForPanelReady(panel))) return
    if (this.activeSessionId !== sid) return
    try {
      await panel.sessions.toggleMemory(sid)
    } catch (error) {
      this.host.showError(getErrorMessage(error) || "Failed to toggle memory")
    }
  }

  /** Expose worktree session→directory mappings for the auto-approve toggle. */
  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.panel?.sessions.getSessionDirectories() ?? new Map()
  }

  public getWorktreeDirectories(): string[] {
    return (
      this.getStateManager()
        ?.getWorktrees()
        .map((wt) => wt.path) ?? []
    )
  }

  /**
   * Continue a sidebar session in a new worktree.
   * Captures git state, creates worktree, applies state, forks session.
   * Called from KiloProvider when the sidebar sends "continueInWorktree".
   */
  public async continueFromSidebar(
    sessionId: string,
    progress: (status: string, detail?: string, error?: string) => void,
  ): Promise<void> {
    const root = this.getRoot()
    if (!root) {
      progress("error", undefined, "No workspace folder open")
      return
    }

    this.openPanel()
    await this.waitForStateReady("continueFromSidebar")

    await continueInWorktree(
      {
        root,
        getClient: () => this.connectionService.getClient(),
        createWorktreeOnDisk: (opts) => this.createWorktreeOnDisk(opts),
        runSetupScript: (p, b, id) => this.runSetupScriptForWorktree(p, b, id),
        cleanupWorktree: async (id) => {
          await this.onDeleteWorktree(id)
        },
        notifyError: (error, result, id) => {
          this.postToWebview({
            type: "agentManager.worktreeSetup",
            status: "error",
            message: error,
            branch: result.branch,
            worktreeId: id,
          })
        },
        getStateManager: () => this.getStateManager(),
        registerWorktreeSession: (sid, dir) => this.registerWorktreeSession(sid, dir),
        registerSession: (session) => this.panel?.sessions.registerSession(session),
        notifyReady: (sid, result, wid) => this.notifyWorktreeReady(sid, result, wid),
        capture: (event, props) => this.host.capture(event, props),
        log: (...args) => this.log(...args),
      },
      sessionId,
      progress,
    )
  }

  public async createFromSidebar(baseBranch?: string, branchName?: string): Promise<void> {
    this.openPanel()
    const panel = this.panel
    if (!panel) return
    if (!(await this.waitForPanelReady(panel))) return
    await this.waitForStateReady("createFromSidebar")
    await this.onCreateWorktree(baseBranch, branchName)
  }

  public async openAdvancedWorktree(): Promise<void> {
    this.openPanel()
    const panel = this.panel
    if (!panel) return
    if (!(await this.waitForPanelActive(panel))) return
    if (!(await this.waitForPanelReady(panel))) return
    await this.waitForStateReady("openAdvancedWorktree")
    queueMicrotask(() => this.postToWebview({ type: "action", action: "advancedWorktree" }))
  }

  private handleSection(m: AgentManagerInMessage): boolean {
    return handleSection(this.state, m, () => this.pushState())
  }

  public postMessage(message: unknown): void {
    this.panel?.postMessage(message)
  }

  public shutdown(): Promise<void> {
    if (!this.closing) this.closing = this.disposeAsync()
    return this.closing
  }

  public dispose(): void {
    void this.shutdown()
  }

  private async disposeAsync(): Promise<void> {
    await this.stateReady?.catch((err) => this.log("dispose: stateReady rejected:", err))
    await this.state?.flush().catch((err) => this.log("dispose: state flush failed:", err))
    this.unsubTool?.()
    this.unsubStatus?.()
    this.unsubFont?.()
    this.orchestration.dispose()
    this.visiblePresence.clear()
    this.diffs.stop()
    this.naming.dispose()
    this.statsPoller.stop()
    this.gitOps.dispose()
    this.prBridge.poller.stop()
    this.run.dispose()
    this.terminalManager.dispose()
    await this.terminalRouter.dispose()
    const panel = this.panel
    this.panel = undefined
    panel?.dispose()
    this.outputChannel.dispose()
    this.host.dispose()
  }
}
