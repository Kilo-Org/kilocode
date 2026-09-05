import * as vscode from "vscode"
import { isHttpsUrl, type PRReviewCommentData } from "../shared/review-comments"
import { thread } from "../shared/pr-review"
import type { KiloConnectionService } from "../services/cli-backend"
import { appendOutput, getWorkspaceRoot, openRelativeFile } from "../review-utils"
import { getDiffMarkdownRender, setDiffMarkdownRender } from "../review-settings"
import { buildWebviewHtml, getWebviewFontSize } from "../utils"
import { watchFontSizeConfig } from "../kilo-provider/font-size"
import { createDiffPRPolling, type DiffPRPoller, type DiffPRPollerOptions } from "./pr-poller"
import type { DiffSourceCatalog } from "./sources/catalog"
import { turnSourceId } from "./sources/turn"
import { WORKSPACE_SOURCE_ID } from "./sources/worktree"
import type { PanelContext } from "./types"
import { SourceController } from "./SourceController"

type CommentHandler = (comments: unknown[], autoSend: boolean) => void
type OpenArgs = {
  sessionId?: string
  turnId?: string
  initialSourceId?: string
  directory?: string
  file?: string
  comment?: PRReviewCommentData
  onComments?: CommentHandler
  beside?: boolean
}

function openDirectory(
  arg: OpenArgs | undefined,
  sessionId: string | undefined,
  lookup: (id: string) => string | undefined,
) {
  if (arg && "directory" in arg) return arg.directory
  if (!sessionId) return undefined
  return lookup(sessionId)
}

function openSource(arg: OpenArgs | undefined, sessionId: string | undefined): string | undefined {
  if (arg?.comment) return WORKSPACE_SOURCE_ID
  if (!arg?.turnId || !sessionId) return arg?.initialSourceId
  return turnSourceId(sessionId, arg.turnId)
}

function openTarget(arg: OpenArgs | undefined, handler: CommentHandler | undefined): CommentHandler | undefined {
  return typeof arg?.onComments === "function" ? arg.onComments : handler
}

function context(
  arg: OpenArgs | undefined,
  sessionId: string | undefined,
  dir: string | undefined,
  source: string | undefined,
): PanelContext {
  const ctx: PanelContext = {
    workspaceRoot: getWorkspaceRoot(),
    sessionId,
    dir,
    comment: arg?.comment,
    beside: arg?.beside,
    initialSourceId: source,
    initialFile: arg?.file ?? arg?.comment?.file,
    hidePicker: !!(!arg?.comment && arg?.turnId && sessionId),
  }
  if (arg?.comment) {
    ctx.initialMarkdown = false
    return ctx
  }
  if (typeof arg?.file === "string" && /\.(md|mdx|markdown)$/i.test(arg.file)) {
    ctx.initialMarkdown = true
  }
  return ctx
}

