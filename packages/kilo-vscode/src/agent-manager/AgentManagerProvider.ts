import * as vscode from "vscode"
import type { KiloConnectionService, SessionInfo, HttpClient } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"
import { WorktreeManager, type CreateWorktreeResult } from "./WorktreeManager"
import { WorktreeStateManager } from "./WorktreeStateManager"

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

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
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

    void this.initializeState()

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
    const mgr = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!mgr || !state) return

    await state.load()

    // Validate worktree directories still exist (handles manual deletion)
    const root = this.getWorkspaceRoot()
    if (root) await state.validate(root)

    // Migrate from legacy per-worktree metadata if no state file existed
    if (state.getWorktrees().length === 0) {
      try {
        const discovered = await mgr.discoverWorktrees()
        const legacy = discovered.filter((wt) => wt.sessionId)
        if (legacy.length > 0) {
          await state.migrateFromLegacy(legacy)
        }
      } catch (error) {
        this.log(`Failed legacy migration: ${error}`)
      }
    }

    // Register all worktree sessions with KiloProvider
    for (const wt of state.getWorktrees()) {
      for (const session of state.getSessions(wt.id)) {
        this.provider?.setSessionDirectory(session.id, wt.path)
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

    // Custom agent-manager messages -- consumed here, never reach KiloProvider
    if (type === "agentManager.createWorktreeSession") return this.onCreateWorktreeSession(msg)
    if (type === "agentManager.createWorktree") return this.onCreateWorktree()
    if (type === "agentManager.deleteWorktree") return this.onDeleteWorktree(msg.worktreeId as string)
    if (type === "agentManager.promoteSession") return this.onPromoteSession(msg.sessionId as string)
    if (type === "agentManager.addSessionToWorktree") return this.onAddSessionToWorktree(msg.worktreeId as string)
    if (type === "agentManager.closeSession") return this.onCloseSession(msg.sessionId as string)

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
  // Worktree actions
  // ---------------------------------------------------------------------------

  /**
   * Create a new worktree with an auto-created first session.
   */
  private async onCreateWorktree(): Promise<null> {
    let client: HttpClient
    try {
      client = this.connectionService.getHttpClient()
    } catch {
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Not connected to CLI backend",
      })
      return null
    }

    const mgr = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!mgr || !state) {
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: "No workspace folder open" })
      return null
    }

    // Step 1: Create git worktree
    this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

    let result: CreateWorktreeResult
    try {
      result = await mgr.createWorktree({ prompt: "kilo" })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create worktree: ${err}`,
      })
      return null
    }

    // Step 2: Register in state
    const wt = state.addWorktree({ branch: result.branch, path: result.path, parentBranch: result.parentBranch })

    // Step 3: Create session in worktree
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "starting",
      message: "Starting session...",
      branch: result.branch,
    })

    let session: SessionInfo
    try {
      session = await client.createSession(result.path)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      state.removeWorktree(wt.id)
      await mgr.removeWorktree(result.path)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
      })
      return null
    }

    // Step 4: Register session
    state.addSession(session.id, wt.id)
    this.registerWorktreeSession(session.id, result.path)

    // Write legacy metadata for backward compat
    mgr
      .writeMetadata(result.path, session.id, result.parentBranch)
      .catch((err) => this.log(`Failed to persist worktree metadata: ${err}`))

    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Worktree ready",
      sessionId: session.id,
      branch: result.branch,
    })

    // Notify webview about session meta (for badges)
    this.postToWebview({
      type: "agentManager.sessionMeta",
      sessionId: session.id,
      mode: "worktree",
      branch: result.branch,
      path: result.path,
      parentBranch: result.parentBranch,
    })

    this.log(`Created worktree ${wt.id} with session ${session.id}`)
    return null
  }

  /**
   * Delete a worktree and dissociate its sessions.
   */
  private async onDeleteWorktree(worktreeId: string): Promise<null> {
    const mgr = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!mgr || !state) return null

    const wt = state.getWorktree(worktreeId)
    if (!wt) {
      this.log(`Worktree ${worktreeId} not found in state`)
      return null
    }

    // Remove the git worktree from disk
    try {
      await mgr.removeWorktree(wt.path)
    } catch (error) {
      this.log(`Failed to remove worktree from disk: ${error}`)
    }

    // Dissociate sessions (they become local/unassociated)
    state.removeWorktree(worktreeId)
    this.pushState()

    this.log(`Deleted worktree ${worktreeId} (${wt.branch})`)
    return null
  }

  /**
   * Promote a session: create a worktree and move the session into it.
   */
  private async onPromoteSession(sessionId: string): Promise<null> {
    const mgr = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!mgr || !state) {
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: "No workspace folder open" })
      return null
    }

    this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

    let result: CreateWorktreeResult
    try {
      result = await mgr.createWorktree({ prompt: "kilo" })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create worktree: ${err}`,
      })
      return null
    }

    const wt = state.addWorktree({ branch: result.branch, path: result.path, parentBranch: result.parentBranch })

    // Register session if not already tracked
    if (!state.getSession(sessionId)) {
      state.addSession(sessionId, wt.id)
    } else {
      state.moveSession(sessionId, wt.id)
    }

    this.registerWorktreeSession(sessionId, result.path)

    // Write legacy metadata
    mgr
      .writeMetadata(result.path, sessionId, result.parentBranch)
      .catch((err) => this.log(`Failed to persist worktree metadata: ${err}`))

    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Session promoted",
      sessionId,
      branch: result.branch,
    })

    this.postToWebview({
      type: "agentManager.sessionMeta",
      sessionId,
      mode: "worktree",
      branch: result.branch,
      path: result.path,
      parentBranch: result.parentBranch,
    })

    this.log(`Promoted session ${sessionId} to worktree ${wt.id}`)
    return null
  }

  /**
   * Add a new session to an existing worktree.
   */
  private async onAddSessionToWorktree(worktreeId: string): Promise<null> {
    let client: HttpClient
    try {
      client = this.connectionService.getHttpClient()
    } catch {
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Not connected to CLI backend",
      })
      return null
    }

    const state = this.getStateManager()
    if (!state) return null

    const wt = state.getWorktree(worktreeId)
    if (!wt) {
      this.log(`Worktree ${worktreeId} not found`)
      return null
    }

    let session: SessionInfo
    try {
      session = await client.createSession(wt.path)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({ type: "error", message: `Failed to create session: ${err}` })
      return null
    }

    state.addSession(session.id, worktreeId)
    this.registerWorktreeSession(session.id, wt.path)
    this.pushState()

    if (this.provider) {
      this.provider.registerSession(session)
    }

    this.log(`Added session ${session.id} to worktree ${worktreeId}`)
    return null
  }

  /**
   * Close (remove) a session from its worktree. The session is dissociated but not deleted.
   */
  private async onCloseSession(sessionId: string): Promise<null> {
    const state = this.getStateManager()
    if (!state) return null

    state.removeSession(sessionId)
    this.pushState()
    this.log(`Closed session ${sessionId}`)
    return null
  }

  /**
   * Handle the full worktree session lifecycle for the first message.
   * Creates worktree + session, registers with KiloProvider, sends the first
   * message via httpClient directly.
   */
  private async onCreateWorktreeSession(msg: Record<string, unknown>): Promise<null> {
    const text = (msg.text as string) || ""
    let client: HttpClient

    try {
      client = this.connectionService.getHttpClient()
    } catch {
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: "Not connected to CLI backend",
      })
      return null
    }

    const mgr = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!mgr || !state) {
      this.postToWebview({ type: "agentManager.worktreeSetup", status: "error", message: "No workspace folder open" })
      return null
    }

    // Step 1: Create worktree
    this.postToWebview({ type: "agentManager.worktreeSetup", status: "creating", message: "Creating git worktree..." })

    let worktree: CreateWorktreeResult
    try {
      worktree = await mgr.createWorktree({ prompt: text || "kilo" })
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create worktree: ${err}`,
      })
      return null
    }

    // Step 2: Create session in worktree directory
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "starting",
      message: "Starting session...",
      branch: worktree.branch,
    })

    let session: SessionInfo
    try {
      session = await client.createSession(worktree.path)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      await mgr.removeWorktree(worktree.path)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
      })
      return null
    }

    // Step 3: Store in centralized state
    const wt = state.addWorktree({ branch: worktree.branch, path: worktree.path, parentBranch: worktree.parentBranch })
    state.addSession(session.id, wt.id)

    // Legacy metadata for backward compat
    mgr
      .writeMetadata(worktree.path, session.id, worktree.parentBranch)
      .catch((err) => this.log(`Failed to persist worktree metadata: ${err}`))

    // Register with KiloProvider
    this.registerWorktreeSession(session.id, worktree.path)

    // Notify webview about worktree metadata (for badges/icons)
    this.postToWebview({
      type: "agentManager.sessionMeta",
      sessionId: session.id,
      mode: "worktree",
      branch: worktree.branch,
      path: worktree.path,
      parentBranch: worktree.parentBranch,
    })

    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Worktree ready",
      sessionId: session.id,
      branch: worktree.branch,
    })

    this.pushState()

    // Step 4: Send the first message directly via httpClient
    const fileParts = ((msg.files ?? []) as Array<{ mime: string; url: string }>).map((f) => ({
      type: "file" as const,
      mime: f.mime,
      url: f.url,
    }))
    if (text || fileParts.length > 0) {
      try {
        const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string }> = [
          ...fileParts,
          ...(text ? [{ type: "text" as const, text }] : []),
        ]
        await client.sendMessage(session.id, parts, worktree.path, {
          providerID: msg.providerID as string | undefined,
          modelID: msg.modelID as string | undefined,
          agent: msg.agent as string | undefined,
        })
      } catch (error) {
        const err = error instanceof Error ? error.message : String(error)
        this.postToWebview({ type: "error", message: `Failed to send message: ${err}` })
      }
    }

    this.log(`Worktree session ready: session=${session.id} branch=${worktree.branch}`)
    return null
  }

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  private registerWorktreeSession(sessionId: string, directory: string): void {
    if (!this.provider) return
    this.provider.setSessionDirectory(sessionId, directory)
    this.provider.trackSession(sessionId)
  }

  /** Push the full worktree+session state to the webview. */
  private pushState(): void {
    const state = this.state
    if (!state) return
    this.postToWebview({
      type: "agentManager.state",
      worktrees: state.getWorktrees(),
      sessions: state.getSessions(),
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

  public postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message)
  }

  public dispose(): void {
    this.provider?.dispose()
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
