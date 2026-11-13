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
import { getErrorMessage } from "./agent-manager/errors"
import { notifyHostAutoApprove, setHostAutoApprove } from "./agent-manager/provider-auto-approve"
import type { SettingsHandler } from "./agent-manager/project/settings"
import type { GitChanges } from "./git-changes"
import { local } from "./local"
import { dismissNotification, dismissedNotifications, syncDismissedNotifications } from "./notifications"
import { applyModelPreference, readModelPreferences } from "./model-preferences"
import {
  DISPLAY_DEFAULTS,
  type GitChangesStats,
  type ModelPreferenceMessage,
  type ToHost,
  type ToWebview,
} from "./protocol"
import { bridge } from "./relay"
import { saveImage } from "./save-image"
import { previewImage } from "./preview-image"
import type { Manager } from "./server"
import type { DocumentViewerProvider } from "./DocumentViewerProvider"
import {
  effectiveFontSize,
  KILO_SETTING_KEYS,
  readKiloSettings,
  settingsHost,
  writeKiloSettings,
} from "./settings-host"
import { resolveKiloProfile } from "./settings-paths"
import { promptKeybindings, promptSelection, watchPromptContext } from "./prompt-keybindings"
import { readDisplaySettings } from "./display-settings"
import { workStyleHost } from "./work-style-host"
import { SANDBOX_DEFAULT_KEY, SandboxPreference } from "./services/sandbox-preference"
import { createSpeechToTextHost } from "./speech-to-text/host"
import { setSidebarSession, sidebarSession } from "./browser-tab/sidebar-session"
import { openBrowserLink } from "./browser-links"
import { DEVTOOLS } from "./browser-tab/html"
import { documentExists, isMarkdownPath } from "./documents/document-reader"
import { indexingHost } from "./indexing/host"
import { openToolFile, type ToolDiff } from "./tool-diff"
import { chatFocus } from "./services/code-actions/target"
import { createMentionHost, isMentionRequest } from "./kilo-provider/mention-requests"

// The sidebar may only write the settings its own UI owns. Other views keep their own write path.
// The settings each webview may write; the Settings panel writes every Kilo setting through its own handler.
const VIEW_SETTING_KEYS: Record<View, ReadonlySet<string>> = {
  chat: new Set(["showTaskTimeline", "indexing.showButtonWhenDisabled"]),
  settings: new Set(),
  profile: new Set(),
  marketplace: new Set(),
  agentManager: new Set(["showTaskTimeline", "agentManager.pushFixes"]),
  documents: new Set(),
  diffViewer: new Set(),
  subagent: new Set(["showTaskTimeline"]),
}

/** The Agent Manager worktree actions of the sidebar chat. */
export type ChatWorktree = {
  /** Moves a conversation into a new worktree, reporting each step. */
  continue: (sessionId: string, progress: (status: string, detail?: string, error?: string) => void) => Promise<void>
  /** Creates a worktree, then opens the Agent Manager. */
  create: (baseBranch?: string, branchName?: string) => Promise<void>
  /** Opens the Agent Manager worktree dialog. */
  advanced: () => Promise<void>
  /** The current branch of the workspace, for the New Worktree menu. */
  branch: () => Promise<string | undefined>
}

