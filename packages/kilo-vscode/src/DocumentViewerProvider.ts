import * as vscode from "vscode"
import type { ReviewCommentEntry } from "./shared/review-comments"
import { readDocument } from "./documents/document-reader"
import { openRelativeFile } from "./review-utils"
import { buildWebviewHtml } from "./utils"
import type { KiloConnectionService } from "./services/cli-backend"

interface Context {
  sessionId?: string
  directory?: string
}

type Comment = ReviewCommentEntry

export interface DocumentViewerOptions {
  onComments: (comments: Comment[], autoSend: boolean) => void
}

export class DocumentViewerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.DocumentsPanel"
  private panel: vscode.WebviewPanel | undefined
  private pending: { file: string; sessionId?: string; directory?: string; line?: number; column?: number } | undefined
  private readonly contexts = new Map<string, Context>()
  private currentKey = ""
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connection: KiloConnectionService,
    private readonly options: DocumentViewerOptions,
  ) {}

  openFromCommand(input: {
    file: string
    sessionId?: string
    directory?: string
    line?: number
    column?: number
  }): void {
    const contextKey = this.contextKey(input.sessionId, input.directory)
    this.contexts.set(contextKey, { sessionId: input.sessionId, directory: input.directory })
    this.currentKey = contextKey
    const next = { ...input, contextKey }
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.One)
      void this.panel.webview.postMessage({ type: "document.open", ...next })
      return
    }
    this.pending = input
    this.createPanel()
  }

  dispose(): void {
    this.panel?.dispose()
    for (const item of this.disposables) item.dispose()
    this.disposables.length = 0
    this.contexts.clear()
  }

  private contextKey(sessionId?: string, directory?: string): string {
    return `${sessionId ?? "local"}:${directory ?? ""}`
  }

  private createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      DocumentViewerProvider.viewType,
      "Documents",
      vscode.ViewColumn.One,
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
    panel.webview.html = this.html(panel.webview)
    this.panel = panel
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => this.message(message as Record<string, unknown>)),
      panel.onDidDispose(() => {
        this.panel = undefined
        this.pending = undefined
        this.currentKey = ""
      }),
    )
  }

  private message(message: Record<string, unknown>): void {
    if (message.type === "webviewReady") return this.ready()
    if (message.type === "document.request") {
      return this.request(message)
    }
    if (message.type === "document.sendComments" && Array.isArray(message.comments)) {
      this.options.onComments(message.comments as Comment[], message.autoSend === true)
      return
    }
    if (message.type === "document.openFile" && typeof message.file === "string") {
      const context = this.contexts.get(this.currentKey)
      openRelativeFile(
        context?.directory,
        message.file,
        typeof message.line === "number" ? message.line : undefined,
        typeof message.column === "number" ? message.column : undefined,
      )
      return
    }
    if (message.type === "document.close") this.panel?.dispose()
  }

  private ready(): void {
    if (!this.pending || !this.panel) return
    const input = this.pending
    this.pending = undefined
    void this.panel.webview.postMessage({
      type: "document.open",
      ...input,
      contextKey: this.contextKey(input.sessionId, input.directory),
    })
  }

  private request(message: Record<string, unknown>): void {
    const file = typeof message.file === "string" ? message.file : undefined
    const contextKey = typeof message.contextKey === "string" ? message.contextKey : undefined
    if (!file || !contextKey) return
    const context = this.contexts.get(contextKey)
    const result = context?.directory
      ? readDocument(context.directory, file)
      : { error: "The document context is no longer available." }
    this.panel?.webview.postMessage({
      type: "document.result",
      sessionId: context?.sessionId ?? "",
      contextKey,
      requestedFile: file,
      ...result,
    })
  }

  private html(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "documents.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "documents.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      workerUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "shiki-worker.js")),
      title: "Documents",
      port: this.connection.getServerInfo()?.port,
    })
  }
}
