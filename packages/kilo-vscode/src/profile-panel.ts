// The Profile editor panel, as main's SettingsEditorProvider opens it: one "Kilo Profile" tab in the active editor
// column, revealed again when it exists and restored after a window reload. It loads the same webview bundle as the
// sidebar with the profile root view.
import type { ExtensionContext } from "vscode"
import { editorPanel } from "./editor-panel"
import type { ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"

export function profile(input: { context: ExtensionContext; server: Manager; directory: string }) {
  const state = { ready: false, pendingLogin: false }
  const post = (message: ToWebview) => base.post()?.(message)
  // A freshly opened Profile webview asks when it is listening so a login request posted earlier is never lost.
  const handle = (message: ToHost) => {
    if (message.type !== "profileReady") return false
    state.ready = true
    if (state.pendingLogin) {
      state.pendingLogin = false
      post({ type: "profileLogin" })
    }
    return true
  }
  const base = editorPanel({
    context: input.context,
    server: input.server,
    directory: input.directory,
    type: TYPE,
    title: "Kilo Profile",
    view: "profile",
    handle,
  })
  const open = (opts?: { login?: boolean }) => {
    const login = opts?.login === true
    if (base.panel()) {
      base.reveal()
      if (login) {
        if (state.ready) post({ type: "profileLogin" })
        else state.pendingLogin = true
      }
      return base.panel()
    }
    state.ready = false
    state.pendingLogin = login
    return base.open()
  }
  return {
    open,
    dispose: base.dispose,
  }
}

const TYPE = "kilo-code.v2.profilePanel"
