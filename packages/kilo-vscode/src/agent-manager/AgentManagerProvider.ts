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
  // Shared helpers
  // ---------------------------------------------------------------------------

  /** Create a git worktree on disk and register it in state. Returns null on failure. */
  private async createWorktreeOnDisk(): Promise<{
    wt: ReturnType<WorktreeStateManager["addWorktree"]>
    result: CreateWorktreeResult
  } | null> {
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
    return { wt, result }
  }

  /** Create a CLI session in a worktree directory. Returns null on failure. */
  private async createSessionInWorktree(worktreePath: string, branch: string): Promise<SessionInfo | null> {
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

    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "starting",
      message: "Starting session...",
      branch,
    })

    try {
      return await client.createSession(worktreePath)
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      this.postToWebview({
        type: "agentManager.worktreeSetup",
        status: "error",
        message: `Failed to create session: ${err}`,
      })
      return null
    }
  }

  /** Send worktreeSetup.ready + sessionMeta + pushState after worktree creation. */
  private notifyWorktreeReady(sessionId: string, result: CreateWorktreeResult): void {
    this.pushState()
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Worktree ready",
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
  }

  // ---------------------------------------------------------------------------
  // Worktree actions
  // ---------------------------------------------------------------------------

  /** Create a new worktree with an auto-created first session. */
  private async onCreateWorktree(): Promise<null> {
    const created = await this.createWorktreeOnDisk()
    if (!created) return null

    const session = await this.createSessionInWorktree(created.result.path, created.result.branch)
    if (!session) {
      const state = this.getStateManager()
      const mgr = this.getWorktreeManager()
      state?.removeWorktree(created.wt.id)
      await mgr?.removeWorktree(created.result.path)
      return null
    }

    const state = this.getStateManager()!
    state.addSession(session.id, created.wt.id)
    this.registerWorktreeSession(session.id, created.result.path)
    this.notifyWorktreeReady(session.id, created.result)
    this.log(`Created worktree ${created.wt.id} with session ${session.id}`)
    return null
  }

  /** Delete a worktree and dissociate its sessions. */
  private async onDeleteWorktree(worktreeId: string): Promise<null> {
    const mgr = this.getWorktreeManager()
    const state = this.getStateManager()
    if (!mgr || !state) return null

    const wt = state.getWorktree(worktreeId)
    if (!wt) {
      this.log(`Worktree ${worktreeId} not found in state`)
      return null
    }

    try {
      await mgr.removeWorktree(wt.path)
    } catch (error) {
      this.log(`Failed to remove worktree from disk: ${error}`)
    }

    state.removeWorktree(worktreeId)
    this.pushState()
    this.log(`Deleted worktree ${worktreeId} (${wt.branch})`)
    return null
  }

  /** Promote a session: create a worktree and move the session into it. */
  private async onPromoteSession(sessionId: string): Promise<null> {
    const created = await this.createWorktreeOnDisk()
    if (!created) return null

    const state = this.getStateManager()!
    if (!state.getSession(sessionId)) {
      state.addSession(sessionId, created.wt.id)
    } else {
      state.moveSession(sessionId, created.wt.id)
    }

    this.registerWorktreeSession(sessionId, created.result.path)
    this.notifyWorktreeReady(sessionId, created.result)
    this.log(`Promoted session ${sessionId} to worktree ${created.wt.id}`)
    return null
  }

  /** Add a new session to an existing worktree. */
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
    this.postToWebview({
      type: "agentManager.worktreeSetup",
      status: "ready",
      message: "Session created",
      sessionId: session.id,
      branch: wt.branch,
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
