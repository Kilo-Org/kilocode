// The chat webview view. The webview talks to the server only through the relay, so it never sees the password.
import { randomBytes } from "node:crypto"
import {
  commands,
  env,
  Uri,
  workspace,
  type ExtensionContext,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
} from "vscode"
import { local } from "./local"
import type { ToHost, ToWebview } from "./protocol"
import { bridge } from "./relay"
import { saveImage } from "./save-image"
import type { Manager } from "./server"
import { effectiveFontSize, KILO_SETTING_KEYS, readKiloSettings, settingsHost } from "./settings-host"
import { promptKeybindings, watchKeybindings } from "./prompt-keybindings"

export function chat(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  trackCostSession: (sessionID: string) => void
}) {
  // Commands sent before the webview bundle listens are lost, and a resolved view is not yet loaded. Keep them until
  // the webview sends its first message, which it does on mount.
  const state: { view?: WebviewView; loaded: boolean; queued: ToWebview[] } = { loaded: false, queued: [] }
  const send = (message: ToWebview) => {
    if (!state.view || !state.loaded) {
      state.queued.push(message)
      return Promise.resolve(true)
    }
    return state.view.webview.postMessage(message)
  }
  const flush = () => {
    if (!state.view) return
    state.loaded = true
    for (const message of state.queued.splice(0)) void state.view.webview.postMessage(message)
  }
  const syncState = () => {
    if (!state.view) return
    void send({ type: "autoApproveStateLoaded", value: input.context.globalState.get(AUTO_APPROVE, false) })
    void send({ type: "modelSelectorExpandedLoaded", value: input.context.globalState.get(EXPANDED, true) })
  }
  // The cycle keybindings are active only while the webview has focus, as on v1 (`sidebarFocused`).
  const focus = (focused: boolean) => void commands.executeCommand("setContext", "kilo-code.v2.sidebarFocused", focused)
  const provider: WebviewViewProvider = {
    resolveWebviewView(view) {
      state.view = view
      state.loaded = false
      const surface = wire({ ...input, webview: view.webview, view: "chat", onMessage: flush })
      const visibility = view.onDidChangeVisibility(() => {
        if (!view.visible) focus(false)
        surface.post({ type: "webviewActiveChanged", active: view.visible })
        // A hidden webview may not receive the reset notification.
        if (view.visible) syncState()
      })
      // The prompt hint shows the same keybind as the cycle command, so send it on load and when the
      // user's keybindings.json changes.
      const keybindings = watchKeybindings(
        input.context,
        () => void send({ type: "keybindings", bindings: promptKeybindings(input.context) }),
      )
      void send({ type: "keybindings", bindings: promptKeybindings(input.context) })
      view.onDidDispose(() => {
        surface.dispose()
        visibility.dispose()
        keybindings.dispose()
        focus(false)
        if (state.view !== view) return
        state.view = undefined
        state.loaded = false
      })
    },
  }
  return {
    provider,
    post: send,
    syncState,
  }
}

/**
 * Connects one webview (the sidebar view or an editor panel) to the server relay and the host messages, and loads
 * the webview bundle. `view` selects the root view of the bundle.
 */
