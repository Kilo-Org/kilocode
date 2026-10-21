// The chat webview view. The webview talks to the server only through the fetch bridge, so it never sees the password.
import { randomBytes } from "node:crypto"
import { env, Uri, type ExtensionContext, type WebviewView, type WebviewViewProvider } from "vscode"
import { bridge } from "./relay"
import { local } from "./local"
import type { ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"

export function chat(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const state: { view?: WebviewView } = {}
  const provider: WebviewViewProvider = {
    resolveWebviewView(view) {
      state.view = view
      const dist = Uri.joinPath(input.context.extensionUri, "dist")
      view.webview.options = { enableScripts: true, localResourceRoots: [dist] }
      const link = bridge({
        target: () => input.server.get(),
        post: (message) => void view.webview.postMessage(message),
        open: (url) => void env.openExternal(Uri.parse(url)),
        fetch: local,
      })
      const subscription = view.webview.onDidReceiveMessage((message: ToHost) => link.receive(message))
      view.onDidDispose(() => {
        link.dispose()
        subscription.dispose()
        if (state.view === view) state.view = undefined
      })
      view.webview.html = html({
        csp: view.webview.cspSource,
        script: view.webview.asWebviewUri(Uri.joinPath(dist, "webview.js")).toString(),
        style: view.webview.asWebviewUri(Uri.joinPath(dist, "webview.css")).toString(),
        directory: input.directory,
      })
    },
  }
  return {
    provider,
    post(message: ToWebview) {
      return state.view?.webview.postMessage(message)
    },
  }
}

export function html(input: { csp: string; script: string; style: string; directory: string }) {
  const nonce = randomBytes(16).toString("base64")
  const policy = [
    "default-src 'none'",
    `style-src ${input.csp} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${input.csp} data:`,
    `font-src ${input.csp}`,
  ].join("; ")
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${input.style}">
<title>Kilo</title>
</head>
<body>
<div id="root" data-directory="${escape(input.directory)}"></div>
<script type="module" nonce="${nonce}" src="${input.script}"></script>
</body>
</html>`
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
