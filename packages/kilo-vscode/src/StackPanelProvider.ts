import * as vscode from "vscode"
import { buildWebviewHtml, getWebviewFontSize } from "./utils"
import { watchFontSizeConfig } from "./kilo-provider/font-size"
import { resolvePanelProjectDirectory } from "./project-directory"
import type { KiloConnectionService } from "./services/cli-backend"
import { StackHttpClient } from "./stack/client"
import { StackPanelController } from "./stack/panel-controller"
import type { StackWebviewMessage } from "./stack/types"

interface PanelMessage {
  type?: string
  draft?: unknown
  planHash?: unknown
  directory?: unknown
  url?: unknown
}

export class StackPanelProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.stackBuilderPanel"

  private panel: vscode.WebviewPanel | undefined
  private controller: StackPanelController | undefined
  private project: string | null = null
  private target: string | null = null
  private ready = false
  private generation = 0
  private loading: { generation: number; project: string | null; promise: Promise<void> } | undefined
  private disposables: vscode.Disposable[] = []
  private subscriptions: Array<() => void> = []
  private readonly client: StackHttpClient
  private readonly extensionVersion =
    vscode.extensions.getExtension("kilocode.kilo-code")?.packageJSON?.version ?? "unknown"

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
  ) {
    this.client = new StackHttpClient(connection)
  }

  /** `null` intentionally renders the project-required state. */
  openPanel(directory?: string | null): void {
    const project = directory === undefined ? this.resolveProject() : directory
    if (this.panel) {
      const changed = this.setProject(project)
      this.panel.reveal(vscode.ViewColumn.One)
      if (!changed && this.ready) void this.reload(this.generation)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      StackPanelProvider.viewType,
      "Project Stack",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
    this.attach(panel, project)
  }

  deserializePanel(panel: vscode.WebviewPanel): void {
    this.attach(panel, this.resolveProject())
  }

  dispose(): void {
    const panel = this.panel
    const generation = this.generation
    panel?.dispose()
    this.cleanup(panel, generation)
  }

  private attach(panel: vscode.WebviewPanel, project: string | null): void {
    this.cleanup()
    const generation = ++this.generation
    this.panel = panel
    this.project = project
    this.target = project
    this.ready = false
    this.controller = new StackPanelController(
      this.client,
      (msg) => this.post(msg, panel, generation),
      () => {
        if (this.active(panel, generation)) panel.dispose()
      },
      project,
    )
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    }
    panel.webview.html = this.getHtml(panel.webview)

    this.disposables.push(
      panel.webview.onDidReceiveMessage((msg) => void this.handle(msg as PanelMessage, panel, generation)),
      panel.onDidDispose(() => this.cleanup(panel, generation)),
      watchFontSizeConfig((msg) => this.post(msg, panel, generation)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        if (!this.active(panel, generation)) return
        this.setProject(this.resolveProject(), generation)
      }),
    )
    this.subscriptions.push(
      this.connection.onStateChange((state, err) => {
        if (!this.active(panel, generation)) return
        this.post({ type: "connectionState", state, ...(err ? { error: err.message } : {}) }, panel, generation)
        if (state === "connected" && this.ready) void this.reload(generation)
      }),
      this.connection.onLanguageChanged((locale) => this.post({ type: "languageChanged", locale }, panel, generation)),
    )
  }

  private cleanup(panel?: vscode.WebviewPanel, generation?: number): void {
    if (panel && !this.active(panel, generation)) return
    this.generation++
    this.controller?.dispose()
    for (const disposable of this.disposables) disposable.dispose()
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.disposables = []
    this.subscriptions = []
    this.panel = undefined
    this.controller = undefined
    this.loading = undefined
    this.target = null
    this.ready = false
  }

  private async connect(generation: number): Promise<void> {
    if (!this.active(undefined, generation)) return
    const project = this.project
    if (!project) {
      await this.reload(generation)
      return
    }
    try {
      await this.connection.connect(project)
      if (!this.active(undefined, generation) || this.project !== project) return
      await this.reload(generation)
    } catch (err) {
      if (!this.active(undefined, generation) || this.project !== project) return
      this.post(
        { type: "connectionState", state: "error", error: err instanceof Error ? err.message : String(err) },
        undefined,
        generation,
      )
    }
  }

  private reload(generation: number): Promise<void> {
    if (!this.active(undefined, generation) || this.target !== this.project) return Promise.resolve()
    const project = this.project
    const current = this.loading
    if (current?.generation === generation && current.project === project) return current.promise
    const controller = this.controller
    this.sync(generation)
    const promise = (controller?.load() ?? Promise.resolve()).then(() => {
      if (this.loading?.generation === generation && this.loading.project === project) this.loading = undefined
    })
    this.loading = { generation, project, promise }
    return promise
  }

  private sync(generation: number): void {
    if (!this.ready || !this.active(undefined, generation)) return
    const cfg = vscode.workspace.getConfiguration("kilo-code.new")
    this.post(
      {
        type: "ready",
        serverInfo: this.connection.getServerInfo() ?? undefined,
        extensionVersion: this.extensionVersion,
        vscodeLanguage: vscode.env.language,
        languageOverride: cfg.get<string>("language"),
        fontSize: getWebviewFontSize(),
        workspaceDirectory: this.project ?? "",
      },
      undefined,
      generation,
    )
    this.post(
      {
        type: "connectionState",
        state: this.connection.getConnectionState(),
        ...(this.connection.getConnectionError()?.message
          ? { error: this.connection.getConnectionError()!.message }
          : {}),
      },
      undefined,
      generation,
    )
  }

  private async handle(msg: PanelMessage, panel: vscode.WebviewPanel, generation: number): Promise<void> {
    if (!this.active(panel, generation)) return
    switch (msg.type) {
      case "stackRestoreProject":
        if (typeof msg.directory === "string") this.setProject(this.restoreProject(msg.directory), generation)
        return
      case "webviewReady":
        this.ready = true
        await this.connect(generation)
        return
      case "retryConnection":
        await this.connect(generation)
        return
      case "stackLoad":
      case "stackCancel":
        await this.controller?.handle(msg as StackWebviewMessage)
        return
      case "stackPreview":
        if (!msg.draft || typeof msg.draft !== "object") return
        await this.controller?.handle(msg as StackWebviewMessage)
        return
      case "stackApply":
        if (!msg.draft || typeof msg.draft !== "object" || typeof msg.planHash !== "string") return
        await this.controller?.handle(msg as StackWebviewMessage)
        return
      case "openExternal":
        this.openExternal(msg.url)
        return
    }
  }

  private setProject(project: string | null, generation = this.generation): boolean {
    if (!this.active(undefined, generation) || this.target === project) return false
    this.target = project
    const controller = this.controller
    if (!controller) return false
    void controller.setProject(project).then(() => {
      if (!this.active(undefined, generation) || this.controller !== controller || this.target !== project) return
      this.project = project
      this.post({ type: "workspaceDirectoryChanged", directory: project ?? "" }, undefined, generation)
      if (this.ready) void this.connect(generation)
    })
    return true
  }

  private restoreProject(project: string): string | null {
    return vscode.workspace.workspaceFolders?.some((folder) => folder.uri.fsPath === project) ? project : null
  }

  private resolveProject(): string | null {
    const editor = vscode.window.activeTextEditor
    const active =
      editor?.document.uri.scheme === "file"
        ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
        : undefined
    return resolvePanelProjectDirectory(active, vscode.workspace.workspaceFolders)
  }

  private active(panel?: vscode.WebviewPanel, generation = this.generation): boolean {
    return generation === this.generation && (!panel || panel === this.panel)
  }

  private openExternal(raw: unknown): void {
    if (typeof raw !== "string") return
    const uri = vscode.Uri.parse(raw)
    if (uri.scheme !== "http" && uri.scheme !== "https") return
    void vscode.env.openExternal(uri)
  }

  private post(msg: unknown, panel = this.panel, generation = this.generation): void {
    if (!panel || !this.ready || !this.active(panel, generation)) return
    void panel.webview.postMessage(msg).then(undefined, (err) => {
      console.warn("[Kilo New] Stack panel postMessage failed:", err)
    })
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "stack.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "stack.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Project Stack",
      port: this.connection.getServerInfo()?.port,
    })
  }
}
