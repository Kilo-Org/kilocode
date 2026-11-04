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
import { notifyHostAutoApprove, setHostAutoApprove } from "./agent-manager/provider-auto-approve"
import type { SettingsHandler } from "./agent-manager/project/settings"
import { local } from "./local"
import { DISPLAY_DEFAULTS, type ToHost, type ToWebview } from "./protocol"
import { bridge } from "./relay"
import { saveImage } from "./save-image"
import type { Manager } from "./server"
import {
  effectiveFontSize,
  KILO_SETTING_KEYS,
  readKiloSettings,
  settingsHost,
  writeKiloSettings,
} from "./settings-host"
import { resolveKiloProfile } from "./settings-paths"
import { promptKeybindings, watchKeybindings } from "./prompt-keybindings"
import { readDisplaySettings } from "./display-settings"
import { createSpeechToTextHost } from "./speech-to-text/host"
import { setSidebarSession, sidebarSession } from "./browser-tab/sidebar-session"
import { openBrowserLink } from "./browser-links"
import { DEVTOOLS } from "./browser-tab/html"
import { openToolFile, type ToolDiff } from "./tool-diff"

// The sidebar may only write the settings its own UI owns. Other views keep their own write path.
// The settings each webview may write; the Settings panel writes every Kilo setting through its own handler.
const VIEW_SETTING_KEYS: Record<"chat" | "agentManager", ReadonlySet<string>> = {
  chat: new Set(["showTaskTimeline"]),
  agentManager: new Set(["showTaskTimeline", "agentManager.pushFixes"]),
}

