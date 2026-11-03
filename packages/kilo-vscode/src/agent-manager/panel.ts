// The Agent Manager editor panel: the webview loads the agent-manager bundle and talks to the server through the
// same relay as the sidebar. Agent Manager messages go to the provider; the standard webview messages (clipboard,
// tool files, display settings, cost alerts) are handled by the shared webview wiring.
import { Uri, ViewColumn, window, type ExtensionContext, type WebviewPanel } from "vscode"
import { composerState, wire } from "../chat"
import { promptKeybindings, watchKeybindings } from "../prompt-keybindings"
import type { ToHost, ToWebview } from "../protocol"
import type { Manager } from "../server"
import type { Disposable, PanelContext } from "./host"

export const PANEL_TYPE = "kilo-code.v2.agentManagerPanel"
const INTRO = "kilo.agentManager.introDismissed"

/** A message from the Agent Manager webview that the shared wiring does not handle. */
export type PanelMessage = { type: string } & Record<string, unknown>

export function createPanel(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  trackCostSession?: (sessionID: string) => void
}) {
  return {
    /** A new panel in the active editor column. */
    open(onMessage: (message: PanelMessage) => void) {
      const panel = window.createWebviewPanel(PANEL_TYPE, "Agent Manager", ViewColumn.Active, {
        enableScripts: true,
        enableForms: true,
        retainContextWhenHidden: true,
      })
      return wirePanel(panel, onMessage)
    },
    /** A panel that VS Code restored after a window reload. */
    restore: (panel: WebviewPanel, onMessage: (message: PanelMessage) => void) => wirePanel(panel, onMessage),
  }

  function wirePanel(panel: WebviewPanel, onMessage: (message: PanelMessage) => void): PanelContext {
    const root = input.context.extensionUri
    panel.iconPath = {
      light: Uri.joinPath(root, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(root, "assets", "icons", "kilo-dark.svg"),
    }
    // Messages posted before the webview bundle listens are lost, so they wait for its first message.
    const state: { ready: boolean; queued: unknown[]; waiting: (() => void)[] } = {
      ready: false,
      queued: [],
      waiting: [],
    }
    const ready = () => {
      if (state.ready) return
      state.ready = true
      state.queued.splice(0).forEach((message) => void panel.webview.postMessage(message))
      state.waiting.splice(0).forEach((resolve) => resolve())
    }
    const surface = wire({
      context: input.context,
      server: input.server,
      directory: input.directory,
      webview: panel.webview,
      view: "agentManager",
      trackCostSession: input.trackCostSession,
      onMessage: ready,
      globals: { KILO_AGENT_MANAGER_INTRO_DISMISSED: input.context.globalState.get<boolean>(INTRO) === true },
      handle: (message: ToHost) => {
        const item = message as unknown as PanelMessage
        if (item.type === "webviewReady") return true
        if (item.type === "agentManager.setIntroDismissed") {
          if (typeof item.dismissed === "boolean") void input.context.globalState.update(INTRO, item.dismissed)
          return true
        }
        if (!item.type.startsWith("agentManager.")) return false
        onMessage(item)
        return true
      },
    })
    // The composer gets the same pushed state as the sidebar composer: the cycle keybind, whether the panel shows,
    // and the shared auto-approve and model picker state, which the sidebar may change while the panel is hidden.
    const queue = (message: ToWebview) => {
      if (!state.ready) return void state.queued.push(message)
      void panel.webview.postMessage(message)
    }
    const keybindings = () => queue({ type: "keybindings", bindings: promptKeybindings(input.context) })
    keybindings()
    queue({ type: "webviewActiveChanged", active: panel.visible })
    const watcher = watchKeybindings(input.context, keybindings)
    const visibility = panel.onDidChangeViewState((event) => {
      queue({ type: "webviewActiveChanged", active: event.webviewPanel.visible })
      if (event.webviewPanel.visible) composerState(input.context).forEach(queue)
    })
    const disposed: (() => void)[] = []
    panel.onDidDispose(() => {
      surface.dispose()
      watcher.dispose()
      visibility.dispose()
      disposed.forEach((callback) => callback())
    })
    return {
      get active() {
        return panel.active
      },
      get visible() {
        return panel.visible
      },
      postMessage: (message: unknown) => queue(message as ToWebview),
      waitForReady() {
        if (state.ready) return Promise.resolve()
        return new Promise<void>((resolve) => state.waiting.push(resolve))
      },
      waitForActive() {
        if (panel.active) return Promise.resolve()
        return new Promise<void>((resolve) => {
          const subscription = panel.onDidChangeViewState((event) => {
            if (!event.webviewPanel.active) return
            subscription.dispose()
            resolve()
          })
        })
      },
      // Keep the column the user moved the panel to, including an auxiliary window.
      reveal(preserveFocus?: boolean) {
        panel.reveal(panel.viewColumn, preserveFocus ?? false)
      },
      onDidChangeVisibility(callback: (visible: boolean) => void): Disposable {
        return panel.onDidChangeViewState((event) => callback(event.webviewPanel.visible))
      },
      onDidDispose(callback: () => void): Disposable {
        disposed.push(callback)
        return { dispose: () => void disposed.splice(disposed.indexOf(callback) >>> 0, 1) }
      },
      dispose() {
        panel.dispose()
      },
    }
  }
}
