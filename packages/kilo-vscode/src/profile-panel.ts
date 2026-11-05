// The Profile editor panel, as main's SettingsEditorProvider opens it: one "Kilo Profile" tab in the active editor
// column, revealed again when it exists and restored after a window reload. It loads the same webview bundle as the
// sidebar with the profile root view.
import type { ExtensionContext } from "vscode"
import { editorPanel } from "./editor-panel"
import type { Manager } from "./server"

export function profile(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const base = editorPanel({
    context: input.context,
    server: input.server,
    directory: input.directory,
    type: TYPE,
    title: "Kilo Profile",
    view: "profile",
  })
  return {
    open: base.open,
    dispose: base.dispose,
  }
}

const TYPE = "kilo-code.v2.profilePanel"
