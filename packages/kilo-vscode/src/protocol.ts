// Messages between the webview and the extension host. The webview has no server credentials: it sends HTTP
// requests through the host (`fetch`), and the host streams each response back in order.
import type { ReviewCommentData } from "./shared/review-comments"

import type { BrowserReference } from "./shared/browser-feedback"
import type {
  BrowserCursor,
  BrowserFrame,
  BrowserInteraction,
  BrowserViewIdentity,
  BrowserViewport,
} from "./shared/browser-stream"

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

export type ToolDisplayLayout = "expanded" | "collapsed"

/**
 * How the chat starts each kind of tool block. The three Kilo config keys are not in the config API, so the host
 * reads the config documents and sends the effective values, with the same defaults as v1.
 */
export type DisplaySettings = {
  terminalCommandDisplay: ToolDisplayLayout
  codeEditDisplay: ToolDisplayLayout
  mcpToolDisplay: ToolDisplayLayout
}

export const DISPLAY_DEFAULTS: DisplaySettings = {
  terminalCommandDisplay: "expanded",
  codeEditDisplay: "collapsed",
  mcpToolDisplay: "collapsed",
}

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
  /** Agent Manager project a project-scoped tab opens for, so the gear preselects it. */
  projectId?: string
}

export type SpeechToTextModel = {
  readonly id: string
  readonly label: string
  readonly provider: string
  readonly verbatim?: boolean
}

export type SpeechSettingKey = "base_url" | "api_key" | "model"

export type SpeechToTextSettings = {
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly model?: string
}

/** `enabled` is whether the composer may show the microphone; `signedIn` is the Gateway account state. */
export type SpeechToTextStatus = {
  readonly enabled: boolean
  readonly remote: boolean
  readonly signedIn: boolean
  readonly source: "gateway" | "custom"
  readonly model: string
  readonly models: SpeechToTextModel[]
  readonly settings: SpeechToTextSettings
  readonly catalogError?: string
}

export type ToHost =
  | Request
  | BrowserTab
  | { type: "sidebar.session"; sessionId?: string }
  | { type: "abort"; id: number }
  | { type: "open"; url: string; external?: boolean }
  | Ui
  | Settings
  | Speech
  | ({ type: "openSettingsTab" } & SettingsNavigation)
  | { type: "settingsReady" }
  | { type: "settingsTabChanged"; tab: string }

/**
 * The editor-tab Integrated Browser. The tab is host-driven: it renders a browser the extension host runs, so every
 * command and event crosses postMessage. `kind` suffixes match `BrowserControlKind` in the host.
 */
export type BrowserTab =
  | { type: "browserTab.ready" }
  | { type: "browserTab.openSettings" }
  | { type: "browserTab.openExternal"; url: string }
  | { type: "browserTab.reference"; sessionId: string; reference: BrowserReference }
  | BrowserScopeMessage<"browserTab.state">
  | BrowserScopeMessage<"browserTab.open"> & { url: string }
  | BrowserScopeMessage<"browserTab.refresh">
  | BrowserScopeMessage<"browserTab.back">
  | BrowserScopeMessage<"browserTab.forward">
  | BrowserScopeMessage<"browserTab.close">
  | BrowserScopeMessage<"browserTab.devtools"> & { theme: "dark" | "light" }
  | BrowserScopeMessage<"browserTab.input"> & BrowserPositionMessage & { click: boolean }
  | BrowserScopeMessage<"browserTab.inspect"> & BrowserPositionMessage & { hover: boolean; requestId: string }
  | BrowserScopeMessage<"browserTab.viewport"> & {
      browserId: string
      navigation: number
      viewport: BrowserViewport
    }
  | BrowserScopeMessage<"browserTab.interact"> & { identity: BrowserViewIdentity; event: BrowserInteraction }
  | BrowserScopeMessage<"browserTab.acknowledge"> & { identity: BrowserViewIdentity; sequence: number }

export type BrowserScopeMessage<Type extends string> = {
  type: Type
  sessionId: string
  projectId?: string
}

export type BrowserPositionMessage = { x: number; y: number; width: number; height: number }

/** The fields every browser state message carries, so a new field reaches the tab as well as the panel. */
export type BrowserStatePayload = BrowserScopeMessage<"browserTab.state"> & {
  browserId: string
  navigation?: number
  status: "starting" | "ready" | "loading" | "error" | "closed"
  inspecting?: boolean
  url?: string
  title?: string
  errors: number
  logs?: string[]
  error?: string
  missing?: "chrome" | "chromium"
  frameError?: string
  back?: boolean
  forward?: boolean
}

export type BrowserElementPayload = {
  tag: string
  id?: string
  classes?: string
  text?: string
  selector?: string
  rect?: { x: number; y: number; width: number; height: number }
  hierarchy?: string[]
  html?: string
  styles?: { color?: string; backgroundColor?: string }
  source?: { file: string; line?: number; column?: number }
}

export type BrowserInspectionPayload = BrowserScopeMessage<"browserTab.inspection"> & {
  requestId: string
  url?: string
  title?: string
  element?: BrowserElementPayload
  logs: string[]
  hover?: boolean
  error?: string
}

export type BrowserFramePayload = BrowserScopeMessage<"browserTab.frame"> & BrowserFrame
export type BrowserCursorPayload = BrowserScopeMessage<"browserTab.cursor"> & BrowserCursor
export type BrowserDevtoolsPayload = BrowserScopeMessage<"browserTab.devtools"> & { browserId: string; url: string }

