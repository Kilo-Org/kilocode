/**
 * Types for extension <-> webview message communication
 */

// Connection states
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"

// Session status (simplified from backend)
export type SessionStatus = "idle" | "busy" | "retry"

// Rich status info for retry countdown and future extensions
export type SessionStatusInfo =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number }

// Tool state for tool parts
export type ToolState =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string }
  | { status: "error"; input: Record<string, unknown>; error: string }

// Base part interface - all parts have these fields
export interface BasePart {
  id: string
  sessionID?: string
  messageID?: string
}

// Part types from the backend
export interface TextPart extends BasePart {
  type: "text"
  text: string
}

export interface ToolPart extends BasePart {
  type: "tool"
  tool: string
  state: ToolState
}

export interface ReasoningPart extends BasePart {
  type: "reasoning"
  text: string
}

// Step parts from the backend
export interface StepStartPart extends BasePart {
  type: "step-start"
}

export interface StepFinishPart extends BasePart {
  type: "step-finish"
  reason?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning?: number
    cache?: { read: number; write: number }
  }
}

export type Part = TextPart | ToolPart | ReasoningPart | StepStartPart | StepFinishPart

// Part delta for streaming updates
export interface PartDelta {
  type: "text-delta"
  textDelta?: string
}

// Token usage for assistant messages
export interface TokenUsage {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

// Context usage derived from the last assistant message's tokens
export interface ContextUsage {
  tokens: number
  percentage: number | null
}

// Message structure (simplified for webview)
export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  content?: string
  parts?: Part[]
  createdAt: string
  cost?: number
  tokens?: TokenUsage
}

// Session info (simplified for webview)
export interface SessionInfo {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
}

// Permission request
export interface PermissionRequest {
  id: string
  sessionID: string
  toolName: string
  patterns: string[]
  args: Record<string, unknown>
  message?: string
  tool?: { messageID: string; callID: string }
}

// Todo item
export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}

// Question types
export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

// Agent/mode info from CLI backend
export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  color?: string
}

// Server info
export interface ServerInfo {
  port: number
  version?: string
}

// Device auth flow status
export type DeviceAuthStatus = "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"

// Device auth state
export interface DeviceAuthState {
  status: DeviceAuthStatus
  code?: string
  verificationUrl?: string
  expiresIn?: number
  error?: string
}

// Profile types from kilo-gateway
export interface KilocodeBalance {
  balance: number
}

export interface ProfileData {
  profile: {
    email: string
    name?: string
    organizations?: Array<{ id: string; name: string; role: string }>
  }
  balance: KilocodeBalance | null
  currentOrgId: string | null
}

// Provider/model types for model selector

export interface ProviderModel {
  id: string
  name: string
  inputPrice?: number
  outputPrice?: number
  contextLength?: number
  releaseDate?: string
  latest?: boolean
  // Actual shape returned by the server (Provider.Model)
  limit?: { context: number; input?: number; output: number }
}

export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

// ============================================
// Backend Config Types (mirrored for webview)
// ============================================

export type PermissionLevel = "allow" | "ask" | "deny"

export type PermissionConfig = Partial<Record<string, PermissionLevel>>

export interface AgentConfig {
  model?: string
  prompt?: string
  temperature?: number
  top_p?: number
  steps?: number
  permission?: PermissionConfig
}

export interface ProviderConfig {
  name?: string
  api_key?: string
  base_url?: string
  models?: Record<string, unknown>
}

export interface McpConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface CommandConfig {
  command: string
  description?: string
}

export interface SkillsConfig {
  paths?: string[]
  urls?: string[]
}

export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
}

export interface WatcherConfig {
  ignore?: string[]
}

export interface ExperimentalConfig {
  disable_paste_summary?: boolean
  batch_tool?: boolean
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
}

export interface Config {
  permission?: PermissionConfig
  model?: string
  small_model?: string
  default_agent?: string
  agent?: Record<string, AgentConfig>
  provider?: Record<string, ProviderConfig>
  disabled_providers?: string[]
  enabled_providers?: string[]
  mcp?: Record<string, McpConfig>
  command?: Record<string, CommandConfig>
  instructions?: string[]
  skills?: SkillsConfig
  snapshot?: boolean
  share?: "manual" | "auto" | "disabled"
  username?: string
  watcher?: WatcherConfig
  formatter?: false | Record<string, unknown>
  lsp?: false | Record<string, unknown>
  compaction?: CompactionConfig
  tools?: Record<string, boolean>
  layout?: "auto" | "stretch"
  experimental?: ExperimentalConfig
}

