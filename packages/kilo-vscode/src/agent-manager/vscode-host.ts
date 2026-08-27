/**
 * VS Code adapter implementing the Host interface.
 *
 * This file is on the architecture test allowlist — it is one of the few
 * agent-manager files permitted to import "vscode".
 */

import * as vscode from "vscode"
import type { Session } from "@kilocode/sdk/v2/client"
import type { Host, PanelContext, OutputHandle, SessionProvider, Disposable } from "./host"
import { ProjectRouteService } from "./project/route"
import type { KiloConnectionService } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { PLATFORM, SNAPSHOT_INITIALIZATION } from "./constants"
import { DiffVirtualProvider } from "../DiffVirtualProvider"
import { buildWebviewHtml } from "../utils"
import { openFileInEditor, getWorkspaceRoot } from "../review-utils"
import { TelemetryProxy, type TelemetryEventName } from "../services/telemetry"
import type { AutoApproveController } from "../commands/toggle-auto-approve"
import type { RemoteStatusService } from "../services/RemoteStatusService"

export class VscodeHost implements Host {
  private diffVirtual: DiffVirtualProvider | undefined
  private autoApprove: AutoApproveController | undefined
  /**
   * Shared project route registry for every Agent Manager panel opened by
   * this host. One service keeps raw session id ambiguity consistent across
   * panels, so two panels never disagree about whether an id is ambiguous.
   */
  private readonly routes = new ProjectRouteService()

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
    private readonly context: vscode.ExtensionContext,
    private readonly remoteService: RemoteStatusService,
  ) {}

  setDiffVirtualProvider(provider: DiffVirtualProvider): void {
    this.diffVirtual = provider
  }

  setAutoApproveController(ctrl: AutoApproveController): void {
    this.autoApprove = ctrl
  }

  openPanel(opts: {
    onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    worktreeDirectories?: () => string[]
  }): PanelContext {
    const panel = vscode.window.createWebviewPanel(
      "kilo-code.new.AgentManagerPanel",
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    return this.wirePanel(panel, opts)
  }

  /** Wrap an existing vscode.WebviewPanel (e.g. deserialized on restart). */
  wrapExistingPanel(
    panel: vscode.WebviewPanel,
    opts: {
      onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
      worktreeDirectories?: () => string[]
      workspaceRoot?: () => string | undefined
      projectId?: () => string | undefined
    },
  ): PanelContext {
    return this.wirePanel(panel, opts)
  }

  private wirePanel(
    panel: vscode.WebviewPanel,
    opts: {
      onBeforeMessage: (msg: Record<string, unknown>) => Promise<Record<string, unknown> | null>
      worktreeDirectories?: () => string[]
      workspaceRoot?: () => string | undefined
      projectId?: () => string | undefined
    },
  ): PanelContext {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    const port = this.connectionService.getServerInfo()?.port
    panel.webview.html = buildWebviewHtml(panel.webview, {
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.js")),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.css")),
      iconsBaseUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Agent Manager",
      port,
    })

    const provider = new KiloProvider(this.extensionUri, this.connectionService, this.context, {
      platform: PLATFORM,
      snapshotInitialization: SNAPSHOT_INITIALIZATION,
      slimEditMetadata: true,
      worktreeDirectories: () => opts.worktreeDirectories?.() ?? [],
      rootDirectory: opts.workspaceRoot,
      disableViewedRegistration: true,
      disableStatsPolling: true,
      focusTargetContext: {
        prompt: "kilo-code.new.agentManagerPromptFocused",
        mainTerminal: "kilo-code.new.agentManagerMainTerminalFocused",
        sideTerminal: "kilo-code.new.agentManagerSideTerminalFocused",
      },
      routeService: this.routes,
      projectQualifier: () => {
        const projectId = opts.projectId?.()
        return projectId ? { projectId } : undefined
      },
    })
    if (this.diffVirtual) {
      provider.setDiffVirtualProvider(this.diffVirtual)
    }
    provider.setRemoteService(this.remoteService)
    provider.attachToWebview(panel.webview, {
      onBeforeMessage: opts.onBeforeMessage,
    })
    provider.setStreamVisibility(panel.active && panel.visible)
    const streams = panel.onDidChangeViewState((event) =>
      provider.setStreamVisibility(event.webviewPanel.active && event.webviewPanel.visible),
    )
    if (this.autoApprove) provider.setAutoApproveController(this.autoApprove)

    const sessions: SessionProvider = {
      setSessionDirectory: (id, dir) => provider.setSessionDirectory(id, dir),
      clearSessionDirectory: (id) => provider.clearSessionDirectory(id),
      getSessionDirectories: () => provider.getSessionDirectories(),
      getSessionInfo: (id) => provider.getSessionInfo(id),
      listSessions: (dir) => this.listProjectSessions(dir),
      trackSession: (id) => provider.trackSession(id),
      refreshSessions: () => provider.refreshSessions(),
      registerSession: (s) => provider.registerSession(s),
      recoverPendingPrompts: () => provider.recoverPendingPrompts(),
      onFollowupAdopted: (cb) => provider.onFollowupAdopted(cb),
      acknowledgeDraft: (draftID, sessionID) => provider.acknowledgeDraft(draftID, sessionID),
      abortSessions: (ids) => provider.abortSessions(ids),
      showMemory: (id) => provider.showMemory(id),
      toggleMemory: (id) => provider.toggleMemory(id),
      registerProjectRoute: (ref, root, generation) => provider.registerProjectRoute(ref, root, generation),
      unregisterProjectRoute: (projectId) => provider.unregisterProjectRoute(projectId),
      registerWorktreeRoute: (ref, directory, generation) => provider.registerWorktreeRoute(ref, directory, generation),
      registerSessionRoute: (ref, directory, generation) => provider.registerSessionRoute(ref, directory, generation),
      unregisterSessionRoute: (ref) => provider.unregisterSessionRoute(ref),
      isSessionRouteAmbiguous: (sessionId) => provider.isSessionRouteAmbiguous(sessionId),
      routeSessionDirectoryFor: (ref) => provider.routeSessionDirectoryFor(ref),
      refreshGitStatus: () => void provider.refreshGitStatus(),
      dispose: () => provider.dispose(),
    }

    return {
      get active() {
        return panel.active
      },
      get visible() {
        return panel.visible
      },
      postMessage(msg) {
        void panel.webview.postMessage(msg)
      },
      waitForReady() {
        return provider.waitForReady()
      },
      waitForActive() {
        if (panel.active) return Promise.resolve()
        return new Promise((resolve) => {
          const sub = panel.onDidChangeViewState((e) => {
            if (!e.webviewPanel.active) return
            sub.dispose()
            resolve()
          })
        })
      },
      reveal(preserveFocus) {
        panel.reveal(vscode.ViewColumn.One, preserveFocus ?? false)
      },
      sessions,
      onDidChangeVisibility(cb) {
        return panel.onDidChangeViewState((e) => cb(e.webviewPanel.visible))
      },
      onDidDispose(cb) {
        return panel.onDidDispose(cb)
      },
      dispose() {
        streams.dispose()
        provider.dispose()
        panel.dispose()
      },
    }
  }

  /**
   * List root sessions for one project directory via the shared CLI backend.
   * Used by per-project session discovery so multi-project Agent Manager lists
   * real Local/history sessions by their exact directory instead of only the
   * persisted managed records. Returns [] when the backend is not connected or
   * the listing fails, so one directory's failure cannot erase another's
   * results.
   */
  private async listProjectSessions(dir: string): Promise<Session[]> {
    try {
      const client = await this.connectionService.getClientAsync(dir)
      const res = await client.session.list({ directory: dir, roots: true }, { throwOnError: true })
      return res.data
    } catch (err) {
      console.warn(`[Kilo New] Agent Manager: failed to list project sessions for ${dir}:`, err)
      return []
    }
  }

  workspacePath(): string | undefined {
    return getWorkspaceRoot()
  }

  async pickFolder(): Promise<string | undefined> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Add Project",
      title: "Add Project to Agent Manager",
    })
    return uris?.[0]?.fsPath
  }

  multiProject(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new.experimental").get("multiProject", false)
  }

  readProjects(): unknown {
    return this.context.globalState.get("agentManager.projects")
  }

  async writeProjects(value: unknown): Promise<void> {
    await this.context.globalState.update("agentManager.projects", value)
  }

  unregisterProjectRoutes(projectId: string): void {
    this.routes.unregisterProject(projectId)
  }

  onDidChangeWorkspaceFolders(cb: () => void): Disposable {
    return vscode.workspace.onDidChangeWorkspaceFolders(() => cb())
  }

  onDidChangeMultiProject(cb: (enabled: boolean) => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kilo-code.new.experimental.multiProject")) cb(this.multiProject())
    })
  }

  isTrusted(): boolean {
    return vscode.workspace.isTrusted
  }

  autoBranchNaming(): { enabled: boolean; prefix: string } {
    const cfg = vscode.workspace.getConfiguration("kilo-code.new.agentManager")
    return {
      enabled: cfg.get("autoBranchNaming", true),
      prefix: cfg.get("branchPrefix", ""),
    }
  }

  showError(msg: string): void {
    void vscode.window.showErrorMessage(msg)
  }

  async openDocument(path: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(path)
      await vscode.window.showTextDocument(doc)
    } catch {
      // Silently ignore — file may not exist
    }
  }

  openFile(path: string, line?: number, column?: number): void {
    openFileInEditor(path, line, column, vscode.ViewColumn.Active, "AgentManagerProvider")
  }

  openFolder(path: string, newWindow: boolean): void {
    const uri = vscode.Uri.file(path)
    void vscode.commands.executeCommand("vscode.openFolder", uri, newWindow)
  }

  createOutput(name: string): OutputHandle {
    const channel = vscode.window.createOutputChannel(name)
    return {
      appendLine: (msg) => channel.appendLine(msg),
      dispose: () => channel.dispose(),
    }
  }

  extensionKeybindings(): Array<{ command: string; key?: string; mac?: string; when?: string }> {
    const ext = vscode.extensions.getExtension("kilocode.kilo-code")
    return ext?.packageJSON?.contributes?.keybindings ?? []
  }

  copyToClipboard(text: string): void {
    void vscode.env.clipboard.writeText(text)
  }

  capture(event: string, properties?: Record<string, unknown>): void {
    TelemetryProxy.capture(event as TelemetryEventName, properties)
  }

  openExternal(url: string): void {
    void vscode.env.openExternal(vscode.Uri.parse(url))
  }

  openSettings(tab?: string, projectId?: string): void {
    void vscode.commands.executeCommand("kilo-code.new.settingsButtonClicked", tab, projectId)
  }

  refreshGit(): void {
    void vscode.commands.executeCommand("git.refresh")
  }

  dispose(): void {}
}
