import * as vscode from "vscode"
import { buildWebviewHtml } from "./utils"
import { appendOutput, getWorkspaceRoot } from "./review-utils"

export interface DiffVirtualFile {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
}

/**
 * DiffVirtualProvider opens a lightweight diff viewer for a single in-memory
 * file diff (not backed by git). Used by the permission approval dock to show
 * edit changes before the user approves or rejects them.
 */
export class DiffVirtualProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private pending: DiffVirtualFile | undefined
  private outputChannel: vscode.OutputChannel

  constructor(private readonly extensionUri: vscode.Uri) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Diff Virtual")
  }

  private log(...args: unknown[]) {
    appendOutput(this.outputChannel, "DiffVirtual", ...args)
  }

  public open(diff: DiffVirtualFile): void {
    this.pending = diff
    const filename = diff.file.split("/").pop() ?? diff.file
    const title = `Changes: ${filename}`

    if (this.panel) {
      this.panel.title = title
      this.panel.reveal(vscode.ViewColumn.One)
      this.pushData()
      return
    }

    const panel = vscode.window.createWebviewPanel("kilo-code.new.DiffVirtualPanel", title, vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.extensionUri],
    })

    panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    panel.webview.html = this.getHtml(panel.webview)
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg))
    panel.onDidDispose(() => {
      this.log("Panel disposed")
      this.panel = undefined
      this.pending = undefined
    })

    this.panel = panel
  }

  private onMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    if (type === "webviewReady") {
      this.post({
        type: "ready",
        vscodeLanguage: vscode.env.language,
        languageOverride: vscode.workspace.getConfiguration("kilo-code.new").get<string>("language"),
        workspaceDirectory: getWorkspaceRoot(),
      })
      this.pushData()
      return
    }

    if (type === "diffVirtual.close") {
      this.panel?.dispose()
    }
  }

  private pushData(): void {
    if (!this.pending) return
    this.post({ type: "diffVirtual.data", diff: this.pending })
  }

  private post(message: Record<string, unknown>): void {
    if (this.panel?.webview) void this.panel.webview.postMessage(message)
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-virtual.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "diff-virtual.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Diff Virtual",
      extraStyles: "#root { display: flex; flex-direction: column; height: 100%; }",
    })
  }

  public dispose(): void {
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
