import * as vscode from "vscode"
import { ServerWatcher, type ServerInfo } from "./server"

export interface WebviewMessage {
  type: string
  [key: string]: unknown
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private serverWatcher: ServerWatcher

  constructor(private context: vscode.ExtensionContext) {
    this.serverWatcher = new ServerWatcher()
    this.serverWatcher.onChange((info) => {
      this.sendServerInfo(info)
    })
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.handleMessage(message)
    })

    if (this.context.extensionMode === vscode.ExtensionMode.Development) {
      this.setupDevReload(webviewView)
    }

    const server = await this.serverWatcher.start()
    this.sendServerInfo(server)

    webviewView.onDidDispose(() => {
      this.serverWatcher.dispose()
    })
  }

  private handleMessage(message: WebviewMessage) {
    switch (message.type) {
      case "ready":
        this.sendServerInfo(this.serverWatcher.server)
        this.sendWorkspaceInfo()
        break
      case "log":
        console.log("[webview]", message.message)
        break
    }
  }

  private sendServerInfo(info: ServerInfo | null) {
    this.view?.webview.postMessage({
      type: "server",
      server: info,
    })
  }

  private sendWorkspaceInfo() {
    const folders = vscode.workspace.workspaceFolders
    const directory = folders?.[0]?.uri.fsPath ?? null
    this.view?.webview.postMessage({
      type: "workspace",
      directory,
    })
  }

  private setupDevReload(webviewView: vscode.WebviewView) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview"), "**/*"),
    )

    const reload = () => {
      webviewView.webview.html = ""
      webviewView.webview.html = this.getHtml(webviewView.webview)
    }

    watcher.onDidChange(reload)
    watcher.onDidCreate(reload)

    webviewView.onDidDispose(() => {
      watcher.dispose()
    })
  }

  private getHtml(webview: vscode.Webview, bust = Date.now()): string {
    const webviewUri = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewUri, "index.js"))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewUri, "index.css"))
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:; connect-src http://localhost:* https://localhost:* http://127.0.0.1:* https://127.0.0.1:*;"
    />
    <link rel="stylesheet" href="${styleUri}?v=${bust}" />
    <title>Kilo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}?v=${bust}"></script>
  </body>
</html>`
  }
}

function getNonce(): string {
  let text = ""
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}