export function wire(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  webview: Webview
  view: "chat" | "settings"
  trackCostSession?: (sessionID: string) => void
  /** Called on every message from the webview, before it is handled. */
  onMessage?: () => void
  onReset?: () => void
}) {
  const webview = input.webview
  const root = input.context.extensionUri
  const dist = Uri.joinPath(root, "dist")
  webview.options = { enableScripts: true, localResourceRoots: [dist, Uri.joinPath(root, "assets")] }
  const link = bridge({
    target: () => input.server.get(),
    post: (message) => void webview.postMessage(message),
    open: (url) => void env.openExternal(Uri.parse(url)),
    fetch: local,
  })
  const post = (message: ToWebview) => void webview.postMessage(message)
  // Config read and write are host-side: only the Settings panel uses them.
  const settings =
    input.view === "settings"
      ? settingsHost({
          context: input.context,
          server: input.server,
          directory: input.directory,
          post,
          onReset: input.onReset,
        })
      : undefined
  // The sidebar carries the live Kilo settings: push a fresh value when any of them changes.
  const settingsWatch =
    input.view === "chat"
      ? workspace.onDidChangeConfiguration((event) => {
          if (KILO_SETTING_KEYS.some((key) => event.affectsConfiguration(`${NAMESPACE}.${key}`)))
            post({ type: "vscodeSettingsLoaded", values: readKiloSettings() })
        })
      : undefined
  const subscription = webview.onDidReceiveMessage((message: ToHost) => {
    input.onMessage?.()
    if (message.type === "fetch" || message.type === "abort" || message.type === "open") return link.receive(message)
    if (message.type === "trackCostSession") return input.trackCostSession?.(message.sessionID)
    if (settings?.handle(message)) return
    // Only the sidebar carries the cycle keybindings; the Settings panel must not change their context.
    if (message.type === "webviewFocusChanged" && input.view === "chat")
      return void commands.executeCommand("setContext", "kilo-code.v2.sidebarFocused", message.focused === true)
    if (message.type === "copyToClipboard")
      return void env.clipboard.writeText(message.text).then(
        () => post({ type: "clipboardWriteResult", id: message.id, ok: true }),
        (error: unknown) => post({ type: "clipboardWriteResult", id: message.id, ok: false, error: String(error) }),
      )
    if (message.type === "requestModelSelectorExpanded")
      return post({ type: "modelSelectorExpandedLoaded", value: input.context.globalState.get(EXPANDED, true) })
    if (message.type === "persistModelSelectorExpanded")
      return void input.context.globalState.update(EXPANDED, message.value)
    // Auto-approve is a client-side reaction to permission requests, so the host only persists its state.
    if (message.type === "requestAutoApproveState")
      return post({ type: "autoApproveStateLoaded", value: input.context.globalState.get(AUTO_APPROVE, false) })
    if (message.type === "persistAutoApproveState")
      return void input.context.globalState.update(AUTO_APPROVE, message.value)
    if (message.type === "saveImage") return saveImage(input.directory, message)
    // The Language tab applies at once: write `kilo-code.v2.language` and let the change event push it to every view.
    if (message.type === "setLanguage")
      return void workspace
        .getConfiguration(NAMESPACE)
        .update("language", message.locale || undefined, true)
    // The Kilo Gateway sign-in runs in the Profile view of the sidebar, as main opens its Profile panel.
    if (message.type === "openProfile") return void commands.executeCommand("kilo-code.v2.profile")
  })
  const uri = (...parts: string[]) => webview.asWebviewUri(Uri.joinPath(root, ...parts)).toString()
  webview.html = html({
    csp: webview.cspSource,
    script: uri("dist", "webview.js"),
    style: uri("dist", "webview.css"),
    icons: uri("assets", "icons"),
    worker: uri("dist", "shiki-worker.js"),
    markdown: uri("dist", "markdown-shiki-worker.js"),
    directory: input.directory,
    size: effectiveFontSize(),
    language: env.language,
    view: input.view,
    settings: readKiloSettings(),
  })
  return {
    post,
    dispose() {
      link.dispose()
      settings?.dispose()
      settingsWatch?.dispose()
      subscription.dispose()
    },
  }
}

const EXPANDED = "kilo-code.v2.modelSelectorExpanded"
const AUTO_APPROVE = "kilo-code.v2.autoApprove"
const NAMESPACE = "kilo-code.v2"
const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

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
  view?: "chat" | "settings"
  settings: Record<string, unknown>
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
    KILO_SETTINGS: input.settings,
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
  html {
    scrollbar-color: auto;

    ::-webkit-scrollbar-thumb {
      border: 3px solid transparent !important;
      background-clip: padding-box !important;
    }
  }
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
  body { background-color: ${input.view === "settings" ? "var(--vscode-editor-background)" : "var(--vscode-sideBar-background, var(--vscode-editor-background))"}; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  #root { height: 100%; }
  .container { height: 100vh; }
</style>
</head>
<body>
<div id="root" data-directory="${escape(input.directory)}" data-view="${input.view ?? "chat"}"></div>
<script nonce="${nonce}">${script}</script>
<script nonce="${nonce}" src="${input.script}"></script>
</body>
</html>`
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
