import * as fs from "fs"
import * as path from "path"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { getErrorMessage } from "../kilo-provider-utils"
import { resolveLocalDiffTarget } from "../review-utils"
import { isAbsolutePath } from "../path-utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { remoteRef, WorktreeStateManager } from "./WorktreeStateManager"
import { handleSection } from "./section-handler"
import { chooseBaseBranch, normalizeBaseBranch } from "./base-branch"
import { GitStatsPoller, type LocalStats, type WorktreePresenceResult, type WorktreeStats } from "./GitStatsPoller"
import { PRStatusBridge } from "./pr-status-bridge"
import { GitOps } from "./GitOps"
import { versionedName } from "./branch-name"
import { classifyWorktreeError } from "./git-import"
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
import { continueInWorktree } from "./continue-in-worktree"
import { WorktreeDiffController } from "./worktree-diff-controller"
import { WorktreeImporter } from "./worktree-importer"
import { diffSummary as localDiffSummary, diffFile as localDiffFile } from "./local-diff"

import { buildKeybindingMap } from "./format-keybinding"
import { resolveVersionModels, buildInitialMessages, type CreatedVersion } from "./multi-version"
import { Semaphore } from "./semaphore"
import { PLATFORM } from "./constants"
import type { AgentManagerOutMessage, AgentManagerInMessage } from "./types"
import type { Host, PanelContext, OutputHandle, Disposable } from "./host"

