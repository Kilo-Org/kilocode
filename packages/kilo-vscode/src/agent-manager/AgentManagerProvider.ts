import * as vscode from "vscode"
import type { KiloConnectionService } from "../services/cli-backend"
import { KiloProvider } from "../KiloProvider"
import { buildWebviewHtml } from "../utils"

/**
 * AgentManagerProvider opens the Agent Manager panel.
 *
 * The panel runs a SolidJS app that shares the sidebar's component library
 * and provider chain (VSCodeProvider, SessionProvider, etc.). It renders a
 * session list on the left and the ChatView on the right.
 *
 * Communication with kilo serve happens through a KiloProvider instance,
 * identical to the sidebar and "Open in Tab" panels.
 */
export class AgentManagerProvider implements vscode.Disposable {
  public static readonly viewType = "kilo-code.new.AgentManagerPanel"

  private panel: vscode.WebviewPanel | undefined
  private provider: KiloProvider | undefined
  private outputChannel: vscode.OutputChannel

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly connectionService: KiloConnectionService,
  ) {
    this.outputChannel = vscode.window.createOutputChannel("Kilo Agent Manager")
  }

  private log(...args: unknown[]) {
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
    this.outputChannel.appendLine(`${new Date().toISOString()} ${msg}`)
  }

  public openPanel(): void {
    if (this.panel) {
      this.log("Panel already open, revealing")
      this.panel.reveal(vscode.ViewColumn.One)
      return
    }
    this.log("Opening Agent Manager panel")

    this.panel = vscode.window.createWebviewPanel(
      AgentManagerProvider.viewType,
      "Agent Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    )

    this.panel.iconPath = {
      light: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-light.svg"),
      dark: vscode.Uri.joinPath(this.extensionUri, "assets", "icons", "kilo-dark.svg"),
    }

    // Set the HTML first (agent-manager bundle instead of the sidebar's webview bundle)
    this.panel.webview.html = this.getHtml(this.panel.webview)

    // Attach a KiloProvider for message handling, SSE subscription, and connection init
    // without overriding our HTML.
    this.provider = new KiloProvider(this.extensionUri, this.connectionService)
    this.provider.attachToWebview(this.panel.webview)

    this.panel.onDidDispose(() => {
      this.log("Panel disposed")
      this.provider?.dispose()
      this.provider = undefined
      this.panel = undefined
    })
  }

  private getHtml(webview: vscode.Webview): string {
    return buildWebviewHtml(webview, {
      scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.js")),
      styleUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "agent-manager.css")),
      iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "assets", "icons")),
      title: "Agent Manager",
      port: this.connectionService.getServerInfo()?.port,
    })
  }

  public postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message)
  }

  public dispose(): void {
    this.provider?.dispose()
    this.panel?.dispose()
    this.outputChannel.dispose()
  }
}