// ============================================
// Messages FROM extension TO webview
// ============================================

export interface ReadyMessage {
  type: "ready"
  serverInfo?: ServerInfo
  extensionVersion?: string
  vscodeLanguage?: string
  languageOverride?: string
}

export interface ConnectionStateMessage {
  type: "connectionState"
  state: ConnectionState
  error?: string
}

export interface ErrorMessage {
  type: "error"
  message: string
  code?: string
}

export interface PartUpdatedMessage {
  type: "partUpdated"
  sessionID?: string
  messageID?: string
  part: Part
  delta?: PartDelta
}

export interface SessionStatusMessage {
  type: "sessionStatus"
  sessionID: string
  status: SessionStatus
  // Retry fields (present when status === "retry")
  attempt?: number
  message?: string
  next?: number
}

export interface PermissionRequestMessage {
  type: "permissionRequest"
  permission: PermissionRequest
}

export interface TodoUpdatedMessage {
  type: "todoUpdated"
  sessionID: string
  items: TodoItem[]
}

export interface SessionCreatedMessage {
  type: "sessionCreated"
  session: SessionInfo
}

export interface SessionUpdatedMessage {
  type: "sessionUpdated"
  session: SessionInfo
}

export interface SessionDeletedMessage {
  type: "sessionDeleted"
  sessionID: string
}

export interface MessagesLoadedMessage {
  type: "messagesLoaded"
  sessionID: string
  messages: Message[]
}

export interface MessageCreatedMessage {
  type: "messageCreated"
  message: Message
}

export interface SessionsLoadedMessage {
  type: "sessionsLoaded"
  sessions: SessionInfo[]
}

export interface ActionMessage {
  type: "action"
  action: string
}

export interface SetChatBoxMessage {
  type: "setChatBoxMessage"
  text: string
}

export interface TriggerTaskMessage {
  type: "triggerTask"
  text: string
}

export interface ProfileDataMessage {
  type: "profileData"
  data: ProfileData | null
}

export interface DeviceAuthStartedMessage {
  type: "deviceAuthStarted"
  code?: string
  verificationUrl: string
  expiresIn: number
}

export interface DeviceAuthCompleteMessage {
  type: "deviceAuthComplete"
}

export interface DeviceAuthFailedMessage {
  type: "deviceAuthFailed"
  error: string
}

export interface DeviceAuthCancelledMessage {
  type: "deviceAuthCancelled"
}

export interface NavigateMessage {
  type: "navigate"
  view: "newTask" | "marketplace" | "history" | "profile" | "settings"
}

export interface ProvidersLoadedMessage {
  type: "providersLoaded"
  providers: Record<string, Provider>
  connected: string[]
  defaults: Record<string, string>
  defaultSelection: ModelSelection
}

export interface AgentsLoadedMessage {
  type: "agentsLoaded"
  agents: AgentInfo[]
  defaultAgent: string
}

export interface AutocompleteSettingsLoadedMessage {
  type: "autocompleteSettingsLoaded"
  settings: {
    enableAutoTrigger: boolean
    enableSmartInlineTaskKeybinding: boolean
    enableChatAutocomplete: boolean
  }
}

export interface ChatCompletionResultMessage {
  type: "chatCompletionResult"
  text: string
  requestId: string
}

export interface FileSearchResultMessage {
  type: "fileSearchResult"
  paths: string[]
  dir: string
  requestId: string
}

export interface QuestionRequestMessage {
  type: "questionRequest"
  question: QuestionRequest
}

export interface QuestionResolvedMessage {
  type: "questionResolved"
  requestID: string
}

export interface QuestionErrorMessage {
  type: "questionError"
  requestID: string
}

export interface BrowserSettings {
  enabled: boolean
  useSystemChrome: boolean
  headless: boolean
}

export interface BrowserSettingsLoadedMessage {
  type: "browserSettingsLoaded"
  settings: BrowserSettings
}

export interface ConfigLoadedMessage {
  type: "configLoaded"
  config: Config
}

export interface ConfigUpdatedMessage {
  type: "configUpdated"
  config: Config
}

export interface NotificationSettingsLoadedMessage {
  type: "notificationSettingsLoaded"
  settings: {
    notifyAgent: boolean
    notifyPermissions: boolean
    notifyErrors: boolean
    soundAgent: string
    soundPermissions: string
    soundErrors: string
  }
}