export interface DiffViewerProviderOptions {
  sessionIdProvider?: () => string | undefined
  sessionDirectoryProvider?: (sessionId: string) => string | undefined
  createPRPoller?: (opts: DiffPRPollerOptions) => DiffPRPoller
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
  private baseBranchOverride: string | undefined
  private target: CommentHandler | undefined
  private readonly prPolling: ReturnType<typeof createDiffPRPolling>
  private focusPending = false
  private openGeneration = 0
  private readonly sessionIdProvider: () => string | undefined
  private readonly sessionDirectoryProvider: (sessionId: string) => string | undefined
  private readonly output: vscode.OutputChannel

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly catalog: DiffSourceCatalog,
    opts: DiffViewerProviderOptions = {},
  ) {
    this.sessionIdProvider = opts.sessionIdProvider ?? (() => undefined)
    this.sessionDirectoryProvider = opts.sessionDirectoryProvider ?? (() => undefined)
    this.output = vscode.window.createOutputChannel("Kilo Diff Panel")
    this.prPolling = createDiffPRPolling({
      createPoller: opts.createPRPoller,
      onStatus: () => this.sendComments(),
      log: (...args) => this.log(...args),
    })
  }

  setCommentHandler(handler: CommentHandler): void {
    this.commentHandler = handler
  }

  openPanel(ctx: PanelContext, target: CommentHandler | undefined = this.commentHandler): void {
    const generation = ++this.openGeneration
    const previous = this.ctx
    const changed = previous !== undefined && this.contextKey(previous) !== this.contextKey(ctx)
    if (previous && (previous.dir ?? previous.workspaceRoot) !== (ctx.dir ?? ctx.workspaceRoot))
      this.baseBranchOverride = undefined
    this.target = target
    this.focusPending = !!ctx.comment
    this.ctx = { ...ctx, baseBranchOverride: this.baseBranchOverride }

    if (this.panel && this.controller) {
      this.reveal()
      const nextId = this.catalog.defaultSourceId(this.ctx)
      const sourceId = changed ? nextId : (this.controller.currentId ?? nextId)
      this.prPolling.sync(this.ctx, sourceId, this.panel.visible)
      this.openContext(changed)
      if (changed) this.controller.stop()
      this.controller.setContext(this.ctx)
      if (nextId && nextId !== this.controller.currentId) {
        void this.activate(nextId, generation)
        return
      }
      if (nextId) void this.reactivate(nextId, generation)
      else this.focus()
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
  openFromCommand(arg?: OpenArgs): void {
    const sessionId = arg?.sessionId ?? this.sessionIdProvider()
    const dir = openDirectory(arg, sessionId, this.sessionDirectoryProvider)
    this.openPanel(context(arg, sessionId, dir, openSource(arg, sessionId)), openTarget(arg, this.commentHandler))
  }

  /**
   * Called when VS Code restores a serialized panel after restart. State
   * is not persisted, so we discard the panel instead of rewiring it.
   */
  deserializePanel(panel: vscode.WebviewPanel): void {
    panel.dispose()
  }

  dispose(): void {
    this.prPolling.stop()
    this.target = undefined
    this.controller?.dispose()
    this.controller = undefined
    this.fontConfigDisposable?.dispose()
    this.fontConfigDisposable = undefined
    this.disposePanel()
    this.output.dispose()
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      DiffViewerProvider.viewType,
      "Changes",
      this.ctx?.beside ? vscode.ViewColumn.Beside : vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )
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
    this.controller.setVisible(panel.visible).catch((err) => this.log("Failed to update diff visibility:", err))
    if (this.ctx) this.controller.setContext(this.ctx)

    this.fontConfigDisposable?.dispose()
    this.fontConfigDisposable = watchFontSizeConfig((msg) => void panel.webview.postMessage(msg))

    this.panelDisposables.push(
      panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg as Record<string, unknown>)),
      panel.onDidChangeViewState(() =>
        this.controller?.setVisible(panel.visible).catch((err) => this.log("Failed to update diff visibility:", err)),
      ),
      panel.onDidDispose(() => this.onPanelDisposed()),
      panel.onDidChangeViewState((state) => this.prPolling.setVisible(state.webviewPanel.visible)),
    )
    this.openContext(false)
    this.prPolling.sync(this.ctx, this.ctx?.initialSourceId, panel.visible)
  }

  private onPanelDisposed(): void {
    this.log("Panel disposed")
    this.controller?.dispose()
    this.controller = undefined
    this.prPolling.stop()
    this.target = undefined
    this.fontConfigDisposable?.dispose()
    this.fontConfigDisposable = undefined
    this.baseBranchOverride = undefined
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
      if (typeof msg.id !== "string") return
      this.focusPending = false
      void this.activate(msg.id, this.openGeneration, false)
    },
    "diffViewer.sendComments": (msg) => {
      if (Array.isArray(msg.comments)) this.target?.(msg.comments, !!msg.autoSend)
    },
    "agentManager.copyToClipboard": (msg) => {
      if (typeof msg.text === "string") void vscode.env.clipboard.writeText(msg.text)
    },
    openExternal: (msg) => {
      if (typeof msg.url !== "string" || !isHttpsUrl(msg.url)) return
      void vscode.env.openExternal(vscode.Uri.parse(msg.url))
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
    "diffViewer.requestBranches": () => {
      void this.sendBranches()
    },
    "diffViewer.setBaseBranch": (msg) => {
      const branch = typeof msg.branch === "string" && msg.branch.length > 0 ? msg.branch : undefined
      this.baseBranchOverride = branch
      if (this.ctx) {
        this.ctx = { ...this.ctx, baseBranchOverride: branch }
        this.controller?.setContext(this.ctx)
      }
      void this.controller?.reactivate()
      void this.sendBranches()
    },
    openFile: (msg) => {
      if (typeof msg.filePath !== "string") return
      openRelativeFile(
        this.ctx?.dir ?? this.ctx?.workspaceRoot,
        msg.filePath,
        typeof msg.line === "number" ? msg.line : undefined,
      )
    },
  }

  private async sendBranches(): Promise<void> {
    if (!this.panel) return
    const ctx = this.ctx
    const branch = this.baseBranchOverride
    try {
      const result = await this.catalog.listWorkspaceBranches(branch, ctx?.dir)
      if (!result || !this.panel || ctx !== this.ctx || branch !== this.baseBranchOverride) return
      void this.panel.webview.postMessage({
        type: "diffViewer.branches",
        branches: result.branches,
        defaultBranch: result.defaultBranch,
        autoBase: result.autoBase,
        currentBase: result.currentBase,
        isAuto: result.isAuto,
        currentBranch: result.currentBranch,
      })
    } catch (err) {
      this.log("Failed to list workspace branches:", err instanceof Error ? err.message : String(err))
    }
  }

  private onWebviewReady(): void {
    if (!this.panel) return
    void this.panel.webview.postMessage({
      type: "ready",
      vscodeLanguage: vscode.env.language,
      languageOverride: vscode.workspace.getConfiguration("kilo-code.new").get<string>("language"),
      fontSize: getWebviewFontSize(),
      workspaceDirectory: this.ctx?.dir ?? getWorkspaceRoot(),
    })
    void this.panel.webview.postMessage({ type: "diffViewer.markdownRender", render: getDiffMarkdownRender() })
    this.openContext(false)
    const initial = this.ctx ? this.catalog.defaultSourceId(this.ctx) : undefined
    if (!initial) {
      this.focus()
      return
    }
    if (this.controller?.currentId === initial) {
      void this.reactivate(initial, this.openGeneration)
      return
    }
    void this.activate(initial, this.openGeneration)
  }

  private async activate(id: string, generation: number, jump = true): Promise<void> {
    if (!this.panel || !this.controller) return
    if (this.controller.currentId === id) return

    this.prPolling.sync(this.ctx, id, this.panel.visible)
    this.resetView()
    await this.controller.activate(id).catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to activate source:", message)
    })
    if (generation !== this.openGeneration) return
    this.sendComments()
    if (jump) this.focus()
  }

  private async reactivate(id: string, generation: number): Promise<void> {
    if (!this.panel || !this.controller || this.controller.currentId !== id) return
    await this.controller.reactivate().catch((err) => {
      const message = err instanceof Error ? err.message : String(err)
      this.log("Failed to reactivate source:", message)
    })
    if (generation !== this.openGeneration) return
    this.sendComments()
    this.focus()
  }

  private resetView(): void {
    if (!this.panel) return
    void this.panel.webview.postMessage({ type: "diffViewer.loading", loading: true })
    void this.panel.webview.postMessage({ type: "diffViewer.diffs", diffs: [] })
    void this.panel.webview.postMessage({ type: "diffViewer.notice", notice: undefined })
  }

  private reveal(): void {
    if (!this.panel) return
    this.panel.reveal(this.ctx?.beside ? vscode.ViewColumn.Beside : (this.panel.viewColumn ?? vscode.ViewColumn.One))
  }

  private openContext(changed: boolean): void {
    if (!this.panel || !this.ctx) return
    if (changed) {
      this.resetView()
      void this.panel.webview.postMessage({ type: "diffViewer.prComments", comments: [] })
    }
    void this.panel.webview.postMessage({ type: "diffViewer.context", key: this.contextKey(this.ctx) })
    void this.panel.webview.postMessage({ type: "diffViewer.initialFile", file: this.ctx.initialFile })
    if (this.ctx.initialMarkdown !== undefined)
      void this.panel.webview.postMessage({ type: "diffViewer.initialMarkdown", render: this.ctx.initialMarkdown })
    this.sendComments()
  }

  private contextKey(ctx: PanelContext): string {
    return JSON.stringify([ctx.sessionId ?? "", ctx.dir ?? ctx.workspaceRoot ?? ""])
  }

  private sendComments(): void {
    if (!this.panel) return
    const live = this.prPolling.getStatus()?.comments?.comments ?? []
    const selected = this.ctx?.comment ? thread(this.ctx.comment) : undefined
    const match = selected
      ? live.find((comment) => comment.threadId === selected.threadId || comment.id === selected.threadId)
      : undefined
    const comments = selected && !match ? [...live, { ...selected, outdated: true }] : live
    void this.panel.webview.postMessage({ type: "diffViewer.prComments", comments })
    if (!match || !this.focusPending) return
    this.focusPending = false
    this.focus()
  }

  private focus(): void {
    if (!this.panel || !this.ctx?.comment?.file) return
    const id = this.ctx.comment.id
    const comment =
      this.prPolling.getStatus()?.comments?.comments.find((item) => item.threadId === id || item.id === id) ??
      thread(this.ctx.comment)
    void this.panel.webview.postMessage({
      type: "diffViewer.focusComment",
      id: comment.threadId,
      file: comment.file ?? this.ctx.comment.file,
    })
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-viewer.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-viewer.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Changes",
      port: this.connection.getServerInfo()?.port,
      extraStyles: "#root { display: flex; flex-direction: column; }",
    })
  }

  private log(...args: unknown[]): void {
    appendOutput(this.output, "DiffViewerProvider", ...args)
  }
}