export function chat(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  trackCostSession: (sessionID: string) => void
  diff: ToolDiff
  /** Opens a chat web link in the Integrated Browser. Returns false when the tab cannot take it. */
  openBrowser?: (sessionId: string, url: string) => boolean
}) {
  // This host owns the persisted auto-approve flag, and the Agent Manager sweep reads it. Record it at activation, so
  // the sweep works before any webview resolves.
  setHostAutoApprove({
    enabled: () => input.context.globalState.get(AUTO_APPROVE, false),
    directory: input.directory,
  })
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
    composerState(input.context).forEach((message) => void send(message))
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
  view: View
  trackCostSession?: (sessionID: string) => void
  /** Directory for a saved image, when the view follows a session in another directory. */
  saveImageDirectory?: () => string | undefined
  /** The tool diff surfaces of the chat view. Settings has none. */
  diff?: ToolDiff
  /** Called on every message from the webview, before it is handled. */
  onMessage?: () => void
  /** Handles a view-specific message before the standard set. Returns true when it did. */
  handle?: (message: ToHost) => boolean
  onReset?: () => void
  /** Extra window globals of the webview bundle. */
  globals?: Record<string, unknown>
  /** The Agent Manager settings handler the Settings panel shares with the provider. */
  agentManager?: () => SettingsHandler
  /** Opens a chat web link in the Integrated Browser. Returns false when the tab cannot take it. */
  openBrowser?: (sessionId: string, url: string) => boolean
}) {
  const webview = input.webview
  const root = input.context.extensionUri
  const dist = Uri.joinPath(root, "dist")
  webview.options = { enableScripts: true, localResourceRoots: [dist, Uri.joinPath(root, "assets")] }
  const link = bridge({
    target: () => input.server.get(),
    post: (message) => void webview.postMessage(message),
    open: (url) => {
      const session = sidebarSession()
      void openBrowserLink(url, () => (session ? (input.openBrowser?.(session, url) ?? false) : false))
    },
    fetch: local,
  })
  const post = (message: ToWebview) => void webview.postMessage(message)
  // The composer state is shared: a change in one open view shows in the others, for example the sidebar and the
  // Agent Manager side by side.
  const others = (message: ToWebview) => surfaces.forEach((target) => target !== post && target(message))
  surfaces.add(post)
  // Voice input is host-side: the microphone, the custom endpoint key and the Gateway RPC never reach the webview.
  const speech = createSpeechToTextHost({
    server: input.server,
    directory: input.directory,
    remote: !!env.remoteName,
    profile: resolveKiloProfile(input.context),
    secrets: input.view === "settings",
    post,
  })
  // Config read and write are host-side: the Settings panel uses the full host, and the sidebar writes the
  // `kilo-code.v2.*` settings it owns, such as the task header graph toggle.
  const view = input.view
  const settings =
    view === "settings"
      ? settingsHost({
          context: input.context,
          server: input.server,
          directory: input.directory,
          post,
          onReset: input.onReset,
          agentManager: input.agentManager,
        })
      : {
          handle: (message: ToHost) => {
            if (message.type !== "updateVSCodeSettings") return false
            const values = Object.fromEntries(
              Object.entries(message.values).filter(([key]) => VIEW_SETTING_KEYS[view].has(key)),
            )
            void writeKiloSettings(values).catch((error: unknown) => {
              console.error("Failed to write Kilo settings", error)
            })
            return true
          },
          dispose() {},
        }
  // The sidebar carries the live Kilo settings: push a fresh value when any of them changes.
  const settingsWatch =
    input.view !== "settings"
      ? workspace.onDidChangeConfiguration((event) => {
          if (KILO_SETTING_KEYS.some((key) => event.affectsConfiguration(`${NAMESPACE}.${key}`)))
            post({ type: "vscodeSettingsLoaded", values: readKiloSettings() })
        })
      : undefined
  // The display layouts are Kilo-only config keys, so the chat reads them through the host when the webview asks,
  // and again when the config changes. A failed read keeps the v1 defaults.
  const postDisplaySettings = () => {
    void input.server
      .get()
      .then((server) => readDisplaySettings({ server, directory: input.directory }))
      .then((values) => post({ type: "displaySettingsLoaded", values }))
      .catch((error: unknown) =>
        post({
          type: "displaySettingsLoaded",
          values: DISPLAY_DEFAULTS,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
  }
  const handleSurface = (message: Surface) => {
    switch (message.type) {
      case "openToolFile":
        return openToolFile(input.directory, message)
      case "openDiffVirtual":
        return input.diff?.open(message.diff, message.initialDiffStyle)
      case "openDiffsVirtual":
        return input.diff?.openMany(message.diffs, message.initialDiffStyle)
      case "requestDisplaySettings":
        return postDisplaySettings()
    }
  }
  const handleGlobalState = (message: ToHost) => {
    switch (message.type) {
      case "requestModelSelectorExpanded":
        post({ type: "modelSelectorExpandedLoaded", value: input.context.globalState.get(EXPANDED, true) })
        return true
      case "persistModelSelectorExpanded":
        void input.context.globalState.update(EXPANDED, message.value)
        others({ type: "modelSelectorExpandedLoaded", value: message.value })
        return true
      case "requestAutoApproveState":
        post({ type: "autoApproveStateLoaded", value: input.context.globalState.get(AUTO_APPROVE, false) })
        return true
      case "persistAutoApproveState":
        void input.context.globalState.update(AUTO_APPROVE, message.value)
        others({ type: "autoApproveStateLoaded", value: message.value })
        // The host sweep is the only owner of the decision, so tell it to approve the requests already pending.
        notifyHostAutoApprove()
        return true
      default:
        return false
    }
  }
  // Leaf host actions that carry no state, kept together so the main handler stays within the complexity limit.
  const handleLeafMessage = (message: ToHost): boolean => {
    if (message.type === "saveImage") {
      void saveImage(input.saveImageDirectory?.() ?? input.directory, message)
      return true
    }
    // The Language tab applies at once: write `kilo-code.v2.language` and let the change event push it to every view.
    if (message.type === "setLanguage") {
      void workspace.getConfiguration(NAMESPACE).update("language", message.locale || undefined, true)
      return true
    }
    // The Kilo Gateway sign-in runs in the Profile view of the sidebar, as main opens its Profile panel.
    if (message.type === "openProfile") {
      void commands.executeCommand("kilo-code.v2.profile")
      return true
    }
    return false
  }

  const subscription = webview.onDidReceiveMessage((message: ToHost) => {
    input.onMessage?.()
    if (input.handle?.(message) || speech.handle(message)) return
    if (message.type === "fetch" || message.type === "abort" || message.type === "open") return link.receive(message)
    if (message.type === "sidebar.session") return setSidebarSession(message.sessionId)
    if (message.type === "trackCostSession") return input.trackCostSession?.(message.sessionID)
    if (isSurface(message)) return handleSurface(message)
    // A chat recovery link opens the Settings panel at the row that owns the problem.
    if (message.type === "openSettingsTab")
      return void commands.executeCommand("kilo-code.v2.settings", {
        tab: message.tab,
        subtab: message.subtab,
        focus: message.focus,
        titleKey: message.titleKey,
      })
    if (settings.handle(message)) return
    // Only the sidebar carries the cycle keybindings; the Settings panel must not change their context.
    if (message.type === "webviewFocusChanged" && input.view === "chat")
      return void commands.executeCommand("setContext", "kilo-code.v2.sidebarFocused", message.focused === true)
    if (message.type === "copyToClipboard")
      return void env.clipboard.writeText(message.text).then(
        () => post({ type: "clipboardWriteResult", id: message.id, ok: true }),
        (error: unknown) => post({ type: "clipboardWriteResult", id: message.id, ok: false, error: String(error) }),
      )
    if (handleGlobalState(message)) return
    if (handleLeafMessage(message)) return
  })
  const uri = (...parts: string[]) => webview.asWebviewUri(Uri.joinPath(root, ...parts)).toString()
  webview.html = html({
    csp: webview.cspSource,
    script: uri("dist", `${ENTRY[input.view]}.js`),
    style: uri("dist", `${ENTRY[input.view]}.css`),
    icons: uri("assets", "icons"),
    worker: uri("dist", "shiki-worker.js"),
    markdown: uri("dist", "markdown-shiki-worker.js"),
    directory: input.directory,
    size: effectiveFontSize(),
    language: env.language,
    version: (input.context.extension.packageJSON as { version?: string }).version ?? "",
    view: input.view,
    settings: readKiloSettings(),
    globals: input.globals,
  })
  return {
    post,
    dispose() {
      link.dispose()
      speech.dispose()
      surfaces.delete(post)
      settings.dispose()
      settingsWatch?.dispose()
      subscription.dispose()
    },
  }
}

const surfaces = new Set<(message: ToWebview) => void>()

/** The composer state every webview shares through globalState: auto-approve and the expanded model picker. */
export function composerState(context: ExtensionContext): ToWebview[] {
  return [
    { type: "autoApproveStateLoaded", value: context.globalState.get(AUTO_APPROVE, false) },
    { type: "modelSelectorExpandedLoaded", value: context.globalState.get(EXPANDED, true) },
  ]
}

const EXPANDED = "kilo-code.v2.modelSelectorExpanded"
const AUTO_APPROVE = "kilo-code.v2.autoApprove"
const NAMESPACE = "kilo-code.v2"
// The Agent Manager panel loads its own bundle; the sidebar and the Settings panel share one.
const ENTRY = { chat: "webview", settings: "webview", agentManager: "agent-manager" } as const
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
  version: string
  view?: View
  settings: Record<string, unknown>
  globals?: Record<string, unknown>
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
    // The Agent Manager browser panel embeds DevTools for the open page.
    ...(input.view === "agentManager" ? [`frame-src ${DEVTOOLS}`] : []),
  ].join("; ")
  const vars = SIZES.map((size) => `--kilo-font-size-${size}: ${(input.size * size) / 13}px;`).join(" ")
  const globals = {
    ICONS_BASE_URI: input.icons,
    KILO_SHIKI_WORKER_URI: input.worker,
    KILO_MARKDOWN_SHIKI_WORKER_URI: input.markdown,
    KILO_TOP_BAR: false,
    KILO_TOP_BAR_SURFACE: "sidebar_title",
    KILO_AGENT_MANAGER_INTRO_DISMISSED: true,
    KILO_SETTINGS: input.settings,
    KILO_EXTENSION_VERSION: input.version,
    ...input.globals,
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
<title>${input.view === "agentManager" ? "Agent Manager" : "Kilo Code"}</title>
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

type View = "chat" | "settings" | "agentManager"

type Surface = Extract<
  ToHost,
  { type: "openToolFile" | "openDiffVirtual" | "openDiffsVirtual" | "requestDisplaySettings" }
>

function isSurface(message: ToHost): message is Surface {
  return (
    message.type === "openToolFile" ||
    message.type === "openDiffVirtual" ||
    message.type === "openDiffsVirtual" ||
    message.type === "requestDisplaySettings"
  )
}
