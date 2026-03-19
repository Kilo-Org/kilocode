import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"
import { getErrorMessage } from "../kilo-provider-utils"
import { isAbsolutePath } from "../path-utils"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { WorktreeStateManager, remoteRef } from "./WorktreeStateManager"
import { chooseBaseBranch, normalizeBaseBranch } from "./base-branch"
import { GitStatsPoller, type WorktreePresenceResult } from "./GitStatsPoller"
import { GitOps, type ApplyConflict } from "./GitOps"
import { versionedName } from "./branch-name"
import { normalizePath, classifyWorktreeError } from "./git-import"
import { SetupScriptService } from "./SetupScriptService"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { SessionTerminalManager } from "./SessionTerminalManager"
import { createTerminalHost } from "./terminal-host"
import { executeVscodeTask } from "./task-runner"
import { forkSession } from "./fork-session"
import { buildKeybindingMap } from "./format-keybinding"
import { resolveVersionModels, buildInitialMessages, type CreatedVersion } from "./multi-version"
import { TelemetryProxy, TelemetryEventName } from "../services/telemetry"
import { PLATFORM } from "./constants"
import type { AgentManagerOutMessage, AgentManagerInMessage } from "./types"
import { getWorkspaceRoot, hashFileDiffs, openFileInEditor, resolveLocalDiffTarget } from "../review-utils"

/**
 * AgentManagerProvider opens the Agent Manager panel.
 *
 * Uses WorktreeStateManager for centralized state persistence. Worktrees and
 * sessions are stored in `.kilo/agent-manager.json`. The UI shows two
 * sections: WORKTREES (top) with managed worktrees + their sessions, and
 * SESSIONS (bottom) with unassociated local sessions.
 */
const LOCAL_DIFF_ID = "local" as const