export function chat(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  trackCostSession: (sessionID: string) => void
  diff: ToolDiff
  /** Opens a chat web link in the Integrated Browser. Returns false when the tab cannot take it. */
  openBrowser?: (sessionId: string, url: string) => boolean
  /** The editor tab of the Documents panel, created after this view so it can post comments here. */
  documents?: () => DocumentViewerProvider | undefined
  changes?: ChangesTab
  /** Creates the working tree stats source of this view, pushing each change to `onStats`. */
  gitStats?: (onStats: (stats?: GitChangesStats) => void) => GitChanges
  /** The Agent Manager worktree actions of the sidebar chat. */
  worktree?: ChatWorktree
}) {
  // This host owns the persisted auto-approve flag, and the Agent Manager sweep reads it. Record it at activation, so
  // the sweep works before any webview resolves.
  setHostAutoApprove({
    enabled: () => input.context.globalState.get(AUTO_APPROVE, false),
    directory: input.directory,
  })
  // Commands sent before the webview bundle listens are lost, and a resolved view is not yet loaded. Keep them until
  // the webview sends its first message, which it does on mount.
  const state: { view?: WebviewView; loaded: boolean; focused: boolean; queued: ToWebview[] } = {
    loaded: false,
    focused: false,
    queued: [],
  }
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
  const focus = (focused: boolean) => {
    state.focused = focused
    void commands.executeCommand("setContext", "kilo-code.v2.sidebarFocused", focused)
  }
  const provider: WebviewViewProvider = {
    resolveWebviewView(view) {
      state.view = view
      state.loaded = false
      // The button follows the working tree while the sidebar is visible. Hidden views stop polling and read the
      // current value only after they show again.
      const stats = input.gitStats?.((value) => void send({ type: "gitChangesStats", stats: value }))
      const surface = wire({
        ...input,
        webview: view.webview,
        view: "chat",
        onMessage: flush,
        onFocusChanged: focus,
        gitStats: () => stats?.read() ?? Promise.resolve(undefined),
      })
      stats?.setVisible(view.visible)
      const visibility = view.onDidChangeVisibility(() => {
        if (!view.visible) focus(false)
        stats?.setVisible(view.visible)
        surface.post({ type: "webviewActiveChanged", active: view.visible })
        // A hidden webview may not receive the reset notification.
        if (view.visible) syncState()
      })
      // The prompt hint names one shortcut at a time, so send the labels and whether an editor selection exists on
      // load and whenever either changes.
      const context = () =>
        void send({ type: "keybindings", bindings: promptKeybindings(input.context), selection: promptSelection() })
      const keybindings = watchPromptContext(input.context, context)
      context()
      view.onDidDispose(() => {
        surface.dispose()
        stats?.dispose()
        visibility.dispose()
        keybindings.dispose()
        focus(false)
        if (state.view !== view) return
        state.view = undefined
        state.loaded = false
        // A closed sidebar shows no session, so the Agent Manager may claim it again.
        setSidebarSession(undefined)
      })
    },
  }
  return {
    provider,
    post: send,
    syncState,
    focused: () => state.focused,
  }
}

/**
 * The session a web link opened from this view belongs to. A chat editor tab reports the session it shows; the
 * sidebar reports its own session, which the host tracks separately.
 */
export function linkSession(input: { session?: () => string | undefined } = {}): string | undefined {
  return input.session ? input.session() : sidebarSession()
}

/**
 * Connects one webview (the sidebar view or an editor panel) to the server relay and the host messages, and loads
 * the webview bundle. `view` selects the root view of the bundle.
 */
function isWorkStyleMessage(message: ToHost) {
  return message.type === "requestWorkStyle" || message.type === "applyWorkStyle" || message.type === "setWorkStyle"
}

