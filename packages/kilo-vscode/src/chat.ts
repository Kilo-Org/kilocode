// The chat webview view. The webview talks to the server only through the relay, so it never sees the password.
import { randomBytes } from "node:crypto"
import { commands, env, Uri, workspace, type ExtensionContext, type WebviewView, type WebviewViewProvider } from "vscode"
import { local } from "./local"
import type { ToHost, ToWebview } from "./protocol"
import { bridge } from "./relay"
import { saveImage } from "./save-image"
import type { Manager } from "./server"
import { promptKeybindings, watchKeybindings } from "./prompt-keybindings"

export function chat(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const state: { view?: WebviewView } = {}
  const provider: WebviewViewProvider = {
    resolveWebviewView(view) {
      state.view = view
      const root = input.context.extensionUri
      const dist = Uri.joinPath(root, "dist")
      view.webview.options = { enableScripts: true, localResourceRoots: [dist, Uri.joinPath(root, "assets")] }
      const link = bridge({
        target: () => input.server.get(),
        post: (message) => void view.webview.postMessage(message),
        open: (url) => void env.openExternal(Uri.parse(url)),
        fetch: local,
      })
      const post = (message: ToWebview) => void view.webview.postMessage(message)
      // The cycle keybindings are active only while the webview has focus, as on v1 (`sidebarFocused`):
      // the webview reports its focus, so `ctrl+.` stays free for the editor quick-fix.
      const focus = (focused: boolean) =>
        void commands.executeCommand("setContext", "kilo-code.v2.sidebarFocused", focused)
      const subscription = view.webview.onDidReceiveMessage((message: ToHost) => {
        if (message.type === "fetch" || message.type === "abort" || message.type === "open") return link.receive(message)
        if (message.type === "webviewFocusChanged") return focus(message.focused === true)
        if (message.type === "copyToClipboard")
          return void env.clipboard.writeText(message.text).then(
            () => post({ type: "clipboardWriteResult", id: message.id, ok: true }),
            (error: unknown) => post({ type: "clipboardWriteResult", id: message.id, ok: false, error: String(error) }),
          )
        if (message.type === "requestModelSelectorExpanded")
          return post({ type: "modelSelectorExpandedLoaded", value: input.context.globalState.get(EXPANDED, true) })
        if (message.type === "persistModelSelectorExpanded")
          return void input.context.globalState.update(EXPANDED, message.value)
        if (message.type === "saveImage") return saveImage(input.directory, message)
      })
      const visibility = view.onDidChangeVisibility(() => {
        if (!view.visible) focus(false)
        post({ type: "webviewActiveChanged", active: view.visible })
      })
      // The prompt hint shows the same keybind as the cycle command, so send it on load and when the
      // user's keybindings.json changes.
      const keybindings = watchKeybindings(input.context, () =>
        post({ type: "keybindings", bindings: promptKeybindings(input.context) }),
      )
      post({ type: "keybindings", bindings: promptKeybindings(input.context) })
      view.onDidDispose(() => {
        link.dispose()
        subscription.dispose()
        visibility.dispose()
        keybindings.dispose()
        focus(false)
        if (state.view === view) state.view = undefined
      })
      const uri = (...parts: string[]) => view.webview.asWebviewUri(Uri.joinPath(root, ...parts)).toString()
      view.webview.html = html({
        csp: view.webview.cspSource,
        script: uri("dist", "webview.js"),
        style: uri("dist", "webview.css"),
        icons: uri("assets", "icons"),
        worker: uri("dist", "shiki-worker.js"),
        markdown: uri("dist", "markdown-shiki-worker.js"),
        directory: input.directory,
        size: size(),
        language: env.language,
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

const EXPANDED = "kilo-code.v2.modelSelectorExpanded"
const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

function size() {
  const raw = workspace.getConfiguration("editor").get<number>("fontSize", 13)
  return Number.isFinite(raw) ? Math.min(24, Math.max(10, Math.round(raw))) : 13
}

export function html(input: {
  csp: string
  script: string
  style: string
  icons: string
  worker: string
  markdown: string
  directory: string
  size: number
  language: string
}) {
  const nonce = randomBytes(16).toString("hex")
  const policy = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${input.csp}`,
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `worker-src ${input.csp}`,
    `font-src ${input.csp}`,
    `connect-src ${input.csp}`,
    `img-src ${input.csp} data: https:`,
  ].join("; ")
  const vars = SIZES.map((size) => `--kilo-font-size-${size}: ${(input.size * size) / 13}px;`).join(" ")
  const globals = {
    ICONS_BASE_URI: input.icons,
    KILO_SHIKI_WORKER_URI: input.worker,
    KILO_MARKDOWN_SHIKI_WORKER_URI: input.markdown,
    KILO_TOP_BAR: false,
    KILO_TOP_BAR_SURFACE: "sidebar_title",
    KILO_AGENT_MANAGER_SETTINGS: false,
    KILO_BROWSER_AUTOMATION: false,
    KILO_AGENT_MANAGER_INTRO_DISMISSED: true,
    KILO_SETTINGS: {},
  }
  const script = Object.entries(globals)
    .map(([key, value]) => `window.${key} = ${JSON.stringify(value).replace(/</g, "\\u003c")};`)
    .join(" ")
  return `<!DOCTYPE html>
<html lang="${escape(input.language)}" data-theme="kilo-vscode">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<link rel="stylesheet" href="${input.style}">
<title>Kilo Code</title>
<style>
  :root { ${vars} --kilo-font-scale: ${input.size / 13}; --font-size-x-small: var(--kilo-font-size-10); --font-size-small: var(--kilo-font-size-11); --font-size-base: var(--kilo-font-size-13); --font-size-large: var(--kilo-font-size-16); }
  html { scrollbar-color: auto; }
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  body { background-color: var(--vscode-sideBar-background, var(--vscode-editor-background)); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  #root { height: 100%; }
  .container { height: 100vh; }
</style>
</head>
<body>
<div id="root" data-directory="${escape(input.directory)}"></div>
<script nonce="${nonce}">${script}</script>
<script nonce="${nonce}" src="${input.script}"></script>
</body>
</html>`
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