// Agent Manager worktree session metadata
export interface AgentManagerSessionMetaMessage {
  type: "agentManager.sessionMeta"
  sessionId: string
  mode: import("../context/worktree-mode").SessionMode
  branch?: string
  path?: string
  parentBranch?: string
}

// Agent Manager repo info (current branch of the main workspace)
export interface AgentManagerRepoInfoMessage {
  type: "agentManager.repoInfo"
  branch: string
}

// Agent Manager worktree setup progress
export interface AgentManagerWorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  status: "creating" | "starting" | "ready" | "error"
  message: string
  sessionId?: string
  branch?: string
}

// Agent Manager worktree state types (mirrored from WorktreeStateManager)
export interface WorktreeState {
  id: string
  branch: string
  path: string
  parentBranch: string
  createdAt: string
}

export interface ManagedSessionState {
  id: string
  worktreeId: string | null
  createdAt: string
}

// Agent Manager session added to an existing worktree (no setup overlay needed)
export interface AgentManagerSessionAddedMessage {
  type: "agentManager.sessionAdded"
  sessionId: string
  worktreeId: string
}

// Full state push from extension to webview
export interface AgentManagerStateMessage {
  type: "agentManager.state"
  worktrees: WorktreeState[]
  sessions: ManagedSessionState[]
}

export type ExtensionMessage =
  | ReadyMessage
  | ConnectionStateMessage
  | ErrorMessage
  | PartUpdatedMessage
  | SessionStatusMessage
  | PermissionRequestMessage
  | TodoUpdatedMessage
  | SessionCreatedMessage
  | SessionUpdatedMessage
  | SessionDeletedMessage
  | MessagesLoadedMessage
  | MessageCreatedMessage
  | SessionsLoadedMessage
  | ActionMessage
  | ProfileDataMessage
  | DeviceAuthStartedMessage
  | DeviceAuthCompleteMessage
  | DeviceAuthFailedMessage
  | DeviceAuthCancelledMessage
  | NavigateMessage
  | ProvidersLoadedMessage
  | AgentsLoadedMessage
  | AutocompleteSettingsLoadedMessage
  | ChatCompletionResultMessage
  | FileSearchResultMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | QuestionErrorMessage
  | BrowserSettingsLoadedMessage
  | ConfigLoadedMessage
  | ConfigUpdatedMessage
  | NotificationSettingsLoadedMessage
  | AgentManagerSessionMetaMessage
  | AgentManagerRepoInfoMessage
  | AgentManagerWorktreeSetupMessage
  | AgentManagerSessionAddedMessage
  | AgentManagerStateMessage
  | SetChatBoxMessage
  | TriggerTaskMessage

// ============================================
// Messages FROM webview TO extension
// ============================================

export interface FileAttachment {
  mime: string
  url: string
}

export interface SendMessageRequest {
  type: "sendMessage"
  text: string
  sessionID?: string
  providerID?: string
  modelID?: string
  agent?: string
  files?: FileAttachment[]
}

export interface AbortRequest {
  type: "abort"
  sessionID: string
}

export interface PermissionResponseRequest {
  type: "permissionResponse"
  permissionId: string
  sessionID: string
  response: "once" | "always" | "reject"
}

export interface CreateSessionRequest {
  type: "createSession"
}

export interface ClearSessionRequest {
  type: "clearSession"
}

export interface LoadMessagesRequest {
  type: "loadMessages"
  sessionID: string
}

export interface LoadSessionsRequest {
  type: "loadSessions"
}

export interface LoginRequest {
  type: "login"
}

export interface LogoutRequest {
  type: "logout"
}

export interface RefreshProfileRequest {
  type: "refreshProfile"
}

export interface OpenExternalRequest {
  type: "openExternal"
  url: string
}

export interface CancelLoginRequest {
  type: "cancelLogin"
}

export interface SetOrganizationRequest {
  type: "setOrganization"
  organizationId: string | null
}

export interface WebviewReadyRequest {
  type: "webviewReady"
}

export interface RequestProvidersMessage {
  type: "requestProviders"
}

export interface CompactRequest {
  type: "compact"
  sessionID: string
  providerID?: string
  modelID?: string
}

export interface RequestAgentsMessage {
  type: "requestAgents"
}

export interface SetLanguageRequest {
  type: "setLanguage"
  locale: string
}

export interface QuestionReplyRequest {
  type: "questionReply"
  requestID: string
  answers: string[][]
}

export interface QuestionRejectRequest {
  type: "questionReject"
  requestID: string
}

