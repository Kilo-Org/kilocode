import * as path from "path"
import * as vscode from "vscode"
import type { FileDiff } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "./services/cli-backend"
import { buildWebviewHtml } from "./utils"
import { GitOps } from "./agent-manager/GitOps"

/**
 * DiffViewerProvider opens a full-screen diff viewer in an editor tab.
 * It shows the local workspace diff (same as the Agent Manager's "local" tab)
 * and supports review comments that are forwarded back to the sidebar chat.
 */
export class DiffViewerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.DiffViewerPanel"

  private panel: vscode.WebviewPanel | undefined
  private diffInterval: ReturnType<typeof setInterval> | undefined
  private lastDiffHash: string | undefined
  /** Cached diff target so subsequent polls skip the git resolution. */
  private cachedDiffTarget: { directory: string; baseBranch: string } | undefined
  private gitOps: GitOps
  private outputChannel: vscode.OutputChannel
  /** Callback to forward review comments to the sidebar chat input. */
  private onSendComments: ((comments: unknown[]) => void) | undefined

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.gitOps = new GitOps({ log: (...args) => this.log(...args) })
    this.outputChannel = vscode.window.createOutputChannel("Kilo Diff Viewer")
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  /** Register a callback invoked when the user sends review comments from the diff viewer. */
  public setCommentHandler(handler: (comments: unknown[]) => void): void {
    this.onSendComments = handler
  }

  public openPanel(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }

    this.panel = vscode.window.createWebviewPanel(DiffViewerProvider.viewType, "Changes", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    this.panel.webview.html = this.getHtml(this.panel.webview)

    this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg), undefined, [])

    this.panel.onDidDispose(() => {
      this.log("Panel disposed")
      this.stopDiffPolling()
      this.panel = undefined
    })
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  private onMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    if (type === "webviewReady") {
      this.startDiffPolling()
      return
    }

    if (type === "diffViewer.sendComments" && Array.isArray(msg.comments)) {
      this.onSendComments?.(msg.comments)
      return
    }

    if (type === "diffViewer.close") {
      this.panel?.dispose()
      return
    }

    if (type === "diffViewer.setDiffStyle" && (msg.style === "unified" || msg.style === "split")) {
      return
    }

    if (type === "openFile" && typeof msg.filePath === "string") {
      this.openFile(msg.filePath, typeof msg.line === "number" ? msg.line : undefined)
      return
    }
  }

  // ---------------------------------------------------------------------------
  // Diff polling (mirrors AgentManagerProvider local diff logic)
  // ---------------------------------------------------------------------------

  private async resolveLocalDiffTarget(): Promise<{ directory: string; baseBranch: string } | undefined> {
    const root = this.getWorkspaceRoot()
    if (!root) {
      this.log("Local diff: no workspace root")
      return undefined
    }
    const branch = await this.gitOps.currentBranch(root)
    if (!branch || branch === "HEAD") {
      this.log("Local diff: detached HEAD or no branch")
      return undefined
    }
    const tracking = await this.gitOps.resolveTrackingBranch(root, branch)
    const defaultBranch = tracking ? undefined : await this.gitOps.resolveDefaultBranch(root, branch)
    const base = tracking ?? defaultBranch ?? "HEAD"
    this.log(
      `Local diff: branch=${branch} tracking=${tracking ?? "none"} default=${defaultBranch ?? "none"} base=${base}`,
    )
    return { directory: root, baseBranch: base }
  }

  /** Initial fetch: resolves the diff target, caches it, and pushes data. */
  private async initialFetch(): Promise<void> {
    const target = await this.resolveLocalDiffTarget()
    if (!target) return

    this.cachedDiffTarget = target
    this.post({ type: "diffViewer.loading", loading: true })

    try {
      const client = this.connectionService.getClient()
      const { data: diffs } = await client.worktree.diff(
        { directory: target.directory, base: target.baseBranch },
        { throwOnError: true },
      )

      this.lastDiffHash = diffs
        .map((d: FileDiff) => `${d.file}:${d.status}:${d.additions}:${d.deletions}:${d.after.length}`)
        .join("|")

      this.log(`Initial diff: ${diffs.length} file(s)`)
      this.post({ type: "diffViewer.diffs", diffs })
    } catch (err) {
      this.log("Failed to fetch initial diff:", err)
    } finally {
      this.post({ type: "diffViewer.loading", loading: false })
    }
  }

  /** Polling fetch: uses cached target, only pushes when content changes. */
  private async pollDiff(): Promise<void> {
    const target = this.cachedDiffTarget
    if (!target) return

    try {
      const client = this.connectionService.getClient()
      const { data: diffs } = await client.worktree.diff(
        { directory: target.directory, base: target.baseBranch },
        { throwOnError: true },
      )

      const hash = diffs
        .map((d: FileDiff) => `${d.file}:${d.status}:${d.additions}:${d.deletions}:${d.after.length}`)
        .join("|")

      if (hash === this.lastDiffHash) return
      this.lastDiffHash = hash

      this.post({ type: "diffViewer.diffs", diffs })
    } catch (err) {
      this.log("Failed to poll diff:", err)
    }
  }

  private startDiffPolling(): void {
    this.stopDiffPolling()
    this.lastDiffHash = undefined
    this.cachedDiffTarget = undefined

    void this.initialFetch().then(() => {
      if (!this.panel) return
      this.diffInterval = setInterval(() => {
        void this.pollDiff()
      }, 2500)
    })
  }

  private stopDiffPolling(): void {
    if (this.diffInterval) {
      clearInterval(this.diffInterval)
      this.diffInterval = undefined
    }
    this.lastDiffHash = undefined
    this.cachedDiffTarget = undefined
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private openFile(relativePath: string, line?: number): void {
    const root = this.getWorkspaceRoot()
    if (!root) return
    const resolved = path.resolve(root, relativePath)
    const uri = vscode.Uri.file(resolved)
    const target = Math.max(1, Math.floor(line ?? 1))
    const pos = new vscode.Position(target - 1, 0)
    const selection = new vscode.Range(pos, pos)
    // Open beside the diff viewer so it stays visible
    vscode.workspace.openTextDocument(uri).then(
      (doc) => vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true, selection }),
      (err) => console.error("[Kilo New] DiffViewerProvider: Failed to open file:", uri.fsPath, err),
    )
  }

  private getWorkspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders
    if (folders && folders.length > 0) return folders[0].uri.fsPath
    return undefined
  }

  private post(message: Record<string, unknown>): void {
    if (this.panel?.webview) void this.panel.webview.postMessage(message)
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-viewer.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-viewer.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Changes",
      port: this.connectionService.getServerInfo()?.port,
      extraStyles: "#root { display: flex; flex-direction: column; }",
    })
  }

  public dispose(): void {
    this.stopDiffPolling()
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
