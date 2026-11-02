// The Settings editor panel, as main's SettingsEditorProvider opens it: one "Kilo Settings" tab in the active editor
// column, revealed again when it exists and restored after a window reload. It loads the same webview bundle as the
// sidebar with the settings root view.
import { Uri, ViewColumn, window, type Disposable, type ExtensionContext, type WebviewPanel } from "vscode"
import { wire } from "./chat"
import type { SettingsNavigation, ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"
import { parseSettingsTarget } from "./settings-navigation"

/** The last tab the user looked at. Workspace state so a closed panel reopens on it, and a new webview can be told
 *  before it finishes loading, which webview state cannot do. */
const TAB = "kilo-code.v2.settingsTab"

export function settings(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  onReset: () => void
}) {
  const state: { panel?: WebviewPanel; post?: (message: ToWebview) => void; target: SettingsNavigation } = {
    target: { tab: input.context.workspaceState.get<string>(TAB) },
  }
  const open = (args: unknown[] = []) => {
    const requested = parseSettingsTarget(args)
    state.target = { ...requested, tab: requested.tab ?? input.context.workspaceState.get<string>(TAB) }
    if (state.target.tab) void input.context.workspaceState.update(TAB, state.target.tab)
    if (state.panel) {
      state.panel.reveal(ViewColumn.Active)
      state.post?.({ type: "navigate", ...state.target })
      return state.panel
    }
    return attach(
      window.createWebviewPanel(TYPE, "Kilo Settings", ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    )
  }
  // A webview that just loaded, or reloaded, asks for the current target. A reload therefore keeps the tab the user
  // opened, not the one the panel was created with.
  const handle = (message: ToHost) => {
    if (message.type === "settingsReady") {
      state.post?.({ type: "navigate", ...state.target })
      return true
    }
    if (message.type === "settingsTabChanged") {
      state.target = { tab: message.tab }
      void input.context.workspaceState.update(TAB, message.tab)
      return true
    }
    return false
  }
  // The panel stays open on deactivation, so a window reload restores it through the serializer.
  const serializer: Disposable = window.registerWebviewPanelSerializer(TYPE, {
    deserializeWebviewPanel: async (panel) => {
      attach(panel)
    },
  })
  return {
    open,
    dispose: () => serializer.dispose(),
  }

  function attach(panel: WebviewPanel) {
    const root = input.context.extensionUri
    panel.iconPath = {
      light: Uri.joinPath(root, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(root, "assets", "icons", "kilo-dark.svg"),
    }
    state.panel = panel
    const surface = wire({ ...input, webview: panel.webview, view: "settings", handle })
    state.post = surface.post
    panel.onDidDispose(() => {
      surface.dispose()
      if (state.panel === panel) state.panel = undefined
      state.post = undefined
    })
    return panel
  }
}

const TYPE = "kilo-code.v2.settingsPanel"
