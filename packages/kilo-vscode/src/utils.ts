import * as crypto from "crypto"
import * as vscode from "vscode"

export function getNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  opts: {
    scriptUri: vscode.Uri
    styleUri: vscode.Uri
    iconsBaseUri: vscode.Uri
    title: string
    port?: number
    extraStyles?: string
  },
): string {
  const nonce = getNonce()
  const connectSrc = opts.port
    ? `http://127.0.0.1:${opts.port} http://localhost:${opts.port} ws://127.0.0.1:${opts.port} ws://localhost:${opts.port}`
    : "http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"

  const csp = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `font-src ${webview.cspSource}`,
    `connect-src ${connectSrc}`,
    `img-src ${webview.cspSource} data: https:`,
  ].join("; ")

  return `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${opts.styleUri}">
  <title>${opts.title}</title>
  <style>
    html {
      scrollbar-color: auto;

      ::-webkit-scrollbar-thumb {
        border: 3px solid transparent !important;
        background-clip: padding-box !important;
      }
    }
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }
    body {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    #root {
      height: 100%;
    }${opts.extraStyles ? `\n    ${opts.extraStyles}` : ""}
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">window.ICONS_BASE_URI = "${opts.iconsBaseUri}";</script>
  <script nonce="${nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`
}