export function wire(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  webview: Webview
  view: View
  /** Where the webview lives. The chat editor panel passes "editor" and the session it opens on. */
  surface?: "editor" | "sidebar"
  /** The session a chat editor tab starts on; the sidebar restores its own local tabs instead. */
  sessionID?: string
  /** The live session of this surface, for links and the Integrated Browser. The sidebar reports its own. */
  session?: () => string | undefined
  trackCostSession?: (sessionID: string) => void
  /** Directory for a saved image, when the view follows a session in another directory. */
  saveImageDirectory?: () => string | undefined
  /** The tool diff surfaces of the chat view. Settings has none. */
  diff?: ToolDiff
  /** The Changes editor tab the chat view opens. Settings has none. */
  changes?: ChangesTab
  /** Reads the working tree change counts of the Changes button. */
  gitStats?: () => Promise<GitChangesStats | undefined>
  /** The Agent Manager worktree actions of the sidebar chat. */
  worktree?: ChatWorktree
  /** Called on every message from the webview, before it is handled. */
  onMessage?: () => void
  /** Receives focus changes of the chat sidebar webview. */
  onFocusChanged?: (focused: boolean) => void
  /** Handles a view-specific message before the standard set. Returns true when it did. */
  handle?: (message: ToHost) => boolean
  onReset?: () => void
  /** Extra window globals of the webview bundle. */
  globals?: Record<string, unknown>
  /** The Agent Manager settings handler the Settings panel shares with the provider. */
  agentManager?: () => SettingsHandler
  /** Opens a chat web link in the Integrated Browser. Returns false when the tab cannot take it. */
  openBrowser?: (sessionId: string, url: string) => boolean
  /** The editor tab that previews Markdown files, when this view has one. */
  documents?: () => DocumentViewerProvider | undefined
}) {
  const webview = input.webview
  const root = input.context.extensionUri
  const dist = Uri.joinPath(root, "dist")
  webview.options = { enableScripts: true, localResourceRoots: [dist, Uri.joinPath(root, "assets")] }
  const link = bridge({
    target: () => input.server.get(),
    post: (message) => void webview.postMessage(message),
    open: (url, external) => {
      const session = linkSession(input)
      // Without an in-app opener the link goes to the system browser, which is what shift-click asks for.
      void openBrowserLink(
        url,
        external ? undefined : () => (session ? (input.openBrowser?.(session, url) ?? false) : false),
      )
    },
    fetch: local,
  })
  const post = (message: ToWebview) => void webview.postMessage(message)
  // The consent store is machine-local, so one host per extension answers every view.
  const indexing = indexingHost({
    context: input.context,
    server: input.server,
    directory: () => input.directory,
    log: (message, error) => console.error(`Kilo indexing: ${message}`, error),
  })
  const detachIndexing = indexing.attach(post)
  // The composer's `@` menu: file and past-chat search, the file picker, terminal output and git changes.
  const mentions = createMentionHost({ server: input.server, directory: input.directory, post })
  // The composer state is shared: a change in one open view shows in the others, for example the sidebar and the
  // Agent Manager side by side.
  const others = (message: ToWebview) => surfaces.forEach((target) => target !== post && target(message))
  const broadcast = (message: ToWebview) => {
    post(message)
    others(message)
  }
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
          // A reset clears the recents, usage and efforts; every open webview must drop its copy of them.
          onReset: () => {
            input.onReset?.()
            broadcast({ type: "modelPreferencesLoaded", value: readModelPreferences(input.context.globalState) })
          },
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
  const workStyle =
    view === "settings"
      ? { handle: async (_message: ToHost) => false }
      : workStyleHost({
          context: input.context,
          server: input.server,
          directory: input.directory,
          post,
        })
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
      .then((values) => {
        // Every surface that renders a transcript shares these settings, so a change in Settings must reach the
        // sidebar and the Agent Manager too; answering only the requester left them on the old layout.
        const message = { type: "displaySettingsLoaded", values } as const
        post(message)
        others(message)
      })
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
      case "openToolFile": {
        const documents = input.documents?.()
        if (documents && isMarkdownPath(message.filePath)) {
          documents.open({
            file: message.filePath,
            sessionId: message.sessionID,
            directory: input.directory,
            line: message.line,
            column: message.column,
          })
          return
        }
        return openToolFile(input.directory, message)
      }
      case "openDiffVirtual":
        return input.diff?.open(message.diff, message.initialDiffStyle)
      case "openDiffsVirtual":
        return input.diff?.openMany(message.diffs, message.initialDiffStyle)
      case "requestDisplaySettings":
        return postDisplaySettings()
      case "validateFiles": {
        const existing = message.paths.filter((file) => documentExists(input.directory, file))
        return post({ type: "validateFilesResult", id: message.id, existing })
      }
    }
  }
  // Every write broadcasts the new state, so a pick in the sidebar shows in the Agent Manager and Settings at once.
  const handleModelPreferences = async (message: ModelPreferenceMessage) => {
    const loaded = {
      type: "modelPreferencesLoaded",
      value: await applyModelPreference(input.context.globalState, message),
    } as const
    post(loaded)
    if (message.type !== "requestModelPreferences") others(loaded)
  }
  const sandboxPreference = new SandboxPreference(input.context.globalState)
  // The configured default comes from the `kilocode.sandbox` RPC; the host only keeps the user's draft preference.
  const sandboxDefaultMessage = async (): Promise<ToWebview> => ({
    type: "sandboxDefaultLoaded",
    explicit: sandboxPreference.explicit(),
  })
  const handleGlobalState = (message: ToHost) => {
    switch (message.type) {
      case "requestModelSelectorExpanded":
        post({ type: "modelSelectorExpandedLoaded", value: input.context.globalState.get(EXPANDED, true) })
        return true
      case "persistModelSelectorExpanded":
        void input.context.globalState.update(EXPANDED, message.value)
        others({ type: "modelSelectorExpandedLoaded", value: message.value })
        return true
      case "requestModelPreferences":
      case "toggleFavorite":
      case "persistRecents":
      case "recordModelUsage":
      case "persistVariant":
        void handleModelPreferences(message)
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
      case "requestSandboxDefault":
        void sandboxDefaultMessage().then((reply) => post(reply))
        return true
      case "persistSandboxDefault":
        void sandboxPreference
          .set(message.enabled)
          .then(async () => {
            const reply = await sandboxDefaultMessage()
            post(reply)
            others(reply)
          })
          .catch(async () => {
            // A failed write keeps the stored value; send it back so the composer does not show the guess.
            const reply = await sandboxDefaultMessage()
            post(reply)
            others(reply)
          })
        return true
      case "requestDismissedNotifications":
        post({ type: "dismissedNotificationsLoaded", ids: dismissedNotifications(input.context) })
        return true
      case "dismissNotification":
        broadcast({
          type: "dismissedNotificationsLoaded",
          ids: dismissNotification(input.context, message.notificationId),
        })
        return true
      case "syncDismissedNotifications":
        broadcast({
          type: "dismissedNotificationsLoaded",
          ids: syncDismissedNotifications(input.context, message.ids),
        })
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
    if (message.type === "previewImage") {
      void previewImage(input.context.globalStorageUri, message).catch((err: unknown) =>
        console.error("[Kilo] Failed to preview image:", err),
      )
      return true
    }
    // The Language tab applies at once: write `kilo-code.v2.language` and let the change event push it to every view.
    if (message.type === "setLanguage") {
      void workspace.getConfiguration(NAMESPACE).update("language", message.locale || undefined, true)
      return true
    }
    // The Changes tab sends its review comments to this view's composer through the provider's own sink.
    if (message.type === "openChanges") {
      input.changes?.open({ sessionId: message.sessionID, turnId: message.turnID })
      return true
    }
    if (message.type === "requestGitChangesStats") {
      void (input.gitStats?.() ?? Promise.resolve(undefined))
        .catch(() => undefined)
        .then((stats) => post({ type: "gitChangesStats", stats }))
      return true
    }
    if (routeWorktreeMessage(message, input.worktree, post)) return true
    // The Kilo Gateway sign-in runs in the Profile panel, as main opens its Profile tab.
    if (message.type === "openProfile") {
      void commands.executeCommand("kilo-code.v2.profile")
      return true
    }
    if (message.type === "openMarketplace") {
      void commands.executeCommand("kilo-code.v2.marketplace")
      return true
    }
    // A subagent opens in its own editor tab, in the directory store of the view that showed it.
    if (message.type === "openSubagent") {
      void commands.executeCommand("kilo-code.v2.openSubagent", {
        sessionID: message.sessionID,
        title: message.title,
        parentSessionID: message.parentSessionID,
        directory: input.directory,
      })
      return true
    }
    if (message.type === "requestIndexingSettings") {
      void indexing.requestSettings(message.projectId)
      return true
    }
    if (message.type === "setIndexingConsent") {
      void indexing.setConsent(message.projectId, message.enabled)
      return true
    }
    return false
  }

  const subscription = webview.onDidReceiveMessage((message: ToHost) => {
    input.onMessage?.()
    if (isWorkStyleMessage(message)) {
      void workStyle.handle(message)
      return
    }
    if (input.handle?.(message) || speech.handle(message)) return
    if (isMentionRequest(message)) return mentions.handle(message)
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
    if (message.type === "webviewFocusChanged" && input.view === "chat") {
      if (message.focused === true) chatFocus.gained("sidebar")
      if (input.onFocusChanged) return input.onFocusChanged(message.focused === true)
      return void commands.executeCommand("setContext", "kilo-code.v2.sidebarFocused", message.focused === true)
    }
    if (message.type === "copyToClipboard")
      return void env.clipboard.writeText(message.text).then(
        () => post({ type: "clipboardWriteResult", id: message.id, ok: true }),
        (error: unknown) => post({ type: "clipboardWriteResult", id: message.id, ok: false, error: String(error) }),
      )
    if (handleGlobalState(message)) return
    if (handleLeafMessage(message)) return
  })
  const uri = (...parts: string[]) => webview.asWebviewUri(Uri.joinPath(root, ...parts)).toString()
  // The rail follows the physical workbench edge. Text direction must not move it
  // between chat and code, and only the sidebar view has an edge to follow.
  const sidebar =
    input.view === "chat"
      ? workspace.getConfiguration("workbench").get<string>("sideBar.location") === "right"
        ? "right"
        : "left"
      : undefined
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
    sidebar,
    surface: input.surface,
    sessionID: input.sessionID,
    settings: readKiloSettings(),
    globals: input.globals,
  })
  return {
    post,
    dispose() {
      link.dispose()
      speech.dispose()
      surfaces.delete(post)
      detachIndexing()
      settings.dispose()
      settingsWatch?.dispose()
      subscription.dispose()
    },
  }
}

