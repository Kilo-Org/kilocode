// The Profile editor panel, as main's SettingsEditorProvider opens it: one "Kilo Profile" tab in the active editor
// column, revealed again when it exists and restored after a window reload. It loads the same webview bundle as the
// sidebar with the profile root view.
import { Uri, ViewColumn, window, type Disposable, type ExtensionContext, type WebviewPanel } from "vscode"
import { wire } from "./chat"
import type { Manager } from "./server"

export function profile(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const state: { panel?: WebviewPanel } = {}
  const open = () => {
    if (state.panel) {
      state.panel.reveal(ViewColumn.Active)
      return state.panel
    }
    return attach(
      window.createWebviewPanel(TYPE, "Kilo Profile", ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
      }),
    )
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
    const surface = wire({ ...input, webview: panel.webview, view: "profile" })
    panel.onDidDispose(() => {
      surface.dispose()
      if (state.panel === panel) state.panel = undefined
    })
    return panel
  }
}

const TYPE = "kilo-code.v2.profilePanel"
