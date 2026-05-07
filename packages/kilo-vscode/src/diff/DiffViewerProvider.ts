import * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend"
import { appendOutput, getWorkspaceRoot, openWorkspaceRelativeFile } from "../review-utils"
import { getDiffMarkdownRender, setDiffMarkdownRender } from "../review-settings"
import { buildWebviewHtml, getWebviewFontSize } from "../utils"
import { watchFontSizeConfig } from "../kilo-provider/font-size"
import type { DiffSourceCatalog } from "./sources/catalog"
import { turnSourceId } from "./sources/turn"
import type { PanelContext } from "./types"
import { SourceController } from "./SourceController"

type CommentHandler = (comments: unknown[], autoSend: boolean) => void

export interface DiffViewerProviderOptions {
  sessionIdProvider?: () => string | undefined
}

/**
 * Single global "Changes" panel. Owns the webview panel lifecycle and
 * routes webview messages to a SourceController, which owns the active
 * DiffSource.
 */
export class DiffViewerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.DiffViewerPanel"

  private panel: vscode.WebviewPanel | undefined
  private ctx: PanelContext | undefined
  private controller: SourceController | undefined
  private panelDisposables: vscode.Disposable[] = []
  private commentHandler: CommentHandler | undefined
  private fontConfigDisposable: vscode.Disposable | undefined
  private readonly sessionIdProvider: () => string | undefined
  private readonly output: vscode.OutputChannel

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly catalog: DiffSourceCatalog,
    opts: DiffViewerProviderOptions = {},
  ) {
    this.sessionIdProvider = opts.sessionIdProvider ?? (() => undefined)
    this.output = vscode.window.createOutputChannel("Kilo Diff Panel")
  }

  setCommentHandler(handler: CommentHandler): void {
    this.commentHandler = handler
  }

  openPanel(ctx: PanelContext): void {
    this.ctx = ctx

    if (this.panel && this.controller) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One)
      this.controller.setContext(ctx)
      const nextId = this.catalog.defaultSourceId(ctx)
      if (nextId && nextId !== this.controller.currentId) this.swap(nextId)
      return
    }

    this.createPanel()
  }

  /**
   * Entry point for the `kilo-code.new.showChanges` command. Composes the
   * PanelContext from the arg + injected session/workspace lookups so
   * callers don't have to know about it.
   *
   * When `turnId` is passed, opens the panel scoped to that single turn with
   * the source picker hidden — the view becomes a static "diff of this turn"
   * rather than the switchable workspace/session viewer.
   */
  openFromCommand(arg?: { sessionId?: string; turnId?: string; initialSourceId?: string }): void {
    const sessionId = arg?.sessionId ?? this.sessionIdProvider()
    const turnInitialSourceId = arg?.turnId && sessionId ? turnSourceId(sessionId, arg.turnId) : undefined
    this.openPanel({
      workspaceRoot: getWorkspaceRoot(),
      sessionId,
      initialSourceId: turnInitialSourceId ?? arg?.initialSourceId,
      hidePicker: !!turnInitialSourceId,
    })
  }

  /**
   * Called when VS Code restores a serialized panel after restart. State
   * is not persisted, so we discard the panel instead of rewiring it.
   */
  deserializePanel(panel: vscode.WebviewPanel): void {
    panel.dispose()
  }

  dispose(): void {
    this.controller?.dispose()
    this.controller = undefined
    this.fontConfigDisposable?.dispose()
    this.fontConfigDisposable = undefined
    this.disposePanel()
    this.output.dispose()
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(DiffViewerProvider.viewType, "Changes", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.html = this.getHtml(panel.webview)
    this.panel = panel

    this.controller = new SourceController(
      (id, ctx) => this.catalog.build(id, ctx),
      (ctx) => this.catalog.listAvailable(ctx),
      (msg) => void panel.webview.postMessage(msg),
    )
    if (this.ctx) this.controller.setContext(this.ctx)

    this.fontConfigDisposable?.dispose()
    this.fontConfigDisposable = watchFontSizeConfig((msg) => void panel.webview.postMessage(msg))

    this.panelDisposables.push(
      panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg as Record<string, unknown>)),
      panel.onDidDispose(() => this.onPanelDisposed()),
    )
  }

  private onPanelDisposed(): void {
    this.log("Panel disposed")
    this.controller?.dispose()
    this.controller = undefined
    this.fontConfigDisposable?.dispose()
    this.fontConfigDisposable = undefined
    this.disposePanel()
  }

  private disposePanel(): void {
    for (const d of this.panelDisposables) d.dispose()
    this.panelDisposables = []
    this.panel = undefined
  }

  private onMessage(msg: Record<string, unknown>): void {
    const handler = this.messageHandlers[msg.type as string]
    handler?.(msg)
  }

  private readonly messageHandlers: Record<string, (msg: Record<string, unknown>) => void> = {
    webviewReady: () => this.onWebviewReady(),
    selectSource: (msg) => {
      if (typeof msg.id === "string") this.swap(msg.id)
    },
    "diffViewer.sendComments": (msg) => {
      if (Array.isArray(msg.comments)) this.commentHandler?.(msg.comments, !!msg.autoSend)
    },
    "diffViewer.close": () => this.panel?.dispose(),
    "diffViewer.setDiffStyle": () => {},
    "diffViewer.setMarkdownRender": (msg) => {
      if (typeof msg.render === "boolean") void setDiffMarkdownRender(msg.render)
    },
    "diffViewer.revertFile": (msg) => {
      if (typeof msg.file === "string") void this.controller?.revertFile(msg.file)
    },
    "diffViewer.requestFile": (msg) => {
      if (typeof msg.file === "string") void this.controller?.requestFile(msg.file)
    },
    openFile: (msg) => {
      if (typeof msg.filePath !== "string") return
      openWorkspaceRelativeFile(msg.filePath, typeof msg.line === "number" ? msg.line : undefined)
    },
  }

  private onWebviewReady(): void {
    if (!this.panel) return
    void this.panel.webview.postMessage({
      type: "ready",
      vscodeLanguage: vscode.env.language,
      languageOverride: vscode.workspace.getConfiguration("kilo-code.new").get<string>("language"),
      fontSize: getWebviewFontSize(),
      workspaceDirectory: getWorkspaceRoot(),
    })
    void this.panel.webview.postMessage({ type: "diffViewer.markdownRender", render: getDiffMarkdownRender() })
    const initial = this.ctx ? this.catalog.defaultSourceId(this.ctx) : undefined
    if (initial) this.swap(initial)
  }

  private swap(id: string): void {
    if (!this.panel || !this.controller) return
    if (this.controller.currentId === id) return

    void this.panel.webview.postMessage({ type: "diffViewer.loading", loading: true })
    void this.panel.webview.postMessage({ type: "diffViewer.diffs", diffs: [] })
    void this.panel.webview.postMessage({ type: "diffViewer.notice", notice: undefined })

    void this.controller.activate(id).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to activate source:", message)
    })
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-viewer.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-viewer.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Changes",
      port: this.connection.getServerInfo()?.port,
      extraStyles: "#root { display: flex; flex-direction: column; }",
    })
  }

  private log(...args: unknown[]): void {
    appendOutput(this.output, "DiffViewerProvider", ...args)
  }
}