const surfaces = new Set<(message: ToWebview) => void>()

/**
 * The composer state every webview shares through globalState: auto-approve, the model picker preferences and the
 * sandbox preference for new sessions. Reset All Settings clears them and sends this again.
 */
export function composerState(context: ExtensionContext): ToWebview[] {
  return [
    { type: "autoApproveStateLoaded", value: context.globalState.get(AUTO_APPROVE, false) },
    { type: "modelSelectorExpandedLoaded", value: context.globalState.get(EXPANDED, true) },
    { type: "modelPreferencesLoaded", value: readModelPreferences(context.globalState) },
    { type: "sandboxDefaultLoaded", explicit: context.globalState.get<boolean>(SANDBOX_DEFAULT_KEY) },
  ]
}

const EXPANDED = "kilo-code.v2.modelSelectorExpanded"
const AUTO_APPROVE = "kilo-code.v2.autoApprove"
const NAMESPACE = "kilo-code.v2"
// The sidebar and the Agent Manager load their own bundles; the Settings, Profile and Marketplace panels share a third
// one that does not carry the chat transcript or its rich content.
const ENTRY = {
  chat: "webview",
  settings: "settings",
  profile: "settings",
  marketplace: "settings",
  agentManager: "agent-manager",
  documents: "documents",
  diffViewer: "diff-viewer",
  subagent: "webview",
} as const
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
  /** Physical workbench edge of the sidebar view; editor panels have none. */
  sidebar?: "left" | "right"
  /** Where this webview lives, for the chat that an editor tab shows instead of the sidebar. */
  surface?: "editor" | "sidebar"
  /** The session a chat editor tab starts on; null for a new-session tab and the sidebar. */
  sessionID?: string | null
  settings: Record<string, unknown>
  globals?: Record<string, unknown>
}) {
  const nonce = randomBytes(16).toString("hex")
  // The Settings, Profile and Marketplace panels load an ES module that imports its lazy tab chunks from the webview
  // origin.
  const module = input.view === "settings" || input.view === "profile" || input.view === "marketplace"
  const policy = [
    "default-src 'none'",
    `style-src 'unsafe-inline' ${input.csp}`,
    `script-src 'nonce-${nonce}'${module ? " 'strict-dynamic'" : ""} 'wasm-unsafe-eval'`,
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
    KILO_SURFACE: input.surface ?? "sidebar",
    KILO_SESSION_ID: input.sessionID ?? null,
    KILO_TOP_BAR: false,
    KILO_TOP_BAR_SURFACE: "sidebar_title",
    KILO_SANDBOX_CONTROLS: process.platform !== "win32",
    KILO_AGENT_MANAGER_INTRO_DISMISSED: true,
    KILO_SETTINGS: input.settings,
    KILO_EXTENSION_VERSION: input.version,
    ...input.globals,
  }
  const script = Object.entries(globals)
    .map(([key, value]) => `window.${key} = ${JSON.stringify(value).replace(/</g, "\\u003c")};`)
    .join(" ")
  return `<!DOCTYPE html>
<html lang="${escape(input.language)}" data-theme="kilo-vscode" data-sidebar="${input.sidebar ?? ""}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<link rel="stylesheet" href="${input.style}">
<title>${input.view === "agentManager" ? "Agent Manager" : input.view === "documents" ? "Documents" : input.view === "diffViewer" ? "Changes" : "Kilo Code"}</title>
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
  body { background-color: ${input.view === "settings" || input.view === "profile" || input.view === "marketplace" || input.view === "documents" || input.view === "subagent" ? "var(--vscode-editor-background)" : "var(--vscode-sideBar-background, var(--vscode-editor-background))"}; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
  #root { height: 100%; }
  .container { height: 100vh; }
</style>
</head>
<body>
<div id="root" data-directory="${escape(input.directory)}" data-view="${input.view ?? "chat"}"></div>
<script nonce="${nonce}">${script}</script>
<script nonce="${nonce}"${module ? ' type="module"' : ""} src="${input.script}"></script>
</body>
</html>`
}