/** Voice input: the host owns the microphone, the custom endpoint and the Gateway RPC. */
export type Speech =
  | { type: "speechToTextPrewarm" }
  | { type: "speechToTextConfig" }
  | { type: "speechToTextStart"; requestId: string; model: string; language?: string }
  | { type: "speechToTextStop"; requestId: string }
  | { type: "speechToTextCancel"; requestId: string }
  | { type: "speechToTextSave"; requestId: string; key: SpeechSettingKey; value: string }

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
  | { type: "openDiffsVirtual"; diffs: ToolActionDiff[]; initialDiffStyle?: "unified" | "split" }
  | { type: "requestDisplaySettings" }
  | { type: "validateFiles"; id: string; sessionID?: string; paths: string[] }

/** Browser replies. The tab frame and cursor carry the stream, the rest carry state or inspection results. */
export type BrowserOut =
  | BrowserScopeMessage<"browserTab.scope"> & { browserAutomation: boolean }
  | BrowserStatePayload
  | BrowserFramePayload
  | BrowserCursorPayload
  | BrowserInspectionPayload
  | BrowserDevtoolsPayload
  | { type: "browserReference"; reference: BrowserReference }

/** Settings panel messages the host handles directly (it reads and writes the config files). */
export type Settings =
  | { type: "configRead" }
  | { type: "configWrite"; id: number; scope: ConfigScope; edits: ConfigEdit[] }
  | { type: "requestVSCodeSettings" }
  | { type: "updateVSCodeSettings"; values: Record<string, unknown> }
  | { type: "openFile"; path: string }
  | { type: "openVSCodeSettings"; query: string }
  | { type: "resetAllSettings" }
  | AgentManagerSettings
  | FetchCustomProviderModels

/**
 * The Agent Manager rows of the Settings panel. The project is explicit, because the panel edits a project the
 * Agent Manager provider owns, not the panel's own directory. `requestId` guards out-of-order replies.
 */
export type AgentManagerSettings =
  | { type: "agentManagerSettings"; projectId?: string; requestId: string }
  | { type: "agentManagerSettingsBranches"; projectId: string; requestId: string }
  | { type: "agentManagerSetDefaultBaseBranch"; projectId: string; branch?: string; requestId: string }
  | { type: "agentManagerConfigureSetupScript"; projectId: string; requestId: string }

/** One Agent Manager project the project-scoped Settings tab can edit. */
export type AgentManagerSettingsProject = {
  id: string
  root: string
  label: string
  pinned: boolean
  missing: boolean
  defaultBaseBranch?: string
  setupScriptPath?: string
}

/** A branch row of the default base branch picker. */
export type AgentManagerSettingsBranch = {
  name: string
  isLocal: boolean
  isRemote: boolean
  isDefault: boolean
  lastCommitDate?: string
  isCheckedOut?: boolean
}

/** The branch and script data of one Agent Manager project. `branches` is absent when the read failed. */
export type AgentManagerSettingsBranchPayload = {
  projectId: string
  branches?: AgentManagerSettingsBranch[]
  defaultBranch?: string
  configuredBaseBranch?: string
  setupScriptPath?: string
}

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
  | BrowserOut
  | { type: "response"; id: number; status: number; statusText: string; headers: [string, string][] }
  | { type: "chunk"; id: number; data: Uint8Array }
  | { type: "end"; id: number }
  | { type: "error"; id: number; message: string }
  | {
      type: "command"
      name:
        | "newSession"
        | "history"
        | "cycleAgentMode"
        | "cyclePreviousAgentMode"
        | "showOpenTabs"
        | "tabPrevious"
        | "tabNext"
    }
  | ({ type: "navigate" } & SettingsNavigation)
  | { type: "keybindings"; bindings: Record<string, string> }
  | { type: "clipboardWriteResult"; id: string; ok: boolean; error?: string }
  | { type: "modelSelectorExpandedLoaded"; value: boolean }
  | { type: "autoApproveStateLoaded"; value: boolean }
  | { type: "webviewActiveChanged"; active: boolean }
  | { type: "validateFilesResult"; id: string; existing: string[] }
  | { type: "appendReviewComments"; comments: ReviewCommentData[]; autoSend: boolean }
  | {
      type: "configLoaded"
      global: ConfigFileContent
      project: ConfigFileContent
      policy?: ConfigPolicy
      error?: string
    }
  | { type: "configWritten"; id: number; ok: boolean; error?: string }
  | { type: "vscodeSettingsLoaded"; values: Record<string, unknown> }
  | {
      type: "agentManagerSettingsLoaded"
      requestId: string
      projectId?: string
      projects: AgentManagerSettingsProject[]
    }
  | ({
      type: "agentManagerSettingsBranchesLoaded"
      requestId: string
      error?: string
    } & AgentManagerSettingsBranchPayload)
  | { type: "displaySettingsLoaded"; values: DisplaySettings; error?: string }
  | { type: "speechToTextConfigLoaded"; status: SpeechToTextStatus }
  | { type: "speechToTextStarted"; requestId: string }
  | { type: "speechToTextResult"; requestId: string; text: string }
  | { type: "speechToTextError"; requestId: string; error: string; code?: string }
  | { type: "speechToTextCancelled"; requestId: string }
  | { type: "speechToTextSaved"; requestId: string; ok: boolean; error?: string }
  /** The reply to `fetchCustomProviderModels`: `models`, or `error` with `auth` set when the server refused the key. */
  | {
      type: "customProviderModelsFetched"
      requestId: string
      models?: { id: string; name: string }[]
      error?: string
      auth?: boolean
    }