export interface DeleteSessionRequest {
  type: "deleteSession"
  sessionID: string
}

export interface RenameSessionRequest {
  type: "renameSession"
  sessionID: string
  title: string
}

export interface RequestAutocompleteSettingsMessage {
  type: "requestAutocompleteSettings"
}

export interface UpdateAutocompleteSettingMessage {
  type: "updateAutocompleteSetting"
  key: "enableAutoTrigger" | "enableSmartInlineTaskKeybinding" | "enableChatAutocomplete"
  value: boolean
}

export interface RequestChatCompletionMessage {
  type: "requestChatCompletion"
  text: string
  requestId: string
}

export interface RequestFileSearchMessage {
  type: "requestFileSearch"
  query: string
  requestId: string
}

export interface ChatCompletionAcceptedMessage {
  type: "chatCompletionAccepted"
  suggestionLength?: number
}
export interface UpdateSettingRequest {
  type: "updateSetting"
  key: string
  value: unknown
}

export interface RequestBrowserSettingsMessage {
  type: "requestBrowserSettings"
}

export interface RequestConfigMessage {
  type: "requestConfig"
}

export interface UpdateConfigMessage {
  type: "updateConfig"
  config: Partial<Config>
}

export interface RequestNotificationSettingsMessage {
  type: "requestNotificationSettings"
}

export interface ResetAllSettingsRequest {
  type: "resetAllSettings"
}

export interface SyncSessionRequest {
  type: "syncSession"
  sessionID: string
}

// Agent Manager worktree messages
export interface CreateWorktreeSessionRequest {
  type: "agentManager.createWorktreeSession"
  text: string
  providerID?: string
  modelID?: string
  agent?: string
  files?: FileAttachment[]
}

export interface TelemetryRequest {
  type: "telemetry"
  event: string
  properties?: Record<string, unknown>
}

// Create a new worktree (with auto-created first session)
export interface CreateWorktreeRequest {
  type: "agentManager.createWorktree"
}

// Delete a worktree and dissociate its sessions
export interface DeleteWorktreeRequest {
  type: "agentManager.deleteWorktree"
  worktreeId: string
}

// Promote a session: create a worktree and move the session into it
export interface PromoteSessionRequest {
  type: "agentManager.promoteSession"
  sessionId: string
}

// Add a new session to an existing worktree
export interface AddSessionToWorktreeRequest {
  type: "agentManager.addSessionToWorktree"
  worktreeId: string
}

// Close (remove) a session from its worktree
export interface CloseSessionRequest {
  type: "agentManager.closeSession"
  sessionId: string
}

export interface RequestRepoInfoMessage {
  type: "agentManager.requestRepoInfo"
}

// Show terminal for a session
export interface ShowTerminalRequest {
  type: "agentManager.showTerminal"
  sessionId: string
}

export type WebviewMessage =
  | SendMessageRequest
  | AbortRequest
  | PermissionResponseRequest
  | CreateSessionRequest
  | ClearSessionRequest
  | LoadMessagesRequest
  | LoadSessionsRequest
  | LoginRequest
  | LogoutRequest
  | RefreshProfileRequest
  | OpenExternalRequest
  | CancelLoginRequest
  | SetOrganizationRequest
  | WebviewReadyRequest
  | RequestProvidersMessage
  | CompactRequest
  | RequestAgentsMessage
  | SetLanguageRequest
  | QuestionReplyRequest
  | QuestionRejectRequest
  | DeleteSessionRequest
  | RenameSessionRequest
  | RequestAutocompleteSettingsMessage
  | UpdateAutocompleteSettingMessage
  | RequestChatCompletionMessage
  | RequestFileSearchMessage
  | ChatCompletionAcceptedMessage
  | UpdateSettingRequest
  | RequestBrowserSettingsMessage
  | RequestConfigMessage
  | UpdateConfigMessage
  | RequestNotificationSettingsMessage
  | ResetAllSettingsRequest
  | SyncSessionRequest
  | CreateWorktreeSessionRequest
  | CreateWorktreeRequest
  | DeleteWorktreeRequest
  | PromoteSessionRequest
  | AddSessionToWorktreeRequest
  | CloseSessionRequest
  | TelemetryRequest
  | RequestRepoInfoMessage
  | ShowTerminalRequest

// ============================================
// VS Code API type
// ============================================

export interface VSCodeAPI {
  postMessage(message: WebviewMessage): void
  getState(): unknown
  setState(state: unknown): void
}

declare global {
  function acquireVsCodeApi(): VSCodeAPI
}