function escape(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Routes the sidebar worktree actions to the Agent Manager worktree hooks. */
export function routeWorktreeMessage(
  message: ToHost,
  worktree: ChatWorktree | undefined,
  post: (message: ToWebview) => void,
): boolean {
  if (message.type === "agentManager.requestRepoInfo") {
    void (worktree?.branch() ?? Promise.resolve(undefined))
      .catch(() => undefined)
      .then((branch) => post({ type: "agentManager.repoInfo", branch }))
    return true
  }
  if (message.type === "agentManager.continueInWorktree") {
    if (!worktree) {
      post({ type: "continueInWorktreeProgress", status: "error", error: "Continue in Worktree is not available" })
      return true
    }
    void worktree
      .continue(message.sessionId, (status, detail, error) =>
        post({ type: "continueInWorktreeProgress", status, detail, error }),
      )
      .catch((error: unknown) =>
        post({ type: "continueInWorktreeProgress", status: "error", error: getErrorMessage(error) }),
      )
    return true
  }
  if (message.type === "agentManager.createWorktree") {
    void worktree?.create(message.baseBranch, message.branchName).catch((error: unknown) => {
      post({ type: "continueInWorktreeProgress", status: "error", error: getErrorMessage(error) })
    })
    return true
  }
  if (message.type === "openAdvancedWorktree") {
    void worktree?.advanced().catch((error: unknown) => {
      post({ type: "continueInWorktreeProgress", status: "error", error: getErrorMessage(error) })
    })
    return true
  }
  return false
}

type View = "chat" | "settings" | "profile" | "marketplace" | "agentManager" | "documents" | "diffViewer" | "subagent"

/** The Changes editor tab: the session, working tree and turn diffs with review comments. */
export type ChangesTab = {
  open(input: { sessionId?: string; turnId?: string }): void
}

type Surface = Extract<
  ToHost,
  { type: "openToolFile" | "openDiffVirtual" | "openDiffsVirtual" | "requestDisplaySettings" | "validateFiles" }
>

function isSurface(message: ToHost): message is Surface {
  return (
    message.type === "openToolFile" ||
    message.type === "openDiffVirtual" ||
    message.type === "openDiffsVirtual" ||
    message.type === "requestDisplaySettings" ||
    message.type === "validateFiles"
  )
}
