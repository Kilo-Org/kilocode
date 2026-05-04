import * as vscode from "vscode"

/**
 * Testable abstraction over `vscode.WebviewPanel`.
 */
export interface PanelSurface {
  post(msg: unknown): void
  reveal(): void
  dispose(): void
  onDispose(cb: () => void): vscode.Disposable
  onMessage(cb: (msg: unknown) => void): vscode.Disposable
}

export function panelSurface(panel: vscode.WebviewPanel): PanelSurface {
  return {
    post(msg) {
      void panel.webview.postMessage(msg)
    },
    reveal() {
      panel.reveal(panel.viewColumn ?? vscode.ViewColumn.One)
    },
    dispose() {
      panel.dispose()
    },
    onDispose(cb) {
      return panel.onDidDispose(cb)
    },
    onMessage(cb) {
      return panel.webview.onDidReceiveMessage(cb)
    },
  }
}
