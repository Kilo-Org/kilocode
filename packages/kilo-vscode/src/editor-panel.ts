// A singleton editor-area webview panel for one Kilo root view: one tab, revealed again when it exists and restored
// after a window reload. The Settings and Profile panels share this host wiring.
import { Uri, ViewColumn, window, type Disposable, type ExtensionContext, type WebviewPanel } from "vscode"
import type { SettingsHandler } from "./agent-manager/project/settings"
import { wire } from "./chat"
import type { ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"

export function editorPanel(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  type: string
  title: string
  view: "settings" | "profile"
  handle?: (message: ToHost) => boolean
  onReset?: () => void
  agentManager?: () => SettingsHandler
}) {
  const state: { panel?: WebviewPanel; post?: (message: ToWebview) => void } = {}
  const serializer: Disposable = window.registerWebviewPanelSerializer(input.type, {
    deserializeWebviewPanel: async (panel) => {
      attach(panel)
    },
  })
  const panel = () => state.panel
  const post = () => state.post
  const reveal = () => state.panel?.reveal(ViewColumn.Active)
  const open = () => {
    if (state.panel) {
      state.panel.reveal(ViewColumn.Active)
      return state.panel
    }
    return attach(
      window.createWebviewPanel(input.type, input.title, ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    )
  }
  return {
    panel,
    post,
    reveal,
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
    const surface = wire({
      context: input.context,
      server: input.server,
      directory: input.directory,
      webview: panel.webview,
      view: input.view,
      handle: input.handle,
      onReset: input.onReset,
      agentManager: input.agentManager,
    })
    state.post = surface.post
    panel.onDidDispose(() => {
      surface.dispose()
      if (state.panel === panel) state.panel = undefined
      state.post = undefined
    })
    return panel
  }
}
