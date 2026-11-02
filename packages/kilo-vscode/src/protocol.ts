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

/**
 * A single-file diff that the host can render natively. The shape matches `ToolActionDiff` in `@kilocode/kilo-ui`;
 * it is not imported from there, because the Solid UI package must not enter the Node host typecheck.
 */
export type ToolActionDiff = { file: string; patch: string; additions: number; deletions: number }

/**
 * The effective Kilo policy values that the config API does not carry, because they are Kilo-only fields on the
 * upstream config schema. `managed` is true when a config document outside the writable global and project files
 * sets the value, for example a system or MDM document.
 */
export type ConfigPolicy = { hidePromptTrainingModels: boolean; managed: boolean }

/**
 * Where the Settings panel should go. `focus` names a row that a subtab renders itself (an MCP server), while
 * `titleKey` names a row by its i18n key so the panel can scroll to it after the tab renders.
 */
export type SettingsNavigation = {
  tab?: string
  subtab?: string
  focus?: string
  titleKey?: string
  search?: boolean
}

export type ToHost =
  | Request
  | { type: "abort"; id: number }
  | { type: "open"; url: string }
  | Ui
  | Settings
  | ({ type: "openSettingsTab" } & SettingsNavigation)
  | { type: "settingsReady" }
  | { type: "settingsTabChanged"; tab: string }
  | { type: "requestChatCompletion"; text: string; requestId: string }
  | { type: "chatCompletionAccepted"; suggestionLength?: number }

/** Messages of the copied v1 UI. The host ignores `webviewFocusChanged` and `setLanguage` for now. */
export type Ui =
  | { type: "copyToClipboard"; id: string; text: string }
  | { type: "requestModelSelectorExpanded" }
  | { type: "persistModelSelectorExpanded"; value: boolean }
  | { type: "requestAutoApproveState" }
  | { type: "persistAutoApproveState"; value: boolean }
  | { type: "trackCostSession"; sessionID: string }
  | { type: "webviewFocusChanged"; focused: boolean }
  | { type: "setLanguage"; locale: string }
  | { type: "saveImage"; dataUrl: string; filename: string }
  | { type: "openProfile" }
  | { type: "openToolFile"; filePath: string; line?: number; column?: number; sessionID?: string }
  | { type: "openDiffVirtual"; diff: ToolActionDiff; initialDiffStyle?: "unified" | "split" }

/** Settings panel messages the host handles directly (it reads and writes the config files). */
export type Settings =
  | { type: "configRead" }
  | { type: "configWrite"; id: number; scope: ConfigScope; edits: ConfigEdit[] }
  | { type: "requestVSCodeSettings" }
  | { type: "updateVSCodeSettings"; values: Record<string, unknown> }
  | { type: "openFile"; path: string }
  | { type: "openVSCodeSettings"; query: string }
  | { type: "resetAllSettings" }
  | FetchCustomProviderModels

/**
 * Lists the models of a custom provider's OpenAI-compatible base URL. The key is one of: `apiKey` (typed in the
 * dialog), `env` (the variable name of an `{env:NAME}` key, read from the server environment) or `providerID` (the
 * stored credential of an existing provider, used only while `baseURL` matches its saved base URL).
 */
export type FetchCustomProviderModels = {
  type: "fetchCustomProviderModels"
  requestId: string
  baseURL: string
  apiKey?: string
  env?: string
  providerID?: string
  headers?: Record<string, string>
  /** The scope that owns the provider: the host resolves its own config file for `{file:...}` header references. */
  scope?: "global" | "project"
}

export type ToWebview =
  | { type: "response"; id: number; status: number; statusText: string; headers: [string, string][] }
  | { type: "chunk"; id: number; data: Uint8Array }
  | { type: "end"; id: number }
  | { type: "error"; id: number; message: string }
  | { type: "command"; name: "newSession" | "history" | "profile" | "cycleAgentMode" | "cyclePreviousAgentMode" }
  | ({ type: "navigate" } & SettingsNavigation)
  | { type: "keybindings"; bindings: Record<string, string> }
  | { type: "clipboardWriteResult"; id: string; ok: boolean; error?: string }
  | { type: "modelSelectorExpandedLoaded"; value: boolean }
  | { type: "autoApproveStateLoaded"; value: boolean }
  | { type: "webviewActiveChanged"; active: boolean }
  | { type: "configLoaded"; global: ConfigFileContent; project: ConfigFileContent; policy?: ConfigPolicy; error?: string }
  | { type: "configWritten"; id: number; ok: boolean; error?: string }
  | { type: "vscodeSettingsLoaded"; values: Record<string, unknown> }
  /** The reply to `fetchCustomProviderModels`: `models`, or `error` with `auth` set when the server refused the key. */
  | {
      type: "customProviderModelsFetched"
      requestId: string
      models?: { id: string; name: string }[]
      error?: string
      auth?: boolean
    }
  | { type: "chatCompletionResult"; text: string; requestId: string }