export class AgentManagerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"

  private panel: vscode.WebviewPanel | undefined
  private provider: KiloProvider | undefined
  private outputChannel: vscode.OutputChannel
  private worktrees: WorktreeManager | undefined
  private state: WorktreeStateManager | undefined
  private setupScript: SetupScriptService | undefined
  private terminalManager: SessionTerminalManager
  private stateReady: Promise<void> | undefined
  private importing = false
  private diffInterval: ReturnType<typeof setInterval> | undefined
  private diffSessionId: string | undefined
  private lastDiffHash: string | undefined
  private statsPoller: GitStatsPoller
  private gitOps: GitOps
  private cachedDiffTarget: { sessionId: string; directory: string; baseBranch: string } | undefined
  private staleWorktreeIds = new Set<string>()
  private cachedWorktreeStats: AgentManagerOutMessage | undefined
  private cachedLocalStats: AgentManagerOutMessage | undefined
  private applyingWorktreeId: string | undefined
  /** Session ID most recently loaded via a `loadMessages` message from the webview.
   *  Updated synchronously — unlike KiloProvider.currentSession which depends on
   *  an async `session.get` round-trip and can be stale during rapid tab switches. */
  private activeSessionId: string | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
    this.terminalManager = new SessionTerminalManager(
      (msg) => this.outputChannel.appendLine(`[SessionTerminal] ${msg}`),
      createTerminalHost(),
    )
    this.gitOps = new GitOps({ log: (...args) => this.log(...args) })
    this.statsPoller = new GitStatsPoller({
      getWorktrees: () => this.state?.getWorktrees() ?? [],
      getWorkspaceRoot: () => this.getRoot(),
      getClient: () => this.connectionService.getClient(),
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
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  public openPanel(): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.log("Opening Agent Manager panel")
    TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_OPENED, { source: PLATFORM })

    const panel = vscode.window.createWebviewPanel(
      AgentManagerProvider.viewType,
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )

    this.attachPanel(panel)
  }

  /** Restore the Agent Manager panel from a previously serialized state (VS Code restart). */
  public deserializeWebviewPanel(panel: vscode.WebviewPanel): void {
    this.log("Deserializing Agent Manager panel")
    this.attachPanel(panel)
  }

  /** Wire up a webview panel (shared by openPanel and deserializeWebviewPanel). */
  private attachPanel(panel: vscode.WebviewPanel): void {
    this.panel = panel

    // Reapply options — required for deserialized panels where enableScripts
    // and localResourceRoots are not carried over from the original creation.
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    panel.webview.html = this.getHtml(panel.webview)

    this.provider = new KiloProvider(this.extensionUri, this.connectionService, this.context, {
      slimEditMetadata: true,
    })
    this.provider.attachToWebview(panel.webview, {
      onBeforeMessage: (msg) => this.onMessage(msg),
    })

    this.stateReady = this.initializeState()
    void this.sendRepoInfo()
    this.sendKeybindings()

    panel.onDidDispose(() => {
      this.log("Panel disposed")
      this.statsPoller.stop()
      this.stopDiffPolling()
      this.provider?.dispose()
      this.provider = undefined
      this.panel = undefined
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

    await state.load()

    // Do not auto-remove stale worktrees on load.
    // Presence checks run in the shared poller and require explicit user cleanup.

    // Register all worktree sessions with KiloProvider
    for (const worktree of state.getWorktrees()) {
      for (const session of state.getSessions(worktree.id)) {
        this.provider?.setSessionDirectory(session.id, worktree.path)
        this.provider?.trackSession(session.id)
      }
    }

    // Push full state to webview
    this.pushState()

    // Refresh sessions so worktree sessions appear in the list
    if (state.getSessions().length > 0) {
      this.provider?.refreshSessions()
    }
  }

  // ---------------------------------------------------------------------------
  // Message interceptor
  // ---------------------------------------------------------------------------

  private async onMessage(msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const m = msg as unknown as AgentManagerInMessage

    if (m.type === "agentManager.createWorktree") {
      return this.onCreateWorktree(m.baseBranch, m.branchName)
    }
    if (m.type === "agentManager.deleteWorktree") return this.onDeleteWorktree(m.worktreeId)
    if (m.type === "agentManager.removeStaleWorktree") return this.onRemoveStaleWorktree(m.worktreeId)
    if (m.type === "agentManager.promoteSession") return this.onPromoteSession(m.sessionId)
    if (m.type === "agentManager.addSessionToWorktree") return this.onAddSessionToWorktree(m.worktreeId)
    if (m.type === "agentManager.forkSession") return this.onForkSession(m.sessionId, m.worktreeId)
    if (m.type === "agentManager.closeSession") return this.onCloseSession(m.sessionId)
    if (m.type === "agentManager.configureSetupScript") {
      void this.configureSetupScript()
      return null
    }
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
    if (m.type === "previewImage") {
      return msg
    }
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
    if (m.type === "agentManager.requestState") {
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
          // Refresh sessions after pushState so the webview's sessionsLoaded
          // handler is guaranteed to be registered (requestState fires from
          // onMount). Without this, the initial refreshSessions() in
          // initializeState() can race ahead of webview mount, causing
          // sessionsLoaded to never flip to true.
          if (this.state.getSessions().length > 0) {
            this.provider?.refreshSessions()
          }
        })
        .catch((err) => {
          this.log("initializeState failed, pushing partial state:", err)
          if (!this.state) {
            this.pushEmptyState()
          } else {
            this.pushState()
          }
        })
      return null
    }
    if (m.type === "agentManager.requestBranches") {
      void this.onRequestBranches()
      return null
    }
    if (m.type === "agentManager.setTabOrder") {
      this.state?.setTabOrder(m.key, m.order)
      return null
    }
    if (m.type === "agentManager.setSessionsCollapsed") {
      this.state?.setSessionsCollapsed(m.collapsed)
      return null
    }
    if (m.type === "agentManager.setReviewDiffStyle") {
      this.state?.setReviewDiffStyle(m.style)
      return null
    }
    if (m.type === "agentManager.setDefaultBaseBranch") {
      const branch = normalizeBaseBranch(m.branch)
      this.state?.setDefaultBaseBranch(branch)
      this.pushState()
      return null
    }
    if (m.type === "agentManager.requestExternalWorktrees") {
      void this.onRequestExternalWorktrees()
      return null
    }
    if (m.type === "agentManager.importFromBranch") {
      void this.onImportFromBranch(m.branch)
      return null
    }
    if (m.type === "agentManager.importFromPR") {
      void this.onImportFromPR(m.url)
      return null
    }
    if (m.type === "agentManager.importExternalWorktree") {
      void this.onImportExternalWorktree(m.path, m.branch)
      return null
    }
    if (m.type === "agentManager.importAllExternalWorktrees") {
      void this.onImportAllExternalWorktrees()
      return null
    }
    if (m.type === "agentManager.requestWorktreeDiff") {
      void this.onRequestWorktreeDiff(m.sessionId)
      return null
    }
    if (m.type === "agentManager.requestWorktreeDiffFile") {
      void this.onRequestWorktreeDiffFile(m.sessionId, m.file)
      return null
    }
    if (m.type === "agentManager.applyWorktreeDiff") {
      const selectedFiles = Array.isArray(m.selectedFiles)
        ? [
            ...new Set(
              m.selectedFiles.filter((file): file is string => typeof file === "string").map((file) => file.trim()),
            ),
          ].filter((file) => file.length > 0)
        : undefined
      void this.onApplyWorktreeDiff(m.worktreeId, selectedFiles)
      return null
    }
    if (m.type === "agentManager.startDiffWatch") {
      this.startDiffPolling(m.sessionId)
      return null
    }
    if (m.type === "agentManager.stopDiffWatch") {
      this.stopDiffPolling()
      return null
    }
    if (m.type === "agentManager.openFile") {
      this.openWorktreeFile(m.sessionId, m.filePath, m.line, m.column)
      return null
    }

    // Intercept generic "openFile" from DataBridge (markdown links, tool subtitle clicks)
    // and route through worktree-aware resolution — but only for worktree sessions.
    // Local sessions fall through to KiloProvider which resolves against the repo root.
    // Uses activeSessionId (set synchronously by loadMessages) rather than
    // KiloProvider.currentSession which can be stale during rapid tab switches.
    if (m.type === "openFile") {
      const sessionId = this.activeSessionId
      const state = this.getStateManager()
      if (sessionId && state?.directoryFor(sessionId)) {
        this.openWorktreeFile(sessionId, m.filePath, m.line, m.column)
        return null
      }
    }

    // Track the active session synchronously so worktree-aware file resolution
    // uses the correct session even before KiloProvider's async session.get completes.
    if (m.type === "loadMessages") {
      this.activeSessionId = m.sessionID
      this.terminalManager.syncOnSessionSwitch(m.sessionID)
    }

    // After clearSession, clear active tracking and re-register worktree sessions
    if (m.type === "clearSession") {
      this.activeSessionId = undefined
      void Promise.resolve().then(() => {
        if (!this.provider || !this.state) return
        for (const id of this.state.worktreeSessionIds()) {
          this.provider.trackSession(id)
        }
      })
    }

    // Track when a user stops/cancels a running session in the agent manager
    if (m.type === "abort") {
      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_STOPPED, {
        source: PLATFORM,
        sessionId: m.sessionID,
      })
    }

    return msg
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
      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
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
      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
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
      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
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
    this.provider?.registerSession(session)
    this.notifyWorktreeReady(session.id, created.result, created.worktree.id)
    TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_STARTED, {
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

    try {
      await manager.removeWorktree(worktree.path)
    } catch (error) {
      this.log(`Failed to remove worktree from disk: ${error}`)
    }

    const orphaned = state.removeWorktree(worktreeId)
    for (const s of orphaned) {
      this.provider?.clearSessionDirectory(s.id)
    }
    this.pushState()
    this.log(`Deleted worktree ${worktreeId} (${worktree.branch})`)
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
    for (const session of orphaned) {
      this.provider?.clearSessionDirectory(session.id)
    }
    this.clearStaleTracking(worktreeId)

    if (this.cachedDiffTarget && normalizePath(this.cachedDiffTarget.directory) === normalizePath(worktree.path)) {
      this.stopDiffPolling()
    }

    if (this.diffSessionId && orphaned.some((session) => session.id === this.diffSessionId)) {
      this.stopDiffPolling()
    }

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
      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_ERROR, {
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

    if (this.provider) {
      this.provider.registerSession(session)
    }

    TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_STARTED, {
      source: PLATFORM,
      sessionId: session.id,
      worktreeId,
    })
    this.log(`Added session ${session.id} to worktree ${worktreeId}`)
    return null
  }

  private onForkSession(sessionId: string, worktreeId?: string) {
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
        registerSession: (s) => this.provider?.registerSession(s),
        log: (...args) => this.log(...args),
      },
      sessionId,
      worktreeId,
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

      await this.runSetupScriptForWorktree(wt.result.path, wt.result.branch)

      const session = await this.createSessionInWorktree(wt.result.path, wt.result.branch)
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
      this.notifyWorktreeReady(session.id, wt.result)

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

      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_STARTED, {
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
    const messages = buildInitialMessages(created, models, { providerID, modelID }, text, agent, files)
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
      vscode.window.showErrorMessage(`Failed to create any of the ${versions} multi-version worktrees.`)
    }

    this.log(`Multi-version creation complete: ${created.length}/${versions} versions`)
    return null
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  private async onRequestBranches(): Promise<void> {
    const manager = this.getWorktreeManager()
    if (!manager) {
      this.postToWebview({ type: "agentManager.branches", branches: [], defaultBranch: "main" })
      return
    }
    try {
      const result = await manager.listBranches()
      const checkedOut = await manager.checkedOutBranches()

      // Include isCheckedOut flag on each branch — let the webview decide how to filter
      const branches = result.branches.map((b) => ({
        ...b,
        isCheckedOut: checkedOut.has(b.name),
      }))

      // Validate configured default branch still exists
      const state = this.getStateManager()
      const configured = state?.getDefaultBaseBranch()
      if (configured && !branches.some((b) => b.name === configured)) {
        this.clearStaleDefaultBaseBranch(state!, configured)
      }

      this.postToWebview({
        type: "agentManager.branches",
        branches,
        defaultBranch: result.defaultBranch,
      })
    } catch (error) {
      this.log(`Failed to list branches: ${error}`)
      this.postToWebview({ type: "agentManager.branches", branches: [], defaultBranch: "main" })
    }
  }

  private async onRequestExternalWorktrees(): Promise<void> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.postToWebview({ type: "agentManager.externalWorktrees", worktrees: [] })
      return
    }
    try {
      const managedPaths = new Set(state.getWorktrees().map((wt) => wt.path))
      const worktrees = await manager.listExternalWorktrees(managedPaths)
      this.postToWebview({ type: "agentManager.externalWorktrees", worktrees })
    } catch (error) {
      this.log(`Failed to list external worktrees: ${error}`)
      this.postToWebview({ type: "agentManager.externalWorktrees", worktrees: [] })
    }
  }

  private async onImportFromBranch(branch: string): Promise<void> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.postToWebview({ type: "agentManager.importResult", success: false, message: "Not a git repository" })
      return
    }
    if (this.importing) {
      this.postToWebview({
        type: "agentManager.importResult",
        success: false,
        message: "Another import is already in progress",
      })
      return
    }
    this.importing = true

    try {
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "creating",
        message: "Creating worktree from branch...",
      })
      const result = await manager.createWorktree({ existingBranch: branch })
      const worktree = state.addWorktree({
        branch: result.branch,
        path: result.path,
        parentBranch: result.parentBranch,
        remote: result.remote,
      })
      this.pushState()

      try {
        this.postToWebview({
          type: "agentManager.worktreeSetup",
          status: "creating",
          message: "Running setup script...",
          branch: result.branch,
          worktreeId: worktree.id,
        })
        await this.runSetupScriptForWorktree(result.path, result.branch, worktree.id)

        const session = await this.createSessionInWorktree(result.path, result.branch, worktree.id)
        if (!session) throw new Error("Failed to create session")

        state.addSession(session.id, worktree.id)
        this.registerWorktreeSession(session.id, result.path)
        this.notifyWorktreeReady(session.id, result, worktree.id)
        this.postToWebview({ type: "agentManager.importResult", success: true, message: `Opened branch ${branch}` })
        this.log(`Imported branch ${branch} as worktree ${worktree.id}`)
      } catch (inner) {
        state.removeWorktree(worktree.id)
        await manager.removeWorktree(result.path)
        this.pushState()
        throw inner
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const msg =
        raw.includes("already used by worktree") || raw.includes("already checked out")
          ? `Branch "${branch}" is already checked out in another worktree`
          : raw
      const code = classifyWorktreeError(msg)
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: msg, errorCode: code })
      this.postToWebview({ type: "agentManager.importResult", success: false, message: msg, errorCode: code })
    } finally {
      this.importing = false
    }
  }

  private async onImportFromPR(url: string): Promise<void> {
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.postToWebview({ type: "agentManager.importResult", success: false, message: "Not a git repository" })
      return
    }

    if (this.importing) {
      this.postToWebview({
        type: "agentManager.importResult",
        success: false,
        message: "Another import is already in progress",
      })
      return
    }
    this.importing = true

    try {
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Resolving PR..." })
      const result = await manager.createFromPR(url)
      const worktree = state.addWorktree({
        branch: result.branch,
        path: result.path,
        parentBranch: result.parentBranch,
        remote: result.remote,
      })
      this.pushState()

      try {
        this.postToWebview({
          type: "agentManager.worktreeSetup",
          status: "creating",
          message: "Setting up worktree...",
          branch: result.branch,
          worktreeId: worktree.id,
        })
        await this.runSetupScriptForWorktree(result.path, result.branch, worktree.id)

        const session = await this.createSessionInWorktree(result.path, result.branch, worktree.id)
        if (!session) throw new Error("Failed to create session")

        state.addSession(session.id, worktree.id)
        this.registerWorktreeSession(session.id, result.path)
        this.notifyWorktreeReady(session.id, result, worktree.id)
        this.postToWebview({
          type: "agentManager.importResult",
          success: true,
          message: `Opened PR branch ${result.branch}`,
        })
        this.log(`Imported PR ${url} as worktree ${worktree.id}`)
      } catch (inner) {
        state.removeWorktree(worktree.id)
        await manager.removeWorktree(result.path)
        this.pushState()
        throw inner
      }
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const msg =
        raw.includes("already used by worktree") || raw.includes("already checked out")
          ? "This PR's branch is already checked out in another worktree"
          : raw
      const code = classifyWorktreeError(msg)
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: msg, errorCode: code })
      this.postToWebview({ type: "agentManager.importResult", success: false, message: msg, errorCode: code })
    } finally {
      this.importing = false
    }
  }

  private async onImportExternalWorktree(wtPath: string, branch: string): Promise<void> {
    const state = this.getStateManager()
    const manager = this.getWorktreeManager()
    if (!state || !manager) {
      this.postToWebview({ type: "agentManager.importResult", success: false, message: "State not initialized" })
      return
    }

    if (this.importing) {
      this.postToWebview({
        type: "agentManager.importResult",
        success: false,
        message: "Another import is already in progress",
      })
      return
    }
    this.importing = true

    let worktree: ReturnType<typeof state.addWorktree> | undefined
    try {
      const externals = await manager.listExternalWorktrees(new Set(state.getWorktrees().map((wt) => wt.path)))
      if (!externals.some((e) => normalizePath(e.path) === normalizePath(wtPath))) {
        this.postToWebview({
          type: "agentManager.importResult",
          success: false,
          message: "Path is not a valid worktree for this repository",
        })
        return
      }

      const base = await manager.resolveBaseBranch()
      worktree = state.addWorktree({ branch, path: wtPath, parentBranch: base.branch, remote: base.remote })
      this.pushState()

      const session = await this.createSessionInWorktree(wtPath, branch, worktree.id)
      if (!session) {
        state.removeWorktree(worktree.id)
        this.pushState()
        this.postToWebview({ type: "agentManager.importResult", success: false, message: "Failed to create session" })
        return
      }

      state.addSession(session.id, worktree.id)
      this.registerWorktreeSession(session.id, wtPath)
      this.pushState()
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "ready",
        message: "Worktree imported",
        sessionId: session.id,
        branch,
        worktreeId: worktree.id,
      })
      this.postToWebview({
        type: "agentManager.sessionMeta",
        sessionId: session.id,
        mode: "worktree",
        branch,
        path: wtPath,
        parentBranch: base.branch,
      })
      this.postToWebview({ type: "agentManager.importResult", success: true, message: `Imported ${branch}` })
      this.log(`Imported external worktree ${wtPath} (${branch})`)
    } catch (error) {
      if (worktree) {
        state.removeWorktree(worktree.id)
        this.pushState()
      }
      const msg = error instanceof Error ? error.message : String(error)
      this.postToWebview({ type: "agentManager.importResult", success: false, message: msg })
    } finally {
      this.importing = false
    }
  }

  private async onImportAllExternalWorktrees(): Promise<void> {
    if (this.importing) {
      this.postToWebview({
        type: "agentManager.importResult",
        success: false,
        message: "Another import is already in progress",
      })
      return
    }
    const manager = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!manager || !state) {
      this.postToWebview({ type: "agentManager.importResult", success: false, message: "Not a git repository" })
      return
    }
    this.importing = true

    try {
      const managedPaths = new Set(state.getWorktrees().map((wt) => wt.path))
      const externals = await manager.listExternalWorktrees(managedPaths)
      if (externals.length === 0) {
        this.postToWebview({
          type: "agentManager.importResult",
          success: true,
          message: "No external worktrees to import",
        })
        return
      }

      let imported = 0
      const base = await manager.resolveBaseBranch()
      for (const ext of externals) {
        try {
          const worktree = state.addWorktree({
            branch: ext.branch,
            path: ext.path,
            parentBranch: base.branch,
            remote: base.remote,
          })
          const session = await this.createSessionInWorktree(ext.path, ext.branch, worktree.id)
          if (session) {
            state.addSession(session.id, worktree.id)
            this.registerWorktreeSession(session.id, ext.path)
            imported++
          } else {
            state.removeWorktree(worktree.id)
          }
        } catch (error) {
          this.log(`Failed to import external worktree ${ext.path}: ${error}`)
        }
      }

      this.pushState()
      this.postToWebview({
        type: "agentManager.importResult",
        success: true,
        message: `Imported ${imported} worktree${imported !== 1 ? "s" : ""}`,
      })
      this.log(`Imported ${imported}/${externals.length} external worktrees`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.postToWebview({ type: "agentManager.importResult", success: false, message: msg })
    } finally {
      this.importing = false
    }
  }

  // ---------------------------------------------------------------------------
  // Keybindings
  // ---------------------------------------------------------------------------

  private sendKeybindings(): void {
    const ext = vscode.extensions.getExtension("kilocode.kilo-code")
    const keybindings: Array<{ command: string; key?: string; mac?: string }> =
      ext?.packageJSON?.contributes?.keybindings ?? []
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
      const document = await vscode.workspace.openTextDocument(resolved.path)
      await vscode.window.showTextDocument(document)
    } catch (error) {
      this.log(`Failed to open setup script: ${error}`)
    }
  }

  /** Run the worktree setup script if configured. Blocks until complete. Shows progress in overlay. */
  private async runSetupScriptForWorktree(worktreePath: string, branch?: string, worktreeId?: string): Promise<void> {
    const root = this.getRoot()
    if (!root) return
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
    if (!this.provider) return
    this.provider.setSessionDirectory(sessionId, directory)
    this.provider.trackSession(sessionId)
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

    const next = new Set(entries.filter((entry) => entry.missing).map((entry) => entry.worktreeId))
    const changed =
      next.size !== this.staleWorktreeIds.size || [...next].some((worktreeId) => !this.staleWorktreeIds.has(worktreeId))
    this.staleWorktreeIds = next

    if (changed) {
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

  private pushState(): void {
    const state = this.state
    if (!state) return
    const worktrees = state.getWorktrees()
    const staleWorktreeIds = this.staleWorktreesForState(worktrees)
    this.postToWebview({
      type: "agentManager.state",
      worktrees,
      sessions: state.getSessions(),
      staleWorktreeIds,
      tabOrder: state.getTabOrder(),
      sessionsCollapsed: state.getSessionsCollapsed(),
      reviewDiffStyle: state.getReviewDiffStyle(),
      isGitRepo: true,
      defaultBaseBranch: state.getDefaultBaseBranch(),
    })

    this.statsPoller.setEnabled(worktrees.length > 0 || this.panel !== undefined)
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
    })
  }

  // ---------------------------------------------------------------------------
  // Manager accessors
  // ---------------------------------------------------------------------------

  private getRoot(): string | undefined {
    return getWorkspaceRoot()
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
  // Helpers
  // ---------------------------------------------------------------------------

  private postApplyResult(
    worktreeId: string,
    status: "checking" | "applying" | "success" | "conflict" | "error",
    message: string,
    conflicts?: ApplyConflict[],
  ): void {
    this.postToWebview({
      type: "agentManager.applyWorktreeDiffResult",
      worktreeId,
      status,
      message,
      conflicts,
    })
  }

  private async onApplyWorktreeDiff(worktreeId: string, selectedFiles?: string[]): Promise<void> {
    if (this.applyingWorktreeId) {
      this.postApplyResult(worktreeId, "error", "Another apply operation is already in progress")
      return
    }

    if (selectedFiles && selectedFiles.length === 0) {
      this.postApplyResult(worktreeId, "error", "Select at least one file to apply")
      return
    }

    const state = this.getStateManager()
    const root = this.getRoot()
    if (!state || !root) {
      this.postApplyResult(worktreeId, "error", "Open a git repository to apply changes")
      return
    }

    const worktree = state.getWorktree(worktreeId)
    if (!worktree) {
      this.postApplyResult(worktreeId, "error", "Worktree not found")
      return
    }

    this.applyingWorktreeId = worktreeId

    try {
      this.postApplyResult(worktreeId, "checking", "Checking for conflicts...")
      const patch = await this.gitOps.buildWorktreePatch(worktree.path, remoteRef(worktree), selectedFiles)

      if (!patch.trim()) {
        this.postApplyResult(worktreeId, "success", "No changes to apply")
        return
      }

      const check = await this.gitOps.checkApplyPatch(root, patch)
      if (!check.ok) {
        this.postApplyResult(worktreeId, "conflict", check.message, check.conflicts)
        return
      }

      this.postApplyResult(worktreeId, "applying", "Applying changes to local branch...")
      const applied = await this.gitOps.applyPatch(root, patch)
      if (!applied.ok) {
        const conflict = applied.conflicts.length > 0
        const status = conflict ? "conflict" : "error"
        this.postApplyResult(worktreeId, status, applied.message, applied.conflicts)
        return
      }

      this.postApplyResult(worktreeId, "success", "Applied worktree changes to local branch")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log("Failed to apply worktree diff:", message)
      this.postApplyResult(worktreeId, "error", message)
    } finally {
      this.applyingWorktreeId = undefined
    }
  }

  // ---------------------------------------------------------------------------
  // Diff polling
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
      void vscode.window.showErrorMessage("Worktree folder does not exist on disk.")
      return
    }
    const uri = vscode.Uri.file(target)
    void vscode.commands.executeCommand("vscode.openFolder", uri, true)
  }

  /** Open a file from a worktree or local session in the VS Code editor.
   * Absolute paths (Unix `/…` or Windows `C:\…`) are opened directly.
   * Relative paths are resolved against the session's worktree directory
   * (or repo root for local sessions) with symlink-traversal protection. */
  private openWorktreeFile(sessionId: string, filePath: string, line?: number, column?: number): void {
    if (isAbsolutePath(filePath)) {
      const uri = vscode.Uri.file(filePath)
      openFileInEditor(uri.fsPath, line, column, vscode.ViewColumn.Active, "AgentManagerProvider")
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
    openFileInEditor(resolved, line, column, vscode.ViewColumn.Active, "AgentManagerProvider")
  }

  /** Resolve worktree path + parentBranch for a session, or undefined if not applicable. */
  private async resolveDiffTarget(sessionId: string): Promise<{ directory: string; baseBranch: string } | undefined> {
    if (sessionId === LOCAL_DIFF_ID) return await this.resolveLocalDiffTarget()
    const state = this.getStateManager()
    if (!state) {
      this.log(`resolveDiffTarget: no state manager for session ${sessionId}`)
      return undefined
    }
    const session = state.getSession(sessionId)
    if (!session) {
      this.log(
        `resolveDiffTarget: session ${sessionId} not found in state (${state.getSessions().length} total sessions)`,
      )
      return undefined
    }
    if (!session.worktreeId) {
      this.log(`resolveDiffTarget: session ${sessionId} has no worktreeId (local session)`)
      return undefined
    }
    const worktree = state.getWorktree(session.worktreeId)
    if (!worktree) {
      this.log(`resolveDiffTarget: worktree ${session.worktreeId} not found for session ${sessionId}`)
      return undefined
    }
    // Always construct remote-prefixed ref for diff (e.g. "origin/main")
    return { directory: worktree.path, baseBranch: remoteRef(worktree) }
  }

  /** Resolve diff target for the local repo — diffs against the remote tracking
   *  branch, falling back to the repo's default branch, and ultimately to HEAD so
   *  local-only repos (no remote) still show working-tree changes in the diff panel. */
  private async resolveLocalDiffTarget(): Promise<{ directory: string; baseBranch: string } | undefined> {
    return await resolveLocalDiffTarget(this.gitOps, (...args) => this.log(...args))
  }

  /** One-shot diff fetch with loading indicators. Resolves target async, then fetches. */
  private async onRequestWorktreeDiff(sessionId: string): Promise<void> {
    // Ensure state is loaded before resolving diff target — avoids race where
    // startDiffWatch arrives before initializeState() finishes loading state from disk.
    // The .catch() is required: this method is called via `void` (fire-and-forget),
    // so an uncaught rejection would become an unhandled promise rejection. On failure
    // we log and fall through to resolveDiffTarget which logs the specific reason.
    if (this.stateReady) {
      await this.stateReady.catch((err) => this.log("stateReady rejected, continuing diff resolve:", err))
    }

    const target = await this.resolveDiffTarget(sessionId)
    if (!target) return

    // Cache the resolved target so subsequent polls skip resolution entirely
    this.cachedDiffTarget = { sessionId, ...target }

    this.postToWebview({ type: "agentManager.worktreeDiffLoading", sessionId, loading: true })
    try {
      const client = this.connectionService.getClient()
      const { data: diffs } = await client.worktree.diffSummary(
        { directory: target.directory, base: target.baseBranch },
        { throwOnError: true },
      )

      const files = diffs ?? []
      this.log(`Worktree diff returned ${files.length} file(s) for session ${sessionId}`)

      const hash = hashFileDiffs(files)
      this.lastDiffHash = hash
      this.diffSessionId = sessionId

      this.postToWebview({ type: "agentManager.worktreeDiff", sessionId, diffs: files })
    } catch (err) {
      this.log("Failed to fetch worktree diff:", err)
    } finally {
      this.postToWebview({ type: "agentManager.worktreeDiffLoading", sessionId, loading: false })
    }
  }

  /** Polling diff fetch — uses cached target, no loading state, only pushes when hash changes. */
  private async pollDiff(sessionId: string): Promise<void> {
    const target = this.cachedDiffTarget?.sessionId === sessionId ? this.cachedDiffTarget : undefined
    if (!target) return

    try {
      const client = this.connectionService.getClient()
      const { data: diffs } = await client.worktree.diffSummary(
        { directory: target.directory, base: target.baseBranch },
        { throwOnError: true },
      )

      const files = diffs ?? []
      const hash = hashFileDiffs(files)
      if (hash === this.lastDiffHash && this.diffSessionId === sessionId) return
      this.lastDiffHash = hash
      this.diffSessionId = sessionId

      this.postToWebview({ type: "agentManager.worktreeDiff", sessionId, diffs: files })
    } catch (err) {
      this.log("Failed to poll worktree diff:", err)
    }
  }

  private async onRequestWorktreeDiffFile(sessionId: string, file: string): Promise<void> {
    if (!file) return

    if (this.stateReady) {
      await this.stateReady.catch((err) => this.log("stateReady rejected, continuing diff detail resolve:", err))
    }

    const target =
      this.cachedDiffTarget?.sessionId === sessionId ? this.cachedDiffTarget : await this.resolveDiffTarget(sessionId)
    if (!target) return

    this.cachedDiffTarget = { sessionId, directory: target.directory, baseBranch: target.baseBranch }

    try {
      const client = this.connectionService.getClient()
      const { data } = await client.worktree.diffFile(
        { directory: target.directory, base: target.baseBranch, file },
        { throwOnError: true },
      )
      this.postToWebview({ type: "agentManager.worktreeDiffFile", sessionId, file, diff: data ?? null })
    } catch (err) {
      this.log("Failed to fetch worktree diff file:", err)
      this.postToWebview({ type: "agentManager.worktreeDiffFile", sessionId, file, diff: null })
    }
  }

  private startDiffPolling(sessionId: string): void {
    // If already polling the same session, keep the existing interval and cache
    // to avoid an unnecessary stop→restart cycle that clears lastDiffHash and
    // cachedDiffTarget, creating a flash of empty diff data in the webview.
    if (this.diffSessionId === sessionId && this.diffInterval) {
      this.log(`Already polling session ${sessionId}, skipping restart`)
      return
    }
    this.stopDiffPolling()
    this.diffSessionId = sessionId
    this.lastDiffHash = undefined
    this.log(`Starting diff polling for session ${sessionId}`)

    // Initial fetch resolves + caches the diff target, then starts interval polling
    void this.onRequestWorktreeDiff(sessionId).then(() => {
      // Only start interval if still watching the same session (may have been stopped)
      if (this.diffSessionId !== sessionId) return
      this.diffInterval = setInterval(() => {
        void this.pollDiff(sessionId)
      }, 2500)
    })
  }

  private stopDiffPolling(): void {
    if (this.diffInterval) {
      clearInterval(this.diffInterval)
      this.diffInterval = undefined
    }
    this.diffSessionId = undefined
    this.lastDiffHash = undefined
    this.cachedDiffTarget = undefined
  }

  private postToWebview(message: AgentManagerOutMessage): void {
    if (this.panel?.webview) void this.panel.webview.postMessage(message)
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Agent Manager",
      port: this.connectionService.getServerInfo()?.port,
    })
  }

  /**
   * Show terminal for the currently active session (triggered by keyboard shortcut).
   * Posts an action to the webview which will respond with the session ID.
   */
  public showTerminalForCurrentSession(): void {
    this.postToWebview({ type: "action", action: "showTerminal" })
  }

  /**
   * Reveal the Agent Manager panel and focus the prompt input.
   * Used for the keyboard shortcut to switch back from terminal.
   */
  public focusPanel(): void {
    if (!this.panel) return
    this.panel.reveal(vscode.ViewColumn.One, false)
  }

  public isActive(): boolean {
    return this.panel?.active === true
  }

  public postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message)
  }

  public dispose(): void {
    this.stopDiffPolling()
    this.statsPoller.stop()
    this.terminalManager.dispose()
    this.provider?.dispose()
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
