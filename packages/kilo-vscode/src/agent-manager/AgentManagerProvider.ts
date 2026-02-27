import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import type { KiloConnectionService, SessionInfo, HttpClient } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { WorktreeStateManager } from "./WorktreeStateManager"
import { GitStatsPoller } from "./GitStatsPoller"
import { GitOps } from "./GitOps"
import { versionedName } from "./branch-name"
import { normalizePath } from "./git-import"
import { SetupScriptService } from "./SetupScriptService"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { SessionTerminalManager } from "./SessionTerminalManager"
import { formatKeybinding } from "./format-keybinding"
import { TelemetryProxy, TelemetryEventName } from "../services/telemetry"
import { MAX_MULTI_VERSIONS } from "./constants"

/**
 * AgentManagerProvider opens the Agent Manager panel.
 *
 * Uses WorktreeStateManager for centralized state persistence. Worktrees and
 * sessions are stored in `.kilocode/agent-manager.json`. The UI shows two
 * sections: WORKTREES (top) with managed worktrees + their sessions, and
 * SESSIONS (bottom) with unassociated workspace sessions.
 */
const PLATFORM = "agent-manager" as const
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
  private cachedDiffTarget: { directory: string; baseBranch: string } | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
    this.terminalManager = new SessionTerminalManager((msg) =>
      this.outputChannel.appendLine(`[SessionTerminal] ${msg}`),
    )
    this.gitOps = new GitOps({ log: (...args) => this.log(...args) })
    this.statsPoller = new GitStatsPoller({
      getWorktrees: () => this.state?.getWorktrees() ?? [],
      getWorkspaceRoot: () => this.getWorkspaceRoot(),
      getHttpClient: () => this.connectionService.getHttpClient(),
      onStats: (stats) => {
        this.postToWebview({ type: "agentManager.worktreeStats", stats })
      },
      onLocalStats: (stats) => {
        this.postToWebview({ type: "agentManager.localStats", stats })
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

    this.panel = vscode.window.createWebviewPanel(
      AgentManagerProvider.viewType,
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    this.panel.webview.html = this.getHtml(this.panel.webview)

    this.provider = new KiloProvider(this.extensionUri, this.connectionService)
    this.provider.attachToWebview(this.panel.webview, {
      onBeforeMessage: (msg) => this.onMessage(msg),
    })

    this.stateReady = this.initializeState()
    void this.sendRepoInfo()
    this.sendKeybindings()

    this.panel.onDidDispose(() => {
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

    // Validate worktree directories still exist (handles manual deletion)
    const root = this.getWorkspaceRoot()
    if (root) await state.validate(root)

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
    const type = msg.type as string

    if (type === "agentManager.createWorktree") {
      return this.onCreateWorktree(msg.baseBranch as string | undefined, msg.branchName as string | undefined)
    }
    if (type === "agentManager.deleteWorktree" && typeof msg.worktreeId === "string")
      return this.onDeleteWorktree(msg.worktreeId)
    if (type === "agentManager.promoteSession" && typeof msg.sessionId === "string")
      return this.onPromoteSession(msg.sessionId)
    if (type === "agentManager.addSessionToWorktree" && typeof msg.worktreeId === "string")
      return this.onAddSessionToWorktree(msg.worktreeId)
    if (type === "agentManager.closeSession" && typeof msg.sessionId === "string")
      return this.onCloseSession(msg.sessionId)
    if (type === "agentManager.configureSetupScript") {
      void this.configureSetupScript()
      return null
    }
    if (type === "agentManager.showTerminal" && typeof msg.sessionId === "string") {
      this.terminalManager.showTerminal(msg.sessionId, this.state)
      return null
    }
    if (type === "agentManager.showLocalTerminal") {
      this.terminalManager.showLocalTerminal()
      return null
    }
    if (type === "agentManager.showExistingLocalTerminal") {
      this.terminalManager.syncLocalOnSessionSwitch()
      return null
    }
    if (type === "agentManager.requestRepoInfo") {
      void this.sendRepoInfo()
      return null
    }
    if (type === "agentManager.createMultiVersion") {
      void this.onCreateMultiVersion(msg)
      return null
    }
    if (type === "agentManager.renameWorktree" && typeof msg.worktreeId === "string" && typeof msg.label === "string") {
      const state = this.getStateManager()
      if (state) {
        state.updateWorktreeLabel(msg.worktreeId, msg.label)
        this.pushState()
      }
      return null
    }
    if (type === "agentManager.requestState") {
      void this.stateReady
        ?.then(() => {
          // When the workspace is not a git repo (or has no folder open),
          // this.state is never created. pushState() silently returns in that
          // case, so re-send the empty/non-git state explicitly.
          if (!this.state) {
            this.pushEmptyState()
            return
          }
          this.pushState()
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
    if (type === "agentManager.requestBranches") {
      void this.onRequestBranches()
      return null
    }
    if (type === "agentManager.setTabOrder" && typeof msg.key === "string" && Array.isArray(msg.order)) {
      this.state?.setTabOrder(msg.key, msg.order as string[])
      return null
    }
    if (type === "agentManager.setSessionsCollapsed" && typeof msg.collapsed === "boolean") {
      this.state?.setSessionsCollapsed(msg.collapsed)
      return null
    }
    if (type === "agentManager.setReviewDiffStyle" && (msg.style === "unified" || msg.style === "split")) {
      this.state?.setReviewDiffStyle(msg.style)
      return null
    }

    if (type === "agentManager.requestExternalWorktrees") {
      void this.onRequestExternalWorktrees()
      return null
    }
    if (type === "agentManager.importFromBranch" && typeof msg.branch === "string") {
      void this.onImportFromBranch(msg.branch)
      return null
    }
    if (type === "agentManager.importFromPR" && typeof msg.url === "string") {
      void this.onImportFromPR(msg.url)
      return null
    }
    if (
      type === "agentManager.importExternalWorktree" &&
      typeof msg.path === "string" &&
      typeof msg.branch === "string"
    ) {
      void this.onImportExternalWorktree(msg.path, msg.branch)
      return null
    }
    if (type === "agentManager.importAllExternalWorktrees") {
      void this.onImportAllExternalWorktrees()
      return null
    }

    if (type === "agentManager.requestWorktreeDiff" && typeof msg.sessionId === "string") {
      void this.onRequestWorktreeDiff(msg.sessionId)
      return null
    }
    if (type === "agentManager.startDiffWatch" && typeof msg.sessionId === "string") {
      this.startDiffPolling(msg.sessionId)
      return null
    }
    if (type === "agentManager.stopDiffWatch") {
      this.stopDiffPolling()
      return null
    }

    if (type === "agentManager.openFile" && typeof msg.sessionId === "string" && typeof msg.filePath === "string") {
      this.openWorktreeFile(msg.sessionId, msg.filePath)
      return null
    }

    // When switching sessions, show existing terminal if one is open
    if (type === "loadMessages" && typeof msg.sessionID === "string") {
      this.terminalManager.syncOnSessionSwitch(msg.sessionID)
    }

    // After clearSession, re-register worktree sessions so SSE events keep flowing
    if (type === "clearSession") {
      void Promise.resolve().then(() => {
        if (!this.provider || !this.state) return
        for (const id of this.state.worktreeSessionIds()) {
          this.provider.trackSession(id)
        }
      })
    }

    // Track when a user stops/cancels a running session in the agent manager
    if (type === "abort" && typeof msg.sessionID === "string") {
      TelemetryProxy.capture(TelemetryEventName.AGENT_MANAGER_SESSION_STOPPED, {
        source: PLATFORM,
        sessionId: msg.sessionID,
      })
    }

    return msg
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

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
      })
      return null
    }

    this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

    let result: CreateWorktreeResult
    try {
      result = await manager.createWorktree({
        prompt: opts?.name || "kilo",
        baseBranch: opts?.baseBranch,
        branchName: opts?.branchName,
        existingBranch: opts?.existingBranch,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: msg,
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
      groupId: opts?.groupId,
      label: opts?.label,
    })

    // Push state immediately so the sidebar shows the new worktree with a loading indicator
    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "creating",
      message: "Setting up workspace...",
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
  ): Promise<SessionInfo | null> {
    let client: HttpClient
    try {
      client = this.connectionService.getHttpClient()
    } catch {
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
      return await client.createSession(worktreePath, { platform: PLATFORM })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
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

  // ---------------------------------------------------------------------------
  // Worktree actions
  // ---------------------------------------------------------------------------

  /** Create a new worktree with an auto-created first session. */
  private async onCreateWorktree(baseBranch?: string, branchName?: string): Promise<null> {
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

  /** Promote a session: create a worktree and move the session into it. */
  private async onPromoteSession(sessionId: string): Promise<null> {
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
    let client: HttpClient
    try {
      client = this.connectionService.getHttpClient()
    } catch {
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

    let session: SessionInfo
    try {
      session = await client.createSession(worktree.path, { platform: PLATFORM })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
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
  private async onCreateMultiVersion(msg: Record<string, unknown>): Promise<null> {
    const text = (msg.text as string | undefined)?.trim() || undefined

    const worktreeName = (msg.name as string | undefined)?.trim() || undefined
    const agent = msg.agent as string | undefined
    const files = msg.files as Array<{ mime: string; url: string }> | undefined
    const baseBranch = msg.baseBranch as string | undefined
    const branchName = (msg.branchName as string | undefined)?.trim() || undefined

    // Expand model allocations into per-version model assignments
    const rawAllocations = msg.modelAllocations as
      | Array<{ providerID: string; modelID: string; count: number }>
      | undefined
    const perVersionModels: Array<{ providerID: string; modelID: string } | undefined> = []
    if (rawAllocations && rawAllocations.length > 0) {
      for (const alloc of rawAllocations) {
        const clamped = Math.min(Math.max(Math.floor(alloc.count) || 0, 0), MAX_MULTI_VERSIONS)
        for (let c = 0; c < clamped; c++) {
          perVersionModels.push({ providerID: alloc.providerID, modelID: alloc.modelID })
        }
        if (perVersionModels.length >= MAX_MULTI_VERSIONS) break
      }
    }

    const versions =
      perVersionModels.length > 0
        ? Math.min(perVersionModels.length, MAX_MULTI_VERSIONS)
        : Math.min(Math.max(Number(msg.versions) || 1, 1), MAX_MULTI_VERSIONS)

    // Fall back to single model when not in compare mode
    const providerID = perVersionModels.length > 0 ? undefined : (msg.providerID as string | undefined)
    const modelID = perVersionModels.length > 0 ? undefined : (msg.modelID as string | undefined)

    // Generate a shared group ID for multi-version worktrees
    const groupId = versions > 1 ? `grp-${Date.now()}` : undefined

    this.log(
      `Creating ${versions} worktrees${perVersionModels.length > 0 ? " (model comparison)" : ""}${text ? ` for: ${text.slice(0, 60)}` : ""}${groupId ? ` (group=${groupId})` : ""}`,
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
    const created: Array<{
      worktreeId: string
      sessionId: string
      path: string
      branch: string
      parentBranch: string
      versionIndex: number
    }> = []

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
      const versionModel = perVersionModels[i]
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
    // Always include per-version model so the UI selector reflects the correct model.
    for (let i = 0; i < created.length; i++) {
      const entry = created[i]!
      // Use the original version index to match the correct model from perVersionModels,
      // since `created` may have gaps if earlier worktree creations failed.
      const versionModel = perVersionModels[entry.versionIndex]
      const versionProviderID = versionModel?.providerID ?? providerID
      const versionModelID = versionModel?.modelID ?? modelID
      if (text) {
        this.log(
          `Sending initial message to version ${i + 1} (session=${entry.sessionId}${versionModel ? `, model=${versionProviderID}/${versionModelID}` : ""})`,
        )
        this.postToWebview({
          type: "agentManager.sendInitialMessage",
          sessionId: entry.sessionId,
          worktreeId: entry.worktreeId,
          text,
          providerID: versionProviderID,
          modelID: versionModelID,
          agent,
          files,
        })
        if (i < created.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
      } else {
        // No prompt — still include model info so the UI selector is correct
        this.postToWebview({
          type: "agentManager.sendInitialMessage",
          sessionId: entry.sessionId,
          worktreeId: entry.worktreeId,
          providerID: versionProviderID,
          modelID: versionModelID,
        })
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
      const filtered = result.branches.filter((b) => !checkedOut.has(b.name))
      this.postToWebview({
        type: "agentManager.branches",
        branches: filtered,
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
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: msg })
      this.postToWebview({ type: "agentManager.importResult", success: false, message: msg })
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
      })
      this.pushState()

      try {
        this.postToWebview({
          type: "agentManager.worktreeSetup",
          status: "creating",
          message: "Setting up workspace...",
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
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: msg })
      this.postToWebview({ type: "agentManager.importResult", success: false, message: msg })
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

      const parent = await manager.defaultBranch()
      worktree = state.addWorktree({ branch, path: wtPath, parentBranch: parent })
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
        parentBranch: parent,
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
      const parent = await manager.defaultBranch()
      for (const ext of externals) {
        try {
          const worktree = state.addWorktree({ branch: ext.branch, path: ext.path, parentBranch: parent })
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
        message: `Imported ${imported} workspace${imported !== 1 ? "s" : ""}`,
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

    const mac = process.platform === "darwin"
    const prefix = "kilo-code.new.agentManager."
    const bindings: Record<string, string> = {}

    // Global keybindings exposed to the shortcuts dialog
    const globals: Record<string, string> = {
      "kilo-code.new.agentManagerOpen": "agentManagerOpen",
    }

    for (const kb of keybindings) {
      const raw = mac ? (kb.mac ?? kb.key) : kb.key
      if (!raw) continue

      if (kb.command.startsWith(prefix)) {
        bindings[kb.command.slice(prefix.length)] = formatKeybinding(raw, mac)
      } else if (globals[kb.command]) {
        bindings[globals[kb.command]] = formatKeybinding(raw, mac)
      }
    }

    // Ensure toggleDiff binding is always present (may be missing from
    // cached packageJSON if the extension hasn't been fully reloaded)
    if (!bindings.toggleDiff) {
      bindings.toggleDiff = formatKeybinding(mac ? "cmd+d" : "ctrl+d", mac)
    }

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
      await service.openInEditor()
    } catch (error) {
      this.log(`Failed to open setup script: ${error}`)
    }
  }

  /** Run the worktree setup script if configured. Blocks until complete. Shows progress in overlay. */
  private async runSetupScriptForWorktree(worktreePath: string, branch?: string, worktreeId?: string): Promise<void> {
    const root = this.getWorkspaceRoot()
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
      const runner = new SetupScriptRunner(this.outputChannel, service)
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
      this.postToWebview({ type: "agentManager.repoInfo", branch })
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

  private pushState(): void {
    const state = this.state
    if (!state) return
    this.postToWebview({
      type: "agentManager.state",
      worktrees: state.getWorktrees(),
      sessions: state.getSessions(),
      tabOrder: state.getTabOrder(),
      sessionsCollapsed: state.getSessionsCollapsed(),
      reviewDiffStyle: state.getReviewDiffStyle(),
      isGitRepo: true,
    })

    const worktrees = state.getWorktrees()
    this.statsPoller.setEnabled(worktrees.length > 0 || this.panel !== undefined)
  }

  /** Push empty state when the workspace is not a git repo or has no workspace folder. */
  private pushEmptyState(): void {
    this.postToWebview({
      type: "agentManager.state",
      worktrees: [],
      sessions: [],
      reviewDiffStyle: "unified",
      isGitRepo: false,
    })
  }

  // ---------------------------------------------------------------------------
  // Manager accessors
  // ---------------------------------------------------------------------------

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) return folders[0].uri.fsPath
    return undefined
  }

  private getWorktreeManager(): WorktreeManager | undefined {
    if (this.worktrees) return this.worktrees
    const root = this.getWorkspaceRoot()
    if (!root) {
      this.log("getWorktreeManager: no workspace folder available")
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
    const root = this.getWorkspaceRoot()
    if (!root) {
      this.log("getStateManager: no workspace folder available")
      return undefined
    }
    this.state = new WorktreeStateManager(root, (msg) => this.outputChannel.appendLine(`[StateManager] ${msg}`))
    return this.state
  }

  private getSetupScriptService(): SetupScriptService | undefined {
    if (this.setupScript) return this.setupScript
    const root = this.getWorkspaceRoot()
    if (!root) {
      this.log("getSetupScriptService: no workspace folder available")
      return undefined
    }
    this.setupScript = new SetupScriptService(root)
    return this.setupScript
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Diff polling
  // ---------------------------------------------------------------------------

  /** Open a file from a worktree session in the VS Code editor. */
  private openWorktreeFile(sessionId: string, relativePath: string): void {
    const state = this.getStateManager()
    if (!state) return
    const session = state.getSession(sessionId)
    if (!session?.worktreeId) return
    const worktree = state.getWorktree(session.worktreeId)
    if (!worktree) return
    // Resolve real paths to prevent symlink traversal and normalize for
    // consistent comparison on both Unix and Windows.
    let resolved: string
    try {
      const root = fs.realpathSync(worktree.path)
      resolved = fs.realpathSync(path.resolve(worktree.path, relativePath))
      // Directory-boundary check: append path.sep so "/foo/bar" won't match "/foo/bar2/..."
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return
    } catch (err) {
      console.error("[Kilo New] AgentManagerProvider: Cannot resolve file path:", err)
      return
    }
    const uri = vscode.Uri.file(resolved)
    vscode.workspace.openTextDocument(uri).then(
      (doc) => vscode.window.showTextDocument(doc, { preview: true }),
      (err) => console.error("[Kilo New] AgentManagerProvider: Failed to open file:", uri.fsPath, err),
    )
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
    return { directory: worktree.path, baseBranch: worktree.parentBranch }
  }

  /** Resolve diff target for the local workspace — diffs against the remote tracking branch. */
  private async resolveLocalDiffTarget(): Promise<{ directory: string; baseBranch: string } | undefined> {
    const root = this.getWorkspaceRoot()
    if (!root) return undefined
    const branch = await this.gitOps.currentBranch(root)
    if (!branch || branch === "HEAD") return undefined
    const tracking = await this.gitOps.resolveTrackingBranch(root, branch)
    if (!tracking) {
      this.log("Local diff: no remote tracking branch found")
      return undefined
    }
    return { directory: root, baseBranch: tracking }
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
    this.cachedDiffTarget = target

    this.postToWebview({ type: "agentManager.worktreeDiffLoading", sessionId, loading: true })
    try {
      const client = this.connectionService.getHttpClient()
      this.log(`Fetching worktree diff for session ${sessionId}: dir=${target.directory}, base=${target.baseBranch}`)
      const diffs = await client.getWorktreeDiff(target.directory, target.baseBranch)
      this.log(`Worktree diff returned ${diffs.length} file(s) for session ${sessionId}`)

      const hash = diffs.map((d) => `${d.file}:${d.status}:${d.additions}:${d.deletions}:${d.after.length}`).join("|")
      this.lastDiffHash = hash
      this.diffSessionId = sessionId

      this.postToWebview({ type: "agentManager.worktreeDiff", sessionId, diffs })
    } catch (err) {
      this.log("Failed to fetch worktree diff:", err)
    } finally {
      this.postToWebview({ type: "agentManager.worktreeDiffLoading", sessionId, loading: false })
    }
  }

  /** Polling diff fetch — uses cached target, no loading state, only pushes when hash changes. */
  private async pollDiff(sessionId: string): Promise<void> {
    const target = this.cachedDiffTarget
    if (!target) return

    try {
      const client = this.connectionService.getHttpClient()
      const diffs = await client.getWorktreeDiff(target.directory, target.baseBranch)

      const hash = diffs.map((d) => `${d.file}:${d.status}:${d.additions}:${d.deletions}:${d.after.length}`).join("|")
      if (hash === this.lastDiffHash && this.diffSessionId === sessionId) return
      this.lastDiffHash = hash
      this.diffSessionId = sessionId

      this.postToWebview({ type: "agentManager.worktreeDiff", sessionId, diffs })
    } catch (err) {
      this.log("Failed to poll worktree diff:", err)
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

  private postToWebview(message: Record<string, unknown>): void {
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
