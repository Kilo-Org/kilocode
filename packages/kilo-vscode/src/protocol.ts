// Messages between the webview and the extension host. The webview has no server credentials: it sends HTTP
// requests through the host (`fetch`), and the host streams each response back in order.

export type Request = {
  type: "fetch"
  id: number
  /** Path and query, for example `/api/session?limit=50`. */
  path: string
  method: string
  headers: [string, string][]
  body?: string
}

/** One config write: `path` is the config key path, `value` undefined removes it. `preserveAliases` keeps v1 keys. */
export type ConfigEdit = { path: string[]; value?: unknown; preserveAliases?: boolean }

export type ConfigScope = "global" | "project"

export type ConfigFileContent = { path: string; text: string }

export type ToHost =
  | Request
  | { type: "abort"; id: number }
  | { type: "open"; url: string }
  | Ui
  | Settings

/** Messages of the copied v1 UI. The host ignores `webviewFocusChanged` and `setLanguage` for now. */
export type Ui =
  | { type: "copyToClipboard"; id: string; text: string }
  | { type: "requestModelSelectorExpanded" }
  | { type: "persistModelSelectorExpanded"; value: boolean }
  | { type: "requestAutoApproveState" }
  | { type: "persistAutoApproveState"; value: boolean }
  | { type: "webviewFocusChanged"; focused: boolean }
  | { type: "setLanguage"; locale: string }
  | { type: "saveImage"; dataUrl: string; filename: string }
  | { type: "openProfile" }

/** Settings panel messages the host handles directly (it reads and writes the config files). */
export type Settings =
  | { type: "configRead" }
  | { type: "configWrite"; id: number; scope: ConfigScope; edits: ConfigEdit[] }
  | { type: "requestVSCodeSettings" }
  | { type: "updateVSCodeSettings"; values: Record<string, unknown> }
  | { type: "openFile"; path: string }
  | { type: "openVSCodeSettings"; query: string }
  | { type: "resetAllSettings" }

export type ToWebview =
  | { type: "response"; id: number; status: number; statusText: string; headers: [string, string][] }
  | { type: "chunk"; id: number; data: Uint8Array }
  | { type: "end"; id: number }
  | { type: "error"; id: number; message: string }
  | { type: "command"; name: "newSession" | "history" | "profile" | "cycleAgentMode" | "cyclePreviousAgentMode" }
  | { type: "keybindings"; bindings: Record<string, string> }
  | { type: "clipboardWriteResult"; id: string; ok: boolean; error?: string }
  | { type: "modelSelectorExpandedLoaded"; value: boolean }
  | { type: "autoApproveStateLoaded"; value: boolean }
  | { type: "webviewActiveChanged"; active: boolean }
  | { type: "configLoaded"; global: ConfigFileContent; project: ConfigFileContent; error?: string }
  | { type: "configWritten"; id: number; ok: boolean; error?: string }
  | { type: "vscodeSettingsLoaded"; values: Record<string, unknown> }
