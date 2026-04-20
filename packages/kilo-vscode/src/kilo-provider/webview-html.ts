import * as vscode from "vscode"
import { buildWebviewHtml } from "../utils"

export function webviewHtml(webview: vscode.Webview, uri: vscode.Uri, port?: number): string {
  return buildWebviewHtml(webview, {
    scriptUri: webview.asWebviewUri(vscode.Uri.joinPath(uri, "dist", "webview.js")),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(uri, "dist", "webview.css")),
    iconsBaseUri: webview.asWebviewUri(vscode.Uri.joinPath(uri, "assets", "icons")),
    title: "Kilo Code",
    port,
    extraStyles: `.container { height: 100%; display: flex; flex-direction: column; height: 100vh; border-right: 1px solid var(--border-weak-base); }`,
  })
}
