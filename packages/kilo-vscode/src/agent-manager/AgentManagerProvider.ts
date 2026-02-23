import * as vscode from "vscode"
import type { KiloConnectionService, SessionInfo, HttpClient } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { WorktreeStateManager } from "./WorktreeStateManager"
import { versionedName } from "./branch-name"
import { SetupScriptService } from "./SetupScriptService"
import { SetupScriptRunner } from "./SetupScriptRunner"
import { SessionTerminalManager } from "./SessionTerminalManager"
import { formatKeybinding } from "./format-keybinding"

/**
 * AgentManagerProvider opens the Agent Manager panel.
 *
 * Uses WorktreeStateManager for centralized state persistence. Worktrees and
 * sessions are stored in `.kilocode/agent-manager.json`. The UI shows two
 * sections: WORKTREES (top) with managed worktrees + their sessions, and
 * SESSIONS (bottom) with unassociated workspace sessions.
 */
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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
    this.terminalManager = new SessionTerminalManager((msg) =>
      this.outputChannel.appendLine(`[SessionTerminal] ${msg}`),
    )
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

    if (type === "agentManager.createWorktree") return this.onCreateWorktree()
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
        state.updateWorktreeLabel(msg.worktreeId as string, msg.label as string)
        this.pushState()
      }
      return null
    }
    if (type === "agentManager.requestState") {
      void this.stateReady
        ?.then(() => {
          this.pushState()
          // Refresh sessions after pushState so the webview's sessionsLoaded
          // handler is guaranteed to be registered (requestState fires from
          // onMount). Without this, the initial refreshSessions() in
          // initializeState() can race ahead of webview mount, causing
          // sessionsLoaded to never flip to true.
          if (this.state && this.state.getSessions().length > 0) {
            this.provider?.refreshSessions()
          }
        })
        .catch((err) => {
          this.log("initializeState failed, pushing partial state:", err)
          this.pushState()
        })
      return null
    }
    if (type === "agentManager.setTabOrder" && typeof msg.key === "string" && Array.isArray(msg.order)) {
      this.state?.setTabOrder(msg.key as string, msg.order as string[])
      return null
    }
    if (type === "agentManager.setSessionsCollapsed" && typeof msg.collapsed === "boolean") {
      this.state?.setSessionsCollapsed(msg.collapsed as boolean)
      return null
    }

    // When switching sessions, show existing terminal if one is open
    if (type === "loadMessages" && typeof msg.sessionID === "string") {
      this.terminalManager.showExisting(msg.sessionID)
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

    return msg
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** Create a git worktree on disk and register it in state. Returns null on failure. */
  private async createWorktreeOnDisk(
    groupId?: string,
    name?: string,
    label?: string,
  ): Promise<{
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
      result = await manager.createWorktree({ prompt: name || "kilo" })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: msg,
      })
      return null
    }

    const worktree = state.addWorktree({
      branch: result.branch,
      path: result.path,
      parentBranch: result.parentBranch,
      groupId,
      label,
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
      return await client.createSession(worktreePath)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
        worktreeId,
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
  private async onCreateWorktree(): Promise<null> {
    const created = await this.createWorktreeOnDisk()
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
    const created = await this.createWorktreeOnDisk()
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
      session = await client.createSession(worktree.path)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({ type: "error", message: `Failed to create session: ${err}` })
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
    const text = msg.text as string
    if (!text) return null

    const versions = Math.min(Math.max(Number(msg.versions) || 1, 1), 4)
    const worktreeName = (msg.name as string | undefined)?.trim() || undefined
    const providerID = msg.providerID as string | undefined
    const modelID = msg.modelID as string | undefined
    const agent = msg.agent as string | undefined
    const files = msg.files as Array<{ mime: string; url: string }> | undefined

    // Generate a shared group ID for multi-version worktrees
    const groupId = versions > 1 ? `grp-${Date.now()}` : undefined

    this.log(
      `Creating ${versions} multi-version worktrees for: ${text.slice(0, 60)}${groupId ? ` (group=${groupId})` : ""}`,
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
    }> = []

    for (let i = 0; i < versions; i++) {
      this.log(`Creating worktree ${i + 1}/${versions}`)

      const version = versionedName(worktreeName, i, versions)
      const wt = await this.createWorktreeOnDisk(groupId, version.branch, version.label)
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

      created.push({
        worktreeId: wt.worktree.id,
        sessionId: session.id,
        path: wt.result.path,
        branch: wt.result.branch,
        parentBranch: wt.result.parentBranch,
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

    // Phase 2: Send the initial prompt to all sessions via the KiloProvider's
    // message handling (same path as typing in the chat). This ensures SSE
    // subscriptions and session tracking are properly set up before the message
    // is sent. We route each message through the webview→KiloProvider pipeline.
    for (let i = 0; i < created.length; i++) {
      const entry = created[i]!
      this.log(`Sending initial message to version ${i + 1} (session=${entry.sessionId})`)

      // Tell the webview to send the message through the normal session flow
      this.postToWebview({
        type: "agentManager.sendInitialMessage",
        sessionId: entry.sessionId,
        worktreeId: entry.worktreeId,
        text,
        providerID,
        modelID,
        agent,
        files,
      })

      // Small delay between sends to avoid overwhelming the backend
      if (i < created.length - 1) {
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
      isGitRepo: true,
    })
  }

  /** Push empty state when the workspace is not a git repo or has no workspace folder. */
  private pushEmptyState(): void {
    this.postToWebview({
      type: "agentManager.state",
      worktrees: [],
      sessions: [],
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
    this.worktrees = new WorktreeManager(root, (msg) => this.outputChannel.appendLine(`[WorktreeManager] ${msg}`))
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
    this.terminalManager.dispose()
    this.provider?.dispose()
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
