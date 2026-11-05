// The editor-tab browser is a host-driven panel: it talks to the extension over postMessage only, so its document
// needs no server connection, and it must allow the DevTools iframe the panel opens for a page.
import { randomBytes } from "node:crypto"
import type { Uri, Webview } from "vscode"

const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

/** The loopback origins the browser broker serves DevTools from. */
export const DEVTOOLS = ["http://127.0.0.1:*", "http://localhost:*"].join(" ")

function escaped(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function browserTabHtml(input: {
  webview: Webview
  script: Uri
  style: Uri
  icons: Uri
  size: number
  language: string
  version: string
  settings: Record<string, unknown>
}): string {
  const nonce = randomBytes(16).toString("hex")
  const csp = input.webview.cspSource
  const policy = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${csp}`,
    `script-src 'nonce-${nonce}'`,
    `worker-src ${csp}`,
    `font-src ${csp}`,
    `img-src ${csp} data: https:`,
    `frame-src ${DEVTOOLS}`,
  ].join("; ")
  const vars = SIZES.map((step) => `--kilo-font-size-${step}: ${(input.size * step) / 13}px;`).join(" ")
  const globals = {
    ICONS_BASE_URI: input.icons.toString(),
    KILO_SETTINGS: input.settings,
    KILO_EXTENSION_VERSION: input.version,
  }
  const script = Object.entries(globals)
    .map(([key, value]) => `window.${key} = ${JSON.stringify(value).replace(/</g, "\\u003c")};`)
    .join(" ")
  return `<!DOCTYPE html>
<html lang="${escaped(input.language)}" data-theme="kilo-vscode">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<link rel="stylesheet" href="${input.style}">
<title>Integrated Browser</title>
<style>
  :root { ${vars} --kilo-font-scale: ${input.size / 13}; }
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  body { background-color: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  #root { height: 100%; }
</style>
</head>
<body>
<div id="root" data-view="browser"></div>
<script nonce="${nonce}">${script}</script>
<script nonce="${nonce}" src="${input.script}"></script>
</body>
</html>`
}