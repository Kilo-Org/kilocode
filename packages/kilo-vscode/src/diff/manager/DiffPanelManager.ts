import * as vscode from "vscode"
import type { KiloConnectionService } from "../../services/cli-backend"
import { appendOutput, getWorkspaceRoot, openWorkspaceRelativeFile } from "../../review-utils"
import { getDiffMarkdownRender, setDiffMarkdownRender } from "../../review-settings"
import { buildWebviewHtml } from "../../utils"
import type { DiffSourceCatalog } from "../sources/catalog"
import type { DiffSource, DiffSourceMessage, DiffSourcePost } from "../sources/types"
import type { PanelContext } from "../types"
import { panelSurface, type PanelSurface } from "./panel-surface"
import { realScheduler, type Scheduler } from "./scheduler"

const SWAP_LOADING_MS = 500

type CommentHandler = (comments: unknown[], autoSend: boolean) => void

export interface DiffPanelManagerOptions {
  scheduler?: Scheduler
  createSurface?: () => PanelSurface
  sessionIdProvider?: () => string | undefined
}

/**
 * Single global "Changes" panel. Owns one PanelSurface and one active
 * DiffSource at a time; swaps between sources on user request with a
 * short loading pulse so the view resets cleanly.
 */
export class DiffPanelManager implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.DiffViewerPanel"

  private surface: PanelSurface | undefined
  private ctx: PanelContext | undefined
  private currentSourceId: string | undefined
  private currentSource: DiffSource | undefined
  private startDisposable: vscode.Disposable | undefined
  private delayDisposable: vscode.Disposable | undefined
  private surfaceDisposables: vscode.Disposable[] = []
  private webviewReady = false
  private commentHandler: CommentHandler | undefined
  private readonly scheduler: Scheduler
  private readonly createSurface: () => PanelSurface
  private readonly sessionIdProvider: () => string | undefined
  private readonly output: vscode.OutputChannel

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly catalog: DiffSourceCatalog,
    options: DiffPanelManagerOptions = {},
  ) {
    this.scheduler = options.scheduler ?? realScheduler()
    this.createSurface = options.createSurface ?? (() => this.defaultCreateSurface())
    this.sessionIdProvider = options.sessionIdProvider ?? (() => undefined)
    this.output = vscode.window.createOutputChannel("Kilo Diff Panel")
  }

  private defaultCreateSurface(): PanelSurface {
    const panel = vscode.window.createWebviewPanel(DiffPanelManager.viewType, "Changes", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.html = this.getHtml(panel.webview)
    return panelSurface(panel)
  }

  public setCommentHandler(handler: CommentHandler): void {
    this.commentHandler = handler
  }

  public openPanel(ctx: PanelContext): void {
    this.ctx = ctx

    if (this.surface) {
      this.surface.reveal()
      const nextId = this.catalog.defaultSourceId(ctx)
      if (nextId && nextId !== this.currentSourceId) this.selectSource(nextId)
      return
    }

    this.adoptSurface(this.createSurface())
  }

  /**
   * Entry point for the `kilo-code.new.showChanges` command. Composes the
   * PanelContext from the arg + injected session/workspace lookups so
   * callers don't have to know about it.
   */
  public openFromCommand(arg?: { sessionId?: string; initialSourceId?: string }): void {
    this.openPanel({
      workspaceRoot: getWorkspaceRoot(),
      sessionId: arg?.sessionId ?? this.sessionIdProvider(),
      initialSourceId: arg?.initialSourceId,
    })
  }

  /**
   * Called when VS Code restores a serialized panel after restart. State
   * is not persisted, so we discard the panel instead of rewiring it.
   */
  public deserializePanel(panel: vscode.WebviewPanel): void {
    panel.dispose()
  }

  public dispose(): void {
    this.disposeCurrentSource()
    this.disposeSurface()
    this.output.dispose()
  }

  private adoptSurface(surface: PanelSurface): void {
    this.surface = surface
    this.webviewReady = false

    this.surfaceDisposables.push(
      surface.onMessage((msg) => this.onMessage(msg as Record<string, unknown>)),
      surface.onDispose(() => this.onPanelDisposed()),
    )
  }

  private onPanelDisposed(): void {
    this.log("Panel disposed")
    this.disposeCurrentSource()
    this.disposeSurface()
    this.currentSourceId = undefined
    this.webviewReady = false
  }

  private disposeSurface(): void {
    for (const d of this.surfaceDisposables) d.dispose()
    this.surfaceDisposables = []
    this.surface = undefined
  }

  private disposeCurrentSource(): void {
    this.delayDisposable?.dispose()
    this.delayDisposable = undefined
    this.startDisposable?.dispose()
    this.startDisposable = undefined
    this.currentSource?.dispose()
    this.currentSource = undefined
  }

  private onMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    if (type === "webviewReady") {
      this.webviewReady = true
      this.surface?.post({
        type: "ready",
        vscodeLanguage: vscode.env.language,
        languageOverride: vscode.workspace.getConfiguration("kilo-code.new").get<string>("language"),
        workspaceDirectory: getWorkspaceRoot(),
      })
      this.surface?.post({ type: "diffViewer.markdownRender", render: getDiffMarkdownRender() })
      const initial = this.ctx ? this.catalog.defaultSourceId(this.ctx) : undefined
      if (initial) this.selectSource(initial)
      return
    }

    if (type === "selectSource" && typeof msg.id === "string") {
      this.selectSource(msg.id)
      return
    }

    if (type === "diffViewer.sendComments" && Array.isArray(msg.comments)) {
      this.commentHandler?.(msg.comments, !!msg.autoSend)
      return
    }

    if (type === "diffViewer.close") {
      this.surface?.dispose()
      return
    }

    if (type === "diffViewer.setDiffStyle") {
      return
    }

    if (type === "diffViewer.setMarkdownRender" && typeof msg.render === "boolean") {
      void setDiffMarkdownRender(msg.render)
      return
    }

    if (type === "diffViewer.revertFile" && typeof msg.file === "string") {
      void this.revertFile(msg.file)
      return
    }

    if (type === "openFile" && typeof msg.filePath === "string") {
      openWorkspaceRelativeFile(msg.filePath, typeof msg.line === "number" ? msg.line : undefined)
    }
  }

  private async revertFile(file: string): Promise<void> {
    const source = this.currentSource
    if (!source?.revertFile) {
      this.surface?.post({
        type: "diffViewer.revertFileResult",
        file,
        status: "error",
        message: "Revert is not supported for the current source",
      })
      return
    }

    try {
      const result = await source.revertFile(file)
      this.surface?.post({
        type: "diffViewer.revertFileResult",
        file,
        status: result.ok ? "success" : "error",
        message: result.message,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to revert file:", message)
      this.surface?.post({ type: "diffViewer.revertFileResult", file, status: "error", message })
    }
  }

  private selectSource(id: string): void {
    if (!this.ctx || !this.surface) return
    if (this.currentSourceId === id && this.currentSource) return

    this.disposeCurrentSource()
    this.currentSourceId = id
    this.surface.post({ type: "diffViewer.loading", loading: true })
    this.surface.post({ type: "diffViewer.diffs", diffs: [] })
    this.surface.post({ type: "diffViewer.notice", notice: undefined })

    this.delayDisposable = this.scheduler.delay(SWAP_LOADING_MS, () => {
      this.delayDisposable = undefined
      void this.activateSource(id)
    })
  }

  private async activateSource(id: string): Promise<void> {
    if (!this.ctx || !this.surface) return
    if (this.currentSourceId !== id) return

    let source: DiffSource
    try {
      source = this.catalog.build(id, this.ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to build source:", message)
      this.surface.post({ type: "diffViewer.loading", loading: false })
      return
    }

    this.currentSource = source

    this.surface.post({
      type: "setAvailableSources",
      descriptors: this.catalog.listAvailable(this.ctx),
      currentId: id,
    })
    this.surface.post({
      type: "diffViewer.capabilities",
      capabilities: source.descriptor.capabilities,
    })

    const post = this.createSourcePost()
    await source.initialFetch(post)
    if (this.currentSourceId !== id) {
      source.dispose()
      return
    }
    this.startDisposable = source.start?.(post)
  }

  private createSourcePost(): DiffSourcePost {
    return (msg: DiffSourceMessage) => {
      if (!this.surface) return
      if (msg.type === "diffs") {
        this.surface.post({ type: "diffViewer.diffs", diffs: msg.diffs })
      } else if (msg.type === "loading") {
        this.surface.post({ type: "diffViewer.loading", loading: msg.loading })
      } else if (msg.type === "error") {
        this.log("Source error:", msg.message)
        this.surface.post({ type: "diffViewer.loading", loading: false })
      } else if (msg.type === "notice") {
        this.surface.post({ type: "diffViewer.notice", notice: msg.notice })
      }
    }
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
    appendOutput(this.output, "DiffPanelManager", ...args)
  }
}
