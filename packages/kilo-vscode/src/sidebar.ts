import * as vscode from "vscode"

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView

  constructor(private context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    }

    webviewView.webview.html = this.getHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "increment":
          vscode.window.showInformationMessage(`Count: ${message.count}`)
          break
      }
    })

    if (this.context.extensionMode === vscode.ExtensionMode.Development) {
      this.setupDevReload(webviewView)
    }
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
      content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;"
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