/**
 * AgentManagerProvider opens the Agent Manager panel.
 *
 * Uses WorktreeStateManager for centralized state persistence. Worktrees and
 * sessions are stored in `.kilo/agent-manager.json`. The UI shows two
 * sections: WORKTREES (top) with managed worktrees + their sessions, and
 * SESSIONS (bottom) with unassociated local sessions.
 */
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
  private gitOps: GitOps
  private diffs: WorktreeDiffController
  private staleWorktreeIds = new Set<string>()
  private cachedWorktreeStats: { type: "agentManager.worktreeStats"; stats: WorktreeStats[] } | undefined
  private cachedLocalStats: { type: "agentManager.localStats"; stats: LocalStats } | undefined

  /** Session ID most recently loaded via a `loadMessages` message from the webview.
   *  Updated synchronously — unlike the session provider's currentSession which depends on
   *  an async `session.get` round-trip and can be stale during rapid tab switches. */
  private activeSessionId: string | undefined
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
    this.diffs = new WorktreeDiffController({
      getState: () => this.getStateManager(),
      getRoot: () => this.getRoot(),
      getStateReady: () => this.stateReady,
      getClient: () => this.connectionService.getClient(),
      git: this.gitOps,
      localDiff: (dir, base) => localDiffSummary(this.gitOps, dir, base, (...args) => this.log(...args)),
      localDiffFile: (dir, base, file) => localDiffFile(this.gitOps, dir, base, file, (...args) => this.log(...args)),
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
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  public openPanel(): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal()
      this.postToWebview({ type: "action", action: "focusInput" })
      return
    }
    this.log("Opening Agent Manager panel")
    this.host.capture("Agent Manager Opened", { source: PLATFORM })

    this.attachPanel(
      this.host.openPanel({
        onBeforeMessage: (msg) => this.onMessage(msg),
      }),
    )
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
      this.panel.dispose()
      this.panel = undefined
    }
    this.panel = ctx

    this.statsPoller.setVisible(ctx.visible)
    ctx.onDidChangeVisibility((visible) => {
      this.statsPoller.setVisible(visible)
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
        this.statsPoller.stop()
        this.prBridge.poller.stop()
        this.diffs.stop()
        this.panel = undefined
      }
      ctx.sessions.dispose()
    })
  }

  // ---------------------------------------------------------------------------
  // State initialization
  // ---------------------------------------------------------------------------

  private async initializeState(): Promise<void> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.pushEmptyState()
      return
    }

    const migration = await state.load()
    manager.cleanupOrphanedTempDirs()

    // When the .kilocode → .kilo migration rewrote git worktree refs, nudge
    // VS Code's git extension to re-discover them. Without this, worktrees
    // won't appear in Source Control until the next VS Code restart.
    if (migration.refsFixed > 0) {
      this.log(`Migration fixed ${migration.refsFixed} git worktree ref(s), refreshing git`)
      this.host.refreshGit()
    }

    for (const wt of state.getWorktrees()) {
      for (const s of state.getSessions(wt.id)) {
        this.panel?.sessions.setSessionDirectory(s.id, wt.path)
        this.panel?.sessions.trackSession(s.id)
      }
    }
    for (const s of state.getSessions()) if (!s.worktreeId) this.panel?.sessions.trackSession(s.id)
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

  // ---------------------------------------------------------------------------
  // Message interceptor
  // ---------------------------------------------------------------------------

  private async onMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    if (this.prBridge.handleMessage(msg)) return null
    if (msg.type === "requestFileSearch" && typeof msg.sessionID !== "string" && this.activeSessionId) {
      return { ...msg, sessionID: this.activeSessionId }
    }
    msg = await this.contextMessage(msg)
    const m = msg as unknown as AgentManagerInMessage

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
    if (m.type === "agentManager.addSessionToWorktree") return this.onAddSessionToWorktree(m.worktreeId)
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

    if ((m.type === "sendMessage" || m.type === "sendCommand") && m.draftID && !m.sessionID) {
      this.activeSessionId = m.draftID
      return msg
    }

    if (m.type === "requestTerminalContext") {
      if (m.sessionID) this.terminalManager.showExisting(m.sessionID)
      return msg
    }

    if (m.type === "loadMessages") {
      this.activeSessionId = m.sessionID
      this.connectionService.registerFocused("agent-manager", m.sessionID)
      this.terminalManager.syncOnSessionSwitch(m.sessionID)
      this.prBridge.poller.setActiveWorktreeId(this.state?.getSession(m.sessionID)?.worktreeId ?? undefined)
      return msg
    }

    if (m.type === "clearSession") {
      this.activeSessionId = undefined
      this.connectionService.unregisterFocused("agent-manager")
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
      this.connectionService.registerOpen("agent-manager", m.sessionIDs)
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
    if (this.handleSection(m)) return null
    if (m.type === "agentManager.setReviewDiffStyle") {
      this.state?.setReviewDiffStyle(m.style)
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

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** Resolve the effective base branch using the configured default, explicit override, and existence check. */
  private async resolveBaseBranch(
    manager: WorktreeManager,
    state: WorktreeStateManager,
    explicit?: string,
  ): Promise<string | undefined> {
    const configured = state.getDefaultBaseBranch()
    if (!configured && !explicit) return undefined

    const configuredExists = configured ? await manager.branchExists(configured) : false
    const result = chooseBaseBranch({ explicit, configured, configuredExists })

    if (result.stale) {
      this.clearStaleDefaultBaseBranch(state, result.stale)
    }
    return result.branch
  }

  /** Reset a stale default base branch and notify the webview. */
  private clearStaleDefaultBaseBranch(state: WorktreeStateManager, stale: string): void {
    this.log(`Default base branch "${stale}" no longer exists, clearing`)
    state.setDefaultBaseBranch(undefined)
    this.pushState()
  }

  /** Create a git worktree on disk and register it in state. Returns null on failure. */
  private async createWorktreeOnDisk(opts?: {
    groupId?: string
    baseBranch?: string
    branchName?: string
    existingBranch?: string
    name?: string
    label?: string
  }): Promise<{
    worktree: ReturnType<WorktreeStateManager["addWorktree"]>
    result: CreateWorktreeResult
  } | null> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Open a folder that contains a git repository to use worktrees",
        errorCode: "not_git_repo",
      })
      return null
    }

    this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

    // Resolve effective base branch using configured default
    const effectiveBase = opts?.existingBranch
      ? undefined
      : await this.resolveBaseBranch(manager, state, opts?.baseBranch)

    let result: CreateWorktreeResult
    try {
      result = await manager.createWorktree({
        prompt: opts?.name || "kilo",
        baseBranch: effectiveBase ?? opts?.baseBranch,
        branchName: opts?.branchName,
        existingBranch: opts?.existingBranch,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: msg,
        errorCode: classifyWorktreeError(msg),
      })
      this.host.capture("Agent Manager Session Error", {
        source: PLATFORM,
        error: msg,
        context: "createWorktree",
      })
      return null
    }

    const worktree = state.addWorktree({
      branch: result.branch,
      path: result.path,
      parentBranch: result.parentBranch,
      remote: result.remote,
      groupId: opts?.groupId,
      label: opts?.label,
    })

    // Push state immediately so the sidebar shows the new worktree with a loading indicator
    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "creating",
      message: "Setting up worktree...",
      branch: result.branch,
      worktreeId: worktree.id,
    })

    return { worktree, result }
  }

  /** Create a CLI session in a worktree directory. Returns null on failure. */
  private async createSessionInWorktree(
    worktreePath: string,
    branch: string,
    worktreeId?: string,
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
      const { data: session } = await client.session.create(
        { directory: worktreePath, platform: PLATFORM },
        { throwOnError: true },
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

  // ---------------------------------------------------------------------------
  // Worktree actions
  // ---------------------------------------------------------------------------

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
    const orphaned = state.removeWorktree(worktreeId)
    if (this.diffs.shouldStopForWorktree(worktree.path, orphaned)) {
      this.diffs.stop()
    }
    for (const s of orphaned) this.panel?.sessions.clearSessionDirectory(s.id)
    this.pushState()
    // Disk removal after state is clean — pollers no longer reference this worktree.
    try {
      await manager.removeWorktree(worktree.path, worktree.originalBranch ?? worktree.branch)
    } catch (error) {
      this.log(`Failed to remove worktree from disk: ${error}`)
    }
    this.log(`Deleted worktree ${worktreeId} (${worktree.originalBranch ?? worktree.branch})`)
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
    this.notifyWorktreeReady(sessionId, created.result, created.worktree.id)
    this.log(`Promoted session ${sessionId} to worktree ${created.worktree.id}`)
    return null
  }

  /** Add a new session to an existing worktree. */
  private async onAddSessionToWorktree(worktreeId: string): Promise<null> {
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

    let session: Session
    try {
      const { data } = await client.session.create(
        { directory: worktree.path, platform: PLATFORM },
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

  /** Close (remove) a session from its worktree. */
  private async onCloseSession(sessionId: string): Promise<null> {
    const state = this.getStateManager()
    if (!state) return null

    state.removeSession(sessionId)
    this.pushState()
    this.log(`Closed session ${sessionId}`)
    return null
  }

  // ---------------------------------------------------------------------------
  // Multi-version worktree creation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Keybindings
  // ---------------------------------------------------------------------------

  private sendKeybindings(): void {
    const keybindings = this.host.extensionKeybindings()
    const bindings = buildKeybindingMap(keybindings, process.platform === "darwin")
    this.postToWebview({ type: "agentManager.keybindings", bindings })
  }

  // ---------------------------------------------------------------------------
  // Setup script
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Repo info
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  private registerWorktreeSession(sessionId: string, directory: string): void {
    if (!this.panel) return
    this.panel.sessions.setSessionDirectory(sessionId, directory)
    this.panel.sessions.trackSession(sessionId)
    // Recover any permission/question prompts that arrived before the session
    // was tracked. The CLI backend may have emitted permission.asked between
    // session.create() returning and this registration completing.
    this.panel.sessions.recoverPendingPrompts()
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
      reviewDiffStyle: state.getReviewDiffStyle(),
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
      isGitRepo: false,
      runStatuses: [],
      runScriptConfigured: false,
    })
  }

  // ---------------------------------------------------------------------------
  // Manager accessors
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Worktree file helpers
  // ---------------------------------------------------------------------------

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

  /** Expose worktree session→directory mappings for the auto-approve toggle. */
  public getSessionDirectories(): ReadonlyMap<string, string> {
    return this.panel?.sessions.getSessionDirectories() ?? new Map()
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

  private handleSection(m: AgentManagerInMessage): boolean {
    return handleSection(this.state, m, () => this.pushState())
  }

  public postMessage(message: unknown): void {
    this.panel?.postMessage(message)
  }

  public dispose(): void {
    this.connectionService.unregisterFocused("agent-manager")
    this.connectionService.registerOpen("agent-manager", [])
    this.diffs.stop()
    this.statsPoller.stop()
    this.gitOps.dispose()
    this.prBridge.poller.stop()
    this.run.dispose()
    this.terminalManager.dispose()
    void this.terminalRouter.dispose()
    this.panel?.dispose()
    this.outputChannel.dispose()
    this.host.dispose()
  }
}
