// The Documents editor tab of the sidebar. It is a real webview panel with its own tab strip, so a user can read,
// copy and comment on a file without leaving the chat. The Agent Manager shows the same component inside its side host.
import {
  Position,
  Range,
  Uri,
  ViewColumn,
  env,
  window,
  workspace,
  type Disposable,
  type ExtensionContext,
  type Webview,
  type WebviewPanel,
} from "vscode"
import { html } from "./chat"
import { readDocument, resolveDocumentPath } from "./documents/document-reader"
import { effectiveFontSize, readKiloSettings } from "./settings-host"
import type { ReviewCommentData } from "./shared/review-comments"

interface Context {
  sessionId?: string
  directory?: string
}

interface Pending {
  file: string
  sessionId?: string
  directory?: string
  line?: number
  column?: number
}

export interface DocumentViewerOptions {
  extension: ExtensionContext
  directory: string
  onComments: (comments: ReviewCommentData[], autoSend: boolean) => void
}

export class DocumentViewerProvider implements Disposable {
  public static readonly viewType = "kilo-code.v2.documentsPanel"
  private panel: WebviewPanel | undefined
  private ready = false
  private pending: Pending | undefined
  private readonly contexts = new Map<string, Context>()
  private currentKey = ""
  private readonly disposables: Disposable[] = []

  constructor(private readonly options: DocumentViewerOptions) {}

  open(input: { file: string; sessionId?: string; directory?: string; line?: number; column?: number }): void {
    const contextKey = this.contextKey(input.sessionId, input.directory)
    // The tab previews one context at a time, so forget the replaced one and the files read for it.
    this.contexts.clear()
    this.contexts.set(contextKey, { sessionId: input.sessionId, directory: input.directory })
    this.currentKey = contextKey
    const next = { ...input, contextKey }
    // Before the webview reports ready it cannot receive messages, so keep only the newest request.
    if (this.panel && this.ready) {
      this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One)
      void this.panel.webview.postMessage({ type: "document.open", ...next })
      return
    }
    this.pending = input
    if (this.panel) this.panel.reveal(this.panel.viewColumn ?? ViewColumn.One)
    else this.createPanel()
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
    const extension = this.options.extension.extensionUri
    const panel = window.createWebviewPanel(DocumentViewerProvider.viewType, "Documents", ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [extension],
    })
    panel.iconPath = {
      light: Uri.joinPath(extension, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(extension, "assets", "icons", "kilo-dark.svg"),
    }
    panel.webview.html = this.html(panel.webview)
    this.panel = panel
    this.disposables.push(
      panel.webview.onDidReceiveMessage((message) => this.message(message as Record<string, unknown>)),
      panel.onDidDispose(() => {
        this.panel = undefined
        this.ready = false
        this.pending = undefined
        this.currentKey = ""
      }),
    )
  }

  private message(message: Record<string, unknown>): void {
    if (message.type === "webviewReady") {
      this.ready = true
      this.flush()
      return
    }
    if (message.type === "document.request") return this.request(message)
    if (message.type === "document.sendComments" && Array.isArray(message.comments)) {
      this.options.onComments(message.comments as ReviewCommentData[], message.autoSend === true)
      return
    }
    if (message.type === "document.openFile" && typeof message.file === "string") {
      const context = this.contexts.get(this.currentKey)
      this.openFile(
        context?.directory,
        message.file,
        typeof message.line === "number" ? message.line : undefined,
        typeof message.column === "number" ? message.column : undefined,
      )
      return
    }
    if (message.type === "document.copyPath" && typeof message.file === "string") {
      const context = this.contexts.get(this.currentKey)
      const target = context?.directory ? resolveDocumentPath(context.directory, message.file) : { error: "" }
      if ("error" in target) return
      void env.clipboard
        .writeText(target.resolved)
        .then(undefined, (error) => console.error("Failed to copy the document path:", error))
      return
    }
    if (message.type === "document.close") this.panel?.dispose()
  }

  private flush(): void {
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
    void this.panel?.webview.postMessage({
      type: "document.result",
      sessionId: context?.sessionId ?? "",
      contextKey,
      requestedFile: file,
      ...result,
    })
  }

  private openFile(directory: string | undefined, file: string, line?: number, column?: number): void {
    if (!directory) return
    const target = resolveDocumentPath(directory, file)
    if ("error" in target) return
    void workspace.openTextDocument(target.resolved).then(
      (document) => {
        const position = new Position(Math.max(0, (line ?? 1) - 1), Math.max(0, (column ?? 1) - 1))
        return window.showTextDocument(document, {
          viewColumn: ViewColumn.Beside,
          preview: true,
          selection: new Range(position, position),
        })
      },
      (error: unknown) => console.error("Failed to open the document:", error),
    )
  }

  private html(webview: Webview): string {
    const root = this.options.extension.extensionUri
    const uri = (...parts: string[]) => webview.asWebviewUri(Uri.joinPath(root, ...parts)).toString()
    return html({
      csp: webview.cspSource,
      script: uri("dist", "documents.js"),
      style: uri("dist", "documents.css"),
      icons: uri("assets", "icons"),
      worker: uri("dist", "shiki-worker.js"),
      markdown: uri("dist", "markdown-shiki-worker.js"),
      directory: this.options.directory,
      size: effectiveFontSize(),
      language: env.language,
      version: (this.options.extension.extension.packageJSON as { version?: string }).version ?? "",
      view: "documents",
      settings: readKiloSettings(),
    })
  }
}
