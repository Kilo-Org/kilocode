// The Settings editor panel, as main's SettingsEditorProvider opens it: one "Kilo Settings" tab in the active editor
// column, revealed again when it exists and restored after a window reload. It loads the same webview bundle as the
// sidebar with the settings root view.
import { Uri, ViewColumn, window, type Disposable, type ExtensionContext, type WebviewPanel } from "vscode"
import { wire } from "./chat"
import type { Manager } from "./server"

export function settings(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const state: { panel?: WebviewPanel } = {}
  const attach = (panel: WebviewPanel) => {
    const root = input.context.extensionUri
    panel.iconPath = {
      light: Uri.joinPath(root, "assets", "icons", "kilo-light.svg"),
      dark: Uri.joinPath(root, "assets", "icons", "kilo-dark.svg"),
    }
    state.panel = panel
    const surface = wire({ ...input, webview: panel.webview, view: "settings" })
    panel.onDidDispose(() => {
      surface.dispose()
      if (state.panel === panel) state.panel = undefined
    })
  }
  const serializer: Disposable = window.registerWebviewPanelSerializer(TYPE, {
    deserializeWebviewPanel: async (panel) => attach(panel),
  })
  return {
    open() {
      if (state.panel) return state.panel.reveal(ViewColumn.Active)
      attach(
        window.createWebviewPanel(TYPE, "Kilo Settings", ViewColumn.Active, {
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      )
    },
    // The panel stays open on deactivation, so a window reload restores it through the serializer.
    dispose: () => serializer.dispose(),
  }
}

const TYPE = "kilo-code.v2.settingsPanel"
