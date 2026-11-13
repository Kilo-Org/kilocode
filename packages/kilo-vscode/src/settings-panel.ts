// The Settings editor panel, as main's SettingsEditorProvider opens it: one "Kilo Settings" tab in the active editor
// column, revealed again when it exists and restored after a window reload. It loads the same webview bundle as the
// sidebar with the settings root view.
import type { ExtensionContext } from "vscode"
import type { SettingsHandler } from "./agent-manager/project/settings"
import { editorPanel } from "./editor-panel"
import type { SettingsNavigation, ToHost, ToWebview } from "./protocol"
import type { Manager } from "./server"
import { parseSettingsTarget } from "./settings-navigation"

/** The last tab the user looked at. Workspace state so a closed panel reopens on it, and a new webview can be told
 *  before it finishes loading, which webview state cannot do. */
const TAB = "kilo-code.v2.settingsTab"
/** The last Agent Manager project the panel edited, so a reload keeps the project the gear selected. */
const PROJECT = "kilo-code.v2.settingsProject"

export function settings(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  onReset: () => void
  /** The Agent Manager project settings handler, shared with the provider that owns the projects. */
  agentManager?: () => SettingsHandler
}) {
  const state: { target: SettingsNavigation } = {
    target: {
      tab: input.context.workspaceState.get<string>(TAB),
      projectId: input.context.workspaceState.get<string>(PROJECT),
    },
  }
  const post = (message: ToWebview) => base.post()?.(message)
  // A webview that just loaded, or reloaded, asks for the current target. A reload therefore keeps the tab the user
  // opened, not the one the panel was created with.
  const handle = (message: ToHost) => {
    if (message.type === "settingsReady") {
      post({ type: "navigate", ...state.target })
      return true
    }
    if (message.type === "settingsTabChanged") {
      // Switching tabs keeps the project, so returning to a project-scoped tab still edits the same project.
      state.target = { ...state.target, tab: message.tab }
      void input.context.workspaceState.update(TAB, message.tab)
      return true
    }
    return false
  }
  const base = editorPanel({
    context: input.context,
    server: input.server,
    directory: input.directory,
    type: TYPE,
    title: "Kilo Settings",
    view: "settings",
    handle,
    onReset: input.onReset,
    agentManager: input.agentManager,
  })
  const open = (args: unknown[] = []) => {
    const requested = parseSettingsTarget(args)
    state.target = { ...requested, tab: requested.tab ?? input.context.workspaceState.get<string>(TAB) }
    if (state.target.tab) void input.context.workspaceState.update(TAB, state.target.tab)
    if (state.target.projectId) void input.context.workspaceState.update(PROJECT, state.target.projectId)
    if (base.panel()) {
      base.reveal()
      post({ type: "navigate", ...state.target })
      return base.panel()
    }
    return base.open()
  }
  return {
    open,
    dispose: base.dispose,
  }
}

const TYPE = "kilo-code.v2.settingsPanel"
