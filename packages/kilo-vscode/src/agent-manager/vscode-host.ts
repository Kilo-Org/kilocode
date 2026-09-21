/**
 * VS Code adapter implementing the Host interface.
 *
 * This file is on the architecture test allowlist — it is one of the few
 * agent-manager files permitted to import "vscode".
 */

import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Session } from "@kilocode/sdk/v2/client"
import type { Host, PanelContext, OutputHandle, SessionProvider, Disposable } from "./host"
import type { PRMergeMethod } from "./types"
import { ProjectRouteService } from "./project/route"
import { repoName, validateCloneUrl } from "./project/clone"
import { samePath } from "./project/paths"
import type { KiloConnectionService } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { PLATFORM, SNAPSHOT_INITIALIZATION } from "./constants"
import { DiffVirtualProvider } from "../DiffVirtualProvider"
import { buildWebviewHtml } from "../utils"
import { openFileInEditor, getWorkspaceRoot } from "../review-utils"
import { TelemetryProxy, type TelemetryEventName } from "../services/telemetry"
import type { AutoApproveController } from "../commands/toggle-auto-approve"
import type { RemoteStatusService } from "../services/RemoteStatusService"
import type { CaffeinationService } from "../services/caffeination"

const INTRO_KEY = "kilo.agentManager.introDismissed"
const PR_MERGE_METHODS_KEY = "agentManager.prMergeMethod"

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
    private readonly caffeination?: Pick<CaffeinationService, "getState" | "onChange" | "setEnabled">,
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
        enableForms: true,
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
      enableForms: true,
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
      browserAutomation: this.browserAutomation(),
      introDismissed: this.context.globalState.get<boolean>(INTRO_KEY) === true,
      frameSrc: ["localhost", "127.0.0.1"].map((host) => `http://${host}:*`).join(" "),
    })

    const provider = new KiloProvider(this.extensionUri, this.connectionService, this.context, {
      tabTitle: (title) => {
        panel.title = title
      },
      tabLabel: "Agent Manager",
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
    const snapshot = () => {
      if (this.caffeination) {
        void panel.webview.postMessage({ type: "agentManager.caffeination", ...this.caffeination.getState() })
      }
    }
    const unsubscribe = this.caffeination?.onChange(snapshot)
    panel.onDidDispose(() => unsubscribe?.())
    provider.attachToWebview(panel.webview, {
      onBeforeMessage: async (msg) => {
        if (msg.type === "agentManager.setCaffeination") {
          if (typeof msg.enabled === "boolean") await this.caffeination?.setEnabled(msg.enabled)
          return null
        }
        if (msg.type === "agentManager.requestCaffeination") {
          snapshot()
          return null
        }
        if (msg.type !== "agentManager.setIntroDismissed") return opts.onBeforeMessage(msg)
        if (typeof msg.dismissed === "boolean") await this.context.globalState.update(INTRO_KEY, msg.dismissed)
        return null
      },
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

  dirtyFiles(): string[] {
    return vscode.workspace.textDocuments
      .filter((doc) => doc.isDirty && doc.uri.scheme === "file")
      .map((doc) => doc.uri.fsPath)
  }

  async pickFolder(opts?: { defaultPath?: string; title?: string }): Promise<string | undefined> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: vscode.l10n.t("Select Folder"),
      title: opts?.title ?? vscode.l10n.t("Add Project to Agent Manager"),
      defaultUri: opts?.defaultPath ? vscode.Uri.file(opts.defaultPath) : undefined,
    })
    return uris?.at(0)?.fsPath
  }

  async input(opts: Parameters<Host["input"]>[0]): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: opts.title,
      prompt: opts.prompt,
      value: opts.value,
      validateInput: opts.validate,
      ignoreFocusOut: true,
    })
  }

  async confirm(message: string, action: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(message, { modal: true }, action)) === action
  }

  private async git() {
    if (!vscode.workspace.isTrusted) {
      throw new Error(vscode.l10n.t("Trust this workspace before cloning a repository."))
    }
    const version = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(vscode.version)
    if (!version || !(Number(version.at(1)) > 1 || (Number(version.at(1)) === 1 && Number(version.at(2)) >= 111))) {
      throw new Error(
        vscode.l10n.t("Update VS Code to 1.111 or later to clone here. You can still use Open local folder."),
      )
    }
    const extension = vscode.extensions.getExtension<{
      enabled: boolean
      getAPI(version: number): { openRepository(uri: vscode.Uri): Thenable<{ rootUri: vscode.Uri } | null> }
    }>("vscode.git")
    if (!extension || !vscode.workspace.getConfiguration("git").get("enabled", true)) {
      throw new Error(vscode.l10n.t("Enable the built-in Git extension and git.enabled to clone a repository."))
    }
    const git = extension.isActive ? extension.exports : await extension.activate()
    if (!extension.isActive || !git.enabled || !(await vscode.commands.getCommands(true)).includes("git.clone")) {
      throw new Error(
        vscode.l10n.t("The Git clone command is unavailable. Enable the built-in Git extension and reload VS Code."),
      )
    }
    return git.getAPI(1)
  }

  private async existingCheckout(name: string | undefined, selected: string): Promise<string | undefined> {
    if (!name) return undefined
    const dir = path.join(selected, name)
    if (!(await fs.stat(path.join(dir, ".git")).catch(() => undefined))) return undefined
    return dir
  }

  private async directory(dir: string, message: string): Promise<string> {
    const real = await fs.realpath(dir).catch(() => undefined)
    if (!real || !(await fs.stat(real).catch(() => undefined))?.isDirectory()) throw new Error(message)
    return real
  }

  async cloneRepository(url: string, parent: string): Promise<string | undefined> {
    const invalid = validateCloneUrl(url)
    if (invalid) throw new Error(vscode.l10n.t(invalid))
    const git = await this.git()
    const selected = await this.directory(parent, vscode.l10n.t("Select a parent folder for the cloned repository."))
    if (!this.multiProject() || !vscode.workspace.isTrusted) {
      throw new Error(
        vscode.l10n.t(
          "Cloning was cancelled because multi-project Agent Manager is disabled or the window is not trusted.",
        ),
      )
    }
    // Opening an existing checkout beats failing a clone into an occupied folder.
    const name = repoName(url)
    const existing = await this.existingCheckout(name, selected)
    if (existing) {
      const open = await this.confirm(
        vscode.l10n.t("A checkout already exists at {0}. Open it instead of cloning again?", existing),
        vscode.l10n.t("Open existing checkout"),
      )
      return open ? existing : undefined
    }
    let result: string | undefined
    let failure: unknown
    try {
      result = await vscode.commands.executeCommand<string | undefined>("git.clone", url, parent, {
        postCloneAction: "none",
        returnRepositoryPath: true,
      })
    } catch (err) {
      failure = err
    }
    if (result === undefined && failure !== undefined) {
      // A clone can complete while checkout fails, for example a missing Git LFS object.
      const recovered = await this.existingCheckout(name, selected)
      if (!recovered) throw failure
      const attach = await this.confirm(
        vscode.l10n.t("Checkout failed, but the repository was cloned. Attach {0} anyway?", recovered),
        vscode.l10n.t("Attach repository"),
      )
      if (!attach) return undefined
      result = recovered
    }
    if (result === undefined) return undefined
    const message = vscode.l10n.t(
      "Git did not return a repository folder. Use Open local folder to attach the checkout.",
    )
    if (typeof result !== "string" || !path.isAbsolute(result)) throw new Error(message)
    const root = await this.directory(result, message)
    const repo = await Promise.resolve(git.openRepository(vscode.Uri.file(root))).catch(() => undefined)
    const canonical = repo && (await fs.realpath(repo.rootUri.fsPath).catch(() => undefined))
    if (!canonical || !samePath(canonical, root)) {
      throw new Error(vscode.l10n.t("The folder returned by Git is not a repository: {0}", root))
    }
    if (
      !samePath(path.dirname(root), selected) &&
      !(await this.confirm(
        vscode.l10n.t("Git returned an existing checkout outside the selected parent folder: {0}", root),
        vscode.l10n.t("Attach existing project at {0}", root),
      ))
    )
      return undefined
    return root
  }

  multiProject(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new.experimental").get("multiProject", false)
  }

  browserAutomation(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new.experimental").get("browserAutomation", false)
  }

  worktreePool(): boolean {
    return vscode.workspace.getConfiguration("kilo-code.new.agentManager").get("worktreePool", true)
  }

  readProjects(): unknown {
    return this.context.globalState.get("agentManager.projects")
  }

  async writeProjects(value: unknown): Promise<void> {
    await this.context.globalState.update("agentManager.projects", value)
  }

  getPRMergeMethod(repo: string): PRMergeMethod | undefined {
    const values = this.context.globalState.get<Record<string, unknown>>(PR_MERGE_METHODS_KEY)
    const value = values?.[repo]
    if (value === "merge" || value === "squash" || value === "rebase") return value
    return undefined
  }

  async savePRMergeMethod(repo: string, method: PRMergeMethod): Promise<void> {
    const values = this.context.globalState.get<Record<string, unknown>>(PR_MERGE_METHODS_KEY) ?? {}
    await this.context.globalState.update(PR_MERGE_METHODS_KEY, { ...values, [repo]: method })
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

  onDidChangeWorktreePool(cb: (enabled: boolean) => void): Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kilo-code.new.agentManager.worktreePool")) cb(this.worktreePool())
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

  notify(kind: "info" | "warning" | "error", msg: string): void {
    if (kind === "info") void vscode.window.showInformationMessage(msg)
    else if (kind === "warning") void vscode.window.showWarningMessage(msg)
    else void vscode.window.showErrorMessage(msg)
  }

  revealInOS(path: string): void {
    if (vscode.env.remoteName) {
      console.warn(`[Kilo New] Cannot reveal ${path} in the OS file manager on a remote workspace`)
      return
    }
    void vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(path))
  }

  async withProgress<T>(title: string, task: (cancelled: () => boolean) => Promise<T>): Promise<T> {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_progress, token) => task(() => token.isCancellationRequested),
    )
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
      show: () => channel.show(true),
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
