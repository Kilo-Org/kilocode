import * as crypto from "crypto"
import * as vscode from "vscode"
import { buildCspString } from "./webview-html-utils"

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex")
}

const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

function clamp(size: number) {
  if (!Number.isFinite(size)) return 13
  return Math.min(24, Math.max(10, Math.round(size)))
}

export function getWebviewFontSize(): number {
  const raw = vscode.workspace.getConfiguration("kilo-code.new").get<number>("fontSize", 13)
  return clamp(raw)
}

/**
 * True when running inside Cursor rather than real VS Code (or another
 * fork). Cursor's Secondary Side Bar support is known to be unreliable for
 * extension-contributed `view/title` toolbars (see
 * https://github.com/anthropics/claude-code/issues/31375 for the same class
 * of bug in a different extension), so Cursor falls back to an in-webview
 * navigation bar instead of the native toolbar that VS Code renders fine
 * everywhere.
 *
 * This is a per-host choice, not a per-dock-location one: `WebviewView` (and
 * the rest of the public API, checked against @types/vscode) exposes no way
 * to ask "is my view currently in the primary or secondary side bar", so the
 * webview fallback bar is Cursor's only option in both locations. Accepted
 * trade-off: Cursor's primary side bar loses the single-line native look it
 * had before this existed, in exchange for the Secondary Side Bar actually
 * working, with zero guessing about dock position anywhere.
 */
export function isCursorHost(): boolean {
  return vscode.env.appName.toLowerCase().includes("cursor")
}

function fontStyle(): string {
  const base = getWebviewFontSize()
  const vars = SIZES.map((size) => `--kilo-font-size-${size}: ${(base * size) / 13}px;`).join("\n      ")
  return `:root {
      ${vars}
      --kilo-font-scale: ${base / 13};
      --font-size-x-small: var(--kilo-font-size-10);
      --font-size-small: var(--kilo-font-size-11);
      --font-size-base: var(--kilo-font-size-13);
      --font-size-large: var(--kilo-font-size-16);
    }`
}

export function buildWebviewHtml(
  webview: vscode.Webview,
  opts: {
    scriptUri: vscode.Uri
    styleUri: vscode.Uri
    iconsBaseUri: vscode.Uri
    workerUri: vscode.Uri
    title: string
    port?: number
    extraStyles?: string
    /** Sidebar top bar visibility and telemetry surface for the shared webview bundle (App.tsx). Unused by the Agent Manager bundle. */
    topBar?: boolean
    topBarSurface?: string
    agentManagerSettings?: boolean
    sidebar?: "left" | "right"
  },
): string {
  const nonce = getNonce()
  const csp = buildCspString(webview.cspSource, nonce, opts.port)
  const markdownWorkerUri = opts.workerUri.toString().replace(/shiki-worker\.js$/, "markdown-shiki-worker.js")

  return `<!DOCTYPE html>
<html lang="en" data-theme="kilo-vscode" data-sidebar="${opts.sidebar ?? ""}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${opts.styleUri}">
  <title>${opts.title}</title>
  <style>
    ${fontStyle()}
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
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background));
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
  <script nonce="${nonce}">window.ICONS_BASE_URI = "${opts.iconsBaseUri}"; window.KILO_SHIKI_WORKER_URI = "${opts.workerUri}"; window.KILO_MARKDOWN_SHIKI_WORKER_URI = "${markdownWorkerUri}"; window.KILO_TOP_BAR = ${opts.topBar !== false}; window.KILO_TOP_BAR_SURFACE = "${opts.topBarSurface ?? "sidebar_title"}"; window.KILO_AGENT_MANAGER_SETTINGS = ${opts.agentManagerSettings === true};</script>
  <script nonce="${nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`
}
