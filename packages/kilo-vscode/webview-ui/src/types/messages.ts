/**
 * Types for extension <-> webview message communication
 */

import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@kilocode/sdk/v2/client"

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

export interface FilePart extends BasePart {
  type: "file"
  mime: string
  url: string
  filename?: string
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

export type Part = TextPart | FilePart | ToolPart | ReasoningPart | StepStartPart | StepFinishPart

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
  time?: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
  providerID?: string
  modelID?: string
  mode?: string
  parentID?: string
  path?: { cwd: string; root: string }
  error?: { name: string; data?: Record<string, unknown> }
  summary?: { title?: string; body?: string; diffs?: unknown[] } | boolean
  cost?: number
  tokens?: TokenUsage
}

// File diff info (matches Snapshot.FileDiff from CLI backend)
export interface SessionFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

// Session info (simplified for webview)
export interface SessionInfo {
  id: string
  parentID?: string | null
  title?: string
  createdAt: string
  updatedAt: string
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  } | null
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: SessionFileDiff[]
  } | null
}

// Cloud session info (from Kilo cloud API)
export interface CloudSessionInfo {
  session_id: string
  title: string | null
  created_at: string
  updated_at: string
}

// Permission request
export interface PermissionFileDiff {
  file: string
  before?: string
  after?: string
  additions: number
  deletions: number
}

export interface PermissionRequest {
  id: string
  sessionID: string
  toolName: string
  patterns: string[]
  always: string[]
  args: Record<string, unknown> & {
    rules?: string[]
    diff?: string
    filepath?: string
    filediff?: PermissionFileDiff
  }
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
  mode?: string
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

// Skill info from CLI backend
export interface SkillInfo {
  name: string
  description: string
  location: string
}

// Slash command info from CLI backend
export interface SlashCommandInfo {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
  hints: string[]
}

// A single resolved permission rule from the CLI backend (matches PermissionNext.Rule)
export interface PermissionRuleItem {
  permission: string
  pattern: string
  action: PermissionLevel
}

// Agent/mode info from CLI backend
export interface AgentInfo {
  name: string
  displayName?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  deprecated?: boolean
  color?: string
  permission?: PermissionRuleItem[]
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

// Kilo notification types (mirrored from kilo-gateway)
export interface KilocodeNotificationAction {
  actionText: string
  actionURL: string
}

export interface KilocodeNotification {
  id: string
  title: string
  message: string
  action?: KilocodeNotificationAction
  showIn?: string[]
  suggestModelId?: string
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
  variants?: Record<string, Record<string, unknown>>
  capabilities?: {
    reasoning: boolean
    input?: { text: boolean; image: boolean; audio: boolean; video: boolean; pdf: boolean }
  }
  options?: { description?: string }
  recommendedIndex?: number
  isFree?: boolean
  cost?: { input: number; output: number }
}

export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
  source?: "env" | "config" | "custom" | "api"
  env?: string[]
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

export type ProviderAuthState = "api" | "oauth" | "wellknown"

// ============================================
// Backend Config Types (mirrored for webview)
// ============================================

export type PermissionLevel = "allow" | "ask" | "deny"

/** null in a PermissionRule object is a delete sentinel — removes the key from the config */
export type PermissionRule = PermissionLevel | Record<string, PermissionLevel | null>

export type PermissionConfig = Partial<Record<string, PermissionRule>>

export interface AgentConfig {
  model?: string | null
  prompt?: string
  description?: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  disable?: boolean
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
  npm?: string
  env?: string[]
  options?: Record<string, unknown>
}

export interface McpConfig {
  type?: "local" | "remote"
  command?: string[] | string
  args?: string[]
  env?: Record<string, string>
  environment?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export interface CommandConfig {
  template: string
  description?: string
  agent?: string
  model?: string
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
  codebase_search?: boolean
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
}

export interface Config {
  permission?: PermissionConfig
  model?: string | null
  small_model?: string | null
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
  workspaceDirectory?: string
}

export interface WorkspaceDirectoryChangedMessage {
  type: "workspaceDirectoryChanged"
  directory: string
}

export interface LanguageChangedMessage {
  type: "languageChanged"
  locale: string
}

export interface ConnectionStateMessage {
  type: "connectionState"
  state: ConnectionState
  error?: string
  userMessage?: string
  userDetails?: string
}

export interface ErrorMessage {
  type: "error"
  message: string
  code?: string
  sessionID?: string
}

export interface SendMessageFailedMessage {
  type: "sendMessageFailed"
  error: string
  text: string
  sessionID?: string
  draftID?: string
  messageID?: string
  files?: FileAttachment[]
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

export interface SessionErrorMessage {
  type: "sessionError"
  sessionID?: string
  error?: { name: string; data?: Record<string, unknown> }
}

export interface PermissionRequestMessage {
  type: "permissionRequest"
  permission: PermissionRequest
}

export interface PermissionResolvedMessage {
  type: "permissionResolved"
  permissionID: string
}

export interface PermissionErrorMessage {
  type: "permissionError"
  permissionID: string
}

export interface TodoUpdatedMessage {
  type: "todoUpdated"
  sessionID: string
  items: TodoItem[]
}

export interface SessionCreatedMessage {
  type: "sessionCreated"
  session: SessionInfo
  draftID?: string
}

export interface SessionUpdatedMessage {
  type: "sessionUpdated"
  session: SessionInfo
}

export interface SessionDeletedMessage {
  type: "sessionDeleted"
  sessionID: string
}

export interface MessageRemovedMessage {
  type: "messageRemoved"
  sessionID: string
  messageID: string
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

export interface CloudSessionsLoadedMessage {
  type: "cloudSessionsLoaded"
  sessions: CloudSessionInfo[]
  nextCursor: string | null
}

export interface GitRemoteUrlLoadedMessage {
  type: "gitRemoteUrlLoaded"
  gitUrl: string | null
}

export interface CloudSessionDataLoadedMessage {
  type: "cloudSessionDataLoaded"
  cloudSessionId: string
  title: string
  messages: Message[]
}

export interface CloudSessionImportedMessage {
  type: "cloudSessionImported"
  cloudSessionId: string
  session: SessionInfo
}

export interface CloudSessionImportFailedMessage {
  type: "cloudSessionImportFailed"
  cloudSessionId: string
  error: string
}

export interface OpenCloudSessionMessage {
  type: "openCloudSession"
  sessionId: string
}

export interface ActionMessage {
  type: "action"
  action: string
}

export interface SetChatBoxMessage {
  type: "setChatBoxMessage"
  text: string
}

export interface AppendChatBoxMessage {
  type: "appendChatBoxMessage"
  text: string
}

export interface ReviewComment {
  id: string
  file: string
  side: "additions" | "deletions"
  line: number
  comment: string
  selectedText: string
}

export interface AppendReviewCommentsMessage {
  type: "appendReviewComments"
  comments: ReviewComment[]
  autoSend?: boolean
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
  view: "newTask" | "marketplace" | "history" | "profile" | "settings" | "subAgentViewer"
  tab?: string
}

export interface ProvidersLoadedMessage {
  type: "providersLoaded"
  providers: Record<string, Provider>
  connected: string[]
  defaults: Record<string, string>
  defaultSelection: ModelSelection
  authMethods: Record<string, ProviderAuthMethod[]>
  authStates: Record<string, ProviderAuthState>
}

export interface AgentsLoadedMessage {
  type: "agentsLoaded"
  agents: AgentInfo[]
  allAgents: AgentInfo[]
  defaultAgent: string
}

export interface SkillsLoadedMessage {
  type: "skillsLoaded"
  skills: SkillInfo[]
}

export interface CommandsLoadedMessage {
  type: "commandsLoaded"
  commands: SlashCommandInfo[]
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

export interface GlobalConfigLoadedMessage {
  type: "globalConfigLoaded"
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

export interface TimelineSettingLoadedMessage {
  type: "timelineSettingLoaded"
  visible: boolean
}

export interface NotificationsLoadedMessage {
  type: "notificationsLoaded"
  notifications: KilocodeNotification[]
  dismissedIds: string[]
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
  defaultBranch?: string
}

export type WorktreeErrorCode = "git_not_found" | "not_git_repo" | "lfs_missing"

// Agent Manager worktree setup progress
export interface AgentManagerWorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  status: "creating" | "starting" | "ready" | "error"
  message: string
  sessionId?: string
  branch?: string
  worktreeId?: string
  errorCode?: WorktreeErrorCode
}

// Agent Manager worktree state types (mirrored from WorktreeStateManager)
export interface WorktreeState {
  id: string
  branch: string
  path: string
  /** Bare branch name (e.g. "main"), without remote prefix. */
  parentBranch: string
  /** Remote name (e.g. "origin"). */
  remote?: string
  createdAt: string
  /** Shared identifier for worktrees created together via multi-version mode. */
  groupId?: string
  /** User-provided display name for the worktree. */
  label?: string
  /** Cached PR number for instant badge display on reload. */
  prNumber?: number
  /** Cached PR URL for instant badge display on reload. */
  prUrl?: string
  /** Cached PR state for correct badge color on reload (open/merged/closed/draft). */
  prState?: string
  /** Section this worktree belongs to, or undefined for ungrouped. */
  sectionId?: string
}

export interface SectionState {
  id: string
  name: string
  /** Color label (e.g. "Red", "Blue") or null for default. */
  color: string | null
  order: number
  collapsed: boolean
}

// ---------------------------------------------------------------------------
// PR status types (mirrored from extension types.ts)
// ---------------------------------------------------------------------------

export type PRState = "open" | "draft" | "merged" | "closed"
export type ReviewDecision = "approved" | "changes_requested" | "pending"
export type CheckStatus = "success" | "failure" | "pending" | "skipped" | "cancelled"
export type AggregateCheckStatus = "success" | "failure" | "pending" | "none"

export interface PRCheck {
  name: string
  status: CheckStatus
  url?: string
  duration?: string
}

export interface PRComment {
  id: string
  author: string
  avatar?: string
  body: string
  file?: string
  line?: number
  url?: string
  resolved: boolean
  createdAt?: number
}

export interface PRStatus {
  number: number
  title: string
  url: string
  state: PRState
  review: ReviewDecision | null
  checks: {
    status: AggregateCheckStatus
    total: number
    passed: number
    failed: number
    pending: number
    items: PRCheck[]
  }
  comments?: {
    total: number
    unresolved: number
    items: PRComment[]
  }
  additions: number
  deletions: number
  files: number
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

// Agent Manager session forked from an existing session
export interface AgentManagerSessionForkedMessage {
  type: "agentManager.sessionForked"
  sessionId: string
  forkedFromId: string
  worktreeId?: string
}

// Full state push from extension to webview
export interface AgentManagerStateMessage {
  type: "agentManager.state"
  worktrees: WorktreeState[]
  sessions: ManagedSessionState[]
  sections?: SectionState[]
  staleWorktreeIds?: string[]
  tabOrder?: Record<string, string[]>
  worktreeOrder?: string[]
  sessionsCollapsed?: boolean
  reviewDiffStyle?: "unified" | "split"
  isGitRepo?: boolean
  defaultBaseBranch?: string
}

// Resolved keybindings for agent manager actions
export interface AgentManagerKeybindingsMessage {
  type: "agentManager.keybindings"
  bindings: Record<string, string>
}

// Multi-version creation progress (extension → webview)
export interface AgentManagerMultiVersionProgressMessage {
  type: "agentManager.multiVersionProgress"
  status: "creating" | "done"
  total: number
  completed: number
  groupId?: string
}

// Stored variant selections loaded from extension globalState (extension → webview)
export interface VariantsLoadedMessage {
  type: "variantsLoaded"
  variants: Record<string, string>
}

export interface RecentsLoadedMessage {
  type: "recentsLoaded"
  recents: ModelSelection[]
}

export interface FavoritesLoadedMessage {
  type: "favoritesLoaded"
  favorites: ModelSelection[]
}

export interface BranchInfo {
  name: string
  isLocal: boolean
  isRemote: boolean
  isDefault: boolean
  lastCommitDate?: string
  isCheckedOut?: boolean
}

export interface AgentManagerBranchesMessage {
  type: "agentManager.branches"
  branches: BranchInfo[]
  defaultBranch: string
}

// Agent Manager Import tab: external worktrees (extension → webview)
export interface ExternalWorktreeInfo {
  path: string
  branch: string
}

export interface AgentManagerExternalWorktreesMessage {
  type: "agentManager.externalWorktrees"
  worktrees: ExternalWorktreeInfo[]
}

// Agent Manager Import tab: result feedback (extension → webview)
export interface AgentManagerImportResultMessage {
  type: "agentManager.importResult"
  success: boolean
  message: string
  errorCode?: WorktreeErrorCode
}

// Shared FileDiff shape (matches Snapshot.FileDiff from CLI backend)
export interface WorktreeFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
  tracked?: boolean
  generatedLike?: boolean
  summarized?: boolean
  stamp?: string
}

// Agent Manager: Diff data push (extension → webview)
export interface AgentManagerWorktreeDiffMessage {
  type: "agentManager.worktreeDiff"
  sessionId: string
  diffs: WorktreeFileDiff[]
}

export interface AgentManagerWorktreeDiffFileMessage {
  type: "agentManager.worktreeDiffFile"
  sessionId: string
  file: string
  diff: WorktreeFileDiff | null
}

// Agent Manager: Diff loading state (extension → webview)
export interface AgentManagerWorktreeDiffLoadingMessage {
  type: "agentManager.worktreeDiffLoading"
  sessionId: string
  loading: boolean
}

export type AgentManagerApplyWorktreeDiffStatus = "checking" | "applying" | "success" | "conflict" | "error"

export interface AgentManagerApplyWorktreeDiffConflict {
  file?: string
  reason: string
}

export interface AgentManagerApplyWorktreeDiffResultMessage {
  type: "agentManager.applyWorktreeDiffResult"
  worktreeId: string
  status: AgentManagerApplyWorktreeDiffStatus
  message: string
  conflicts?: AgentManagerApplyWorktreeDiffConflict[]
}

// Agent Manager: Revert single file result (extension → webview)
export interface AgentManagerRevertWorktreeFileResultMessage {
  type: "agentManager.revertWorktreeFileResult"
  sessionId: string
  file: string
  status: "success" | "error"
  message: string
}

// Per-worktree git stats: diff additions/deletions and ahead/behind counts
export interface WorktreeGitStats {
  worktreeId: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

// Agent Manager: Worktree git stats push (extension → webview)
export interface AgentManagerWorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  stats: WorktreeGitStats[]
}

// Per-local-workspace git stats: branch name, diff additions/deletions, ahead/behind counts
export interface LocalGitStats {
  branch: string
  files: number
  additions: number
  deletions: number
  ahead: number
  behind: number
}

// Agent Manager: Local workspace git stats push (extension → webview)
export interface AgentManagerLocalStatsMessage {
  type: "agentManager.localStats"
  stats: LocalGitStats
}

// Agent Manager: PR status push (extension → webview)
export interface AgentManagerPRStatusMessage {
  type: "agentManager.prStatus"
  worktreeId: string
  pr: PRStatus | null
  error?: "gh_missing" | "gh_auth" | "fetch_failed"
}

// Sidebar: Live worktree diff stats (extension → webview)
export interface WorktreeStatsLoadedMessage {
  type: "worktreeStatsLoaded"
  files: number
  additions: number
  deletions: number
}

// Set the model for a session (extension → webview, used during multi-version creation)
export interface AgentManagerSetSessionModelMessage {
  type: "agentManager.setSessionModel"
  sessionId: string
  providerID: string
  modelID: string
}

// Request webview to send initial prompt to a newly created session (extension → webview)
export interface AgentManagerSendInitialMessage {
  type: "agentManager.sendInitialMessage"
  sessionId: string
  worktreeId: string
  text?: string
  providerID?: string
  modelID?: string
  agent?: string
  files?: Array<{ mime: string; url: string }>
}

// legacy-migration start
export interface MigrationProviderInfo {
  profileName: string
  provider: string
  model?: string
  hasApiKey: boolean
  supported: boolean
  newProviderName?: string
}

export interface MigrationMcpServerInfo {
  name: string
  type: string
}

export interface MigrationCustomModeInfo {
  name: string
  slug: string
}

export interface LegacyAutocompleteSettings {
  enableAutoTrigger?: boolean
  enableSmartInlineTaskKeybinding?: boolean
  enableChatAutocomplete?: boolean
}

export interface LegacySettings {
  autoApprovalEnabled?: boolean
  allowedCommands?: string[]
  deniedCommands?: string[]
  // Fine-grained auto-approval (legacy globalState keys — no prefix)
  alwaysAllowReadOnly?: boolean
  alwaysAllowReadOnlyOutsideWorkspace?: boolean
  alwaysAllowWrite?: boolean
  alwaysAllowExecute?: boolean
  alwaysAllowMcp?: boolean
  alwaysAllowModeSwitch?: boolean
  alwaysAllowSubtasks?: boolean
  language?: string
  autocomplete?: LegacyAutocompleteSettings
}

export interface MigrationSessionInfo {
  id: string
  title: string
  directory: string
  time: number
}

export interface MigrationResultItem {
  item: string
  category: "provider" | "mcpServer" | "customMode" | "session" | "defaultModel" | "settings"
  status: "success" | "warning" | "error"
  message?: string
}

export interface MigrationStateMessage {
  type: "migrationState"
  needed: boolean
  data?: {
    providers: MigrationProviderInfo[]
    mcpServers: MigrationMcpServerInfo[]
    customModes: MigrationCustomModeInfo[]
    sessions?: MigrationSessionInfo[]
    defaultModel?: { provider: string; model: string }
    settings?: LegacySettings
  }
}

export interface LegacyMigrationDataMessage {
  type: "legacyMigrationData"
  data: {
    providers: MigrationProviderInfo[]
    mcpServers: MigrationMcpServerInfo[]
    customModes: MigrationCustomModeInfo[]
    sessions?: MigrationSessionInfo[]
    defaultModel?: { provider: string; model: string }
    settings?: LegacySettings
  }
}

export interface LegacyMigrationProgressMessage {
  type: "legacyMigrationProgress"
  item: string
  status: "migrating" | "success" | "warning" | "error"
  message?: string
}

export type LegacyMigrationSessionPhase = "preparing" | "storing" | "skipped" | "done" | "summary" | "error"

export interface LegacyMigrationSessionProgressMessage {
  type: "legacyMigrationSessionProgress"
  session: MigrationSessionInfo
  index: number
  total: number
  phase: LegacyMigrationSessionPhase
  error?: string
}

export interface LegacyMigrationCompleteMessage {
  type: "legacyMigrationComplete"
  results: MigrationResultItem[]
}

export interface RequestLegacyMigrationDataMessage {
  type: "requestLegacyMigrationData"
}

export interface MigrationAutoApprovalSelections {
  commandRules: boolean
  readPermission: boolean
  writePermission: boolean
  executePermission: boolean
  mcpPermission: boolean
  taskPermission: boolean
}

export interface MigrationSessionSelection {
  id: string
  force?: boolean
}

export interface StartLegacyMigrationMessage {
  type: "startLegacyMigration"
  selections: {
    providers: string[]
    mcpServers: string[]
    customModes: string[]
    sessions?: MigrationSessionSelection[]
    defaultModel: boolean
    settings: {
      autoApproval: MigrationAutoApprovalSelections
      language: boolean
      autocomplete: boolean
    }
  }
}

export interface SkipLegacyMigrationMessage {
  type: "skipLegacyMigration"
}

export interface ClearLegacyDataMessage {
  type: "clearLegacyData"
}

export interface FinalizeLegacyMigrationMessage {
  type: "finalizeLegacyMigration"
}
// legacy-migration end

// Enhance prompt result (extension → webview)
export interface EnhancePromptResultMessage {
  type: "enhancePromptResult"
  text: string
  requestId: string
}

// Enhance prompt error (extension → webview)
export interface EnhancePromptErrorMessage {
  type: "enhancePromptError"
  error: string
  requestId: string
}

// Sub-agent viewer: open a child session in read-only mode (extension → webview)
export interface ViewSubAgentSessionMessage {
  type: "viewSubAgentSession"
  sessionID: string
}

export interface DiffViewerDiffsMessage {
  type: "diffViewer.diffs"
  diffs: WorktreeFileDiff[]
}

export interface DiffViewerLoadingMessage {
  type: "diffViewer.loading"
  loading: boolean
}

export interface ClearPendingPromptsMessage {
  type: "clearPendingPrompts"
}

export interface ExtensionDataReadyMessage {
  type: "extensionDataReady"
}

// ============================================
// Marketplace Messages
// ============================================

import type {
  MarketplaceItem,
  MarketplaceInstalledMetadata,
  InstallMarketplaceItemOptions,
  MarketplaceFilters,
} from "./marketplace"

export interface MarketplaceDataMessage {
  type: "marketplaceData"
  marketplaceItems: MarketplaceItem[]
  marketplaceInstalledMetadata: MarketplaceInstalledMetadata
  errors?: string[]
}

export interface MarketplaceInstallResultMessage {
  type: "marketplaceInstallResult"
  success: boolean
  slug: string
  error?: string
}

export interface MarketplaceRemoveResultMessage {
  type: "marketplaceRemoveResult"
  success: boolean
  slug: string
  error?: string
}

export interface FetchMarketplaceDataMessage {
  type: "fetchMarketplaceData"
}

export interface FilterMarketplaceItemsMessage {
  type: "filterMarketplaceItems"
  filters: MarketplaceFilters
}

export interface InstallMarketplaceItemMessage {
  type: "installMarketplaceItem"
  mpItem: MarketplaceItem
  mpInstallOptions: InstallMarketplaceItemOptions
}

export interface RemoveInstalledMarketplaceItemMessage {
  type: "removeInstalledMarketplaceItem"
  mpItem: MarketplaceItem
  mpInstallOptions: InstallMarketplaceItemOptions
}

export interface ProviderOAuthReadyMessage {
  type: "providerOAuthReady"
  requestId: string
  providerID: string
  authorization: ProviderAuthAuthorization
}

export interface ProviderConnectedMessage {
  type: "providerConnected"
  requestId: string
  providerID: string
}

export interface ProviderDisconnectedMessage {
  type: "providerDisconnected"
  requestId: string
  providerID: string
}

export interface ProviderActionErrorMessage {
  type: "providerActionError"
  requestId: string
  providerID: string
  action: "authorize" | "connect" | "disconnect"
  message: string
}

export interface CustomProviderModelsFetchedMessage {
  type: "customProviderModelsFetched"
  requestId: string
  models?: Array<{ id: string; name: string }>
  error?: string
  /** True when error was HTTP 401/403 — hints the user to check their API key */
  auth?: boolean
}

export type ExtensionMessage =
  | ReadyMessage
  | ConnectionStateMessage
  | ErrorMessage
  | SendMessageFailedMessage
  | PartUpdatedMessage
  | SessionStatusMessage
  | SessionErrorMessage
  | PermissionRequestMessage
  | PermissionResolvedMessage
  | PermissionErrorMessage
  | TodoUpdatedMessage
  | SessionCreatedMessage
  | SessionUpdatedMessage
  | SessionDeletedMessage
  | MessageRemovedMessage
  | MessagesLoadedMessage
  | MessageCreatedMessage
  | SessionsLoadedMessage
  | CloudSessionsLoadedMessage
  | GitRemoteUrlLoadedMessage
  | ActionMessage
  | ProfileDataMessage
  | DeviceAuthStartedMessage
  | DeviceAuthCompleteMessage
  | DeviceAuthFailedMessage
  | DeviceAuthCancelledMessage
  | NavigateMessage
  | ProvidersLoadedMessage
  | AgentsLoadedMessage
  | SkillsLoadedMessage
  | CommandsLoadedMessage
  | AutocompleteSettingsLoadedMessage
  | ChatCompletionResultMessage
  | FileSearchResultMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | QuestionErrorMessage
  | BrowserSettingsLoadedMessage
  | ClaudeCompatSettingLoadedMessage
  | ConfigLoadedMessage
  | ConfigUpdatedMessage
  | GlobalConfigLoadedMessage
  | NotificationSettingsLoadedMessage
  | TimelineSettingLoadedMessage
  | NotificationsLoadedMessage
  | AgentManagerSessionMetaMessage
  | AgentManagerRepoInfoMessage
  | AgentManagerWorktreeSetupMessage
  | AgentManagerSessionAddedMessage
  | AgentManagerSessionForkedMessage
  | AgentManagerStateMessage
  | AgentManagerKeybindingsMessage
  | AgentManagerMultiVersionProgressMessage
  | AgentManagerSetSessionModelMessage
  | AgentManagerSendInitialMessage
  | SetChatBoxMessage
  | AppendChatBoxMessage
  | AppendReviewCommentsMessage
  | TriggerTaskMessage
  | VariantsLoadedMessage
  | CloudSessionDataLoadedMessage
  | CloudSessionImportedMessage
  | CloudSessionImportFailedMessage
  | OpenCloudSessionMessage
  | AgentManagerBranchesMessage
  | AgentManagerExternalWorktreesMessage
  | AgentManagerImportResultMessage
  | WorkspaceDirectoryChangedMessage
  | AgentManagerWorktreeDiffMessage
  | AgentManagerWorktreeDiffFileMessage
  | AgentManagerWorktreeDiffLoadingMessage
  | AgentManagerApplyWorktreeDiffResultMessage
  | AgentManagerRevertWorktreeFileResultMessage
  | AgentManagerWorktreeStatsMessage
  | AgentManagerLocalStatsMessage
  | AgentManagerPRStatusMessage
  // legacy-migration start
  | MigrationStateMessage
  | LegacyMigrationDataMessage
  | LegacyMigrationProgressMessage
  | LegacyMigrationSessionProgressMessage
  | LegacyMigrationCompleteMessage
  // legacy-migration end
  | EnhancePromptResultMessage
  | EnhancePromptErrorMessage
  | ViewSubAgentSessionMessage
  | DiffViewerDiffsMessage
  | DiffViewerLoadingMessage
  | MarketplaceDataMessage
  | MarketplaceInstallResultMessage
  | MarketplaceRemoveResultMessage
  | ProviderOAuthReadyMessage
  | ProviderConnectedMessage
  | ProviderDisconnectedMessage
  | ProviderActionErrorMessage
  | CustomProviderModelsFetchedMessage
  | RecentsLoadedMessage
  | FavoritesLoadedMessage
  | LanguageChangedMessage
  | ContinueInWorktreeProgressMessage
  | WorktreeStatsLoadedMessage
  | McpStatusLoadedMessage
  | ClearPendingPromptsMessage
  | ExtensionDataReadyMessage

// ============================================
// Messages FROM webview TO extension
// ============================================

export interface FileAttachment {
  mime: string
  url: string
  filename?: string
}

export interface SendMessageRequest {
  type: "sendMessage"
  text: string
  messageID?: string
  sessionID?: string
  draftID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: FileAttachment[]
}

export interface AbortRequest {
  type: "abort"
  sessionID: string
}

export interface RevertSessionRequest {
  type: "revertSession"
  sessionID: string
  messageID: string
}

export interface UnrevertSessionRequest {
  type: "unrevertSession"
  sessionID: string
}

export interface PermissionResponseRequest {
  type: "permissionResponse"
  permissionId: string
  sessionID: string
  response: "once" | "always" | "reject"
  approvedAlways: string[]
  deniedAlways: string[]
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

export interface RequestCloudSessionsMessage {
  type: "requestCloudSessions"
  cursor?: string
  limit?: number
  gitUrl?: string
}

export interface RequestGitRemoteUrlMessage {
  type: "requestGitRemoteUrl"
}

export interface RequestCloudSessionDataMessage {
  type: "requestCloudSessionData"
  sessionId: string
}

export interface ImportAndSendMessage {
  type: "importAndSend"
  cloudSessionId: string
  text: string
  messageID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: FileAttachment[]
  command?: string
  commandArgs?: string
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

export interface OpenFileRequest {
  type: "openFile"
  filePath: string
  line?: number
  column?: number
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

export interface OpenSettingsPanelRequest {
  type: "openSettingsPanel"
  tab?: string
}

export interface OpenVSCodeSettingsRequest {
  type: "openVSCodeSettings"
  query: string
}

export interface OpenMarketplacePanelRequest {
  type: "openMarketplacePanel"
}

export interface RequestAgentsMessage {
  type: "requestAgents"
}

export interface RequestSkillsMessage {
  type: "requestSkills"
}

export interface RequestCommandsMessage {
  type: "requestCommands"
}

export interface SendCommandRequest {
  type: "sendCommand"
  command: string
  arguments: string
  messageID?: string
  sessionID?: string
  draftID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: FileAttachment[]
}

export interface RemoveSkillMessage {
  type: "removeSkill"
  location: string
}

export interface RemoveModeMessage {
  type: "removeMode"
  name: string
}

export interface RemoveMcpMessage {
  type: "removeMcp"
  name: string
}

export interface RequestMcpStatusMessage {
  type: "requestMcpStatus"
}

export interface ConnectMcpMessage {
  type: "connectMcp"
  name: string
}

export interface DisconnectMcpMessage {
  type: "disconnectMcp"
  name: string
}

export interface McpStatusEntry {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  error?: string
}

export interface McpStatusLoadedMessage {
  type: "mcpStatusLoaded"
  status: Record<string, McpStatusEntry>
}

export interface SetLanguageRequest {
  type: "setLanguage"
  locale: string
}

export interface QuestionReplyRequest {
  type: "questionReply"
  requestID: string
  sessionID?: string
  answers: string[][]
}

export interface QuestionRejectRequest {
  type: "questionReject"
  requestID: string
  sessionID?: string
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

export interface RequestTimelineSettingMessage {
  type: "requestTimelineSetting"
}

export interface RequestBrowserSettingsMessage {
  type: "requestBrowserSettings"
}

export interface RequestClaudeCompatSettingMessage {
  type: "requestClaudeCompatSetting"
}

export interface ClaudeCompatSettingLoadedMessage {
  type: "claudeCompatSettingLoaded"
  enabled: boolean
}

export interface RequestConfigMessage {
  type: "requestConfig"
}

export interface RequestGlobalConfigMessage {
  type: "requestGlobalConfig"
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

export interface SettingsTabChangedMessage {
  type: "settingsTabChanged"
  tab: string
}

export interface RequestNotificationsMessage {
  type: "requestNotifications"
}

export interface DismissNotificationMessage {
  type: "dismissNotification"
  notificationId: string
}

export interface SyncSessionRequest {
  type: "syncSession"
  sessionID: string
  parentSessionID?: string
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
  baseBranch?: string
  branchName?: string
}

// Delete a worktree and dissociate its sessions
export interface DeleteWorktreeRequest {
  type: "agentManager.deleteWorktree"
  worktreeId: string
}

// Remove a stale worktree entry from state without touching disk
export interface RemoveStaleWorktreeRequest {
  type: "agentManager.removeStaleWorktree"
  worktreeId: string
}

// Promote a session: create a worktree and move the session into it
export interface PromoteSessionRequest {
  type: "agentManager.promoteSession"
  sessionId: string
}

// Open an unassigned session locally (clear any worktree directory override)
export interface OpenLocallyRequest {
  type: "agentManager.openLocally"
  sessionId: string
}

// Add a new session to an existing worktree
export interface AddSessionToWorktreeRequest {
  type: "agentManager.addSessionToWorktree"
  worktreeId: string
}

// Fork an existing session (copies conversation history)
export interface ForkSessionRequest {
  type: "agentManager.forkSession"
  sessionId: string
  worktreeId?: string
}

// Close (remove) a session from its worktree
export interface CloseSessionRequest {
  type: "agentManager.closeSession"
  sessionId: string
}

// Rename a worktree's display label
export interface RenameWorktreeRequest {
  type: "agentManager.renameWorktree"
  worktreeId: string
  label: string
}

export interface RequestRepoInfoMessage {
  type: "agentManager.requestRepoInfo"
}

export interface RequestStateMessage {
  type: "agentManager.requestState"
}

// Configure worktree setup script
export interface ConfigureSetupScriptRequest {
  type: "agentManager.configureSetupScript"
}

// Show terminal for a session
export interface ShowTerminalRequest {
  type: "agentManager.showTerminal"
  sessionId: string
}

// Show terminal for the local workspace (when no session is active)
export interface ShowLocalTerminalRequest {
  type: "agentManager.showLocalTerminal"
}

// Open a worktree directory in VS Code
export interface OpenWorktreeRequest {
  type: "agentManager.openWorktree"
  worktreeId: string
}

// Copy text to the system clipboard via the extension host
export interface CopyToClipboardRequest {
  type: "agentManager.copyToClipboard"
  text: string
}

// Show existing local terminal when switching to local context (no-op if none exists)
export interface ShowExistingLocalTerminalRequest {
  type: "agentManager.showExistingLocalTerminal"
}

// Open a file in the selected worktree for a specific session
export interface AgentManagerOpenFileRequest {
  type: "agentManager.openFile"
  sessionId: string
  filePath: string
  line?: number
  column?: number
}

/**
 * Maximum number of parallel worktree versions for multi-version mode.
 * Keep in sync with MAX_MULTI_VERSIONS in src/agent-manager/constants.ts.
 */
export const MAX_MULTI_VERSIONS = 4

// Per-version model allocation for multi-model comparison mode
export interface ModelAllocation {
  providerID: string
  modelID: string
  count: number
}

// Create multiple worktree sessions for the same prompt (multi-version mode)
export interface CreateMultiVersionRequest {
  type: "agentManager.createMultiVersion"
  text?: string
  name?: string
  versions: number
  providerID?: string
  modelID?: string
  agent?: string
  files?: FileAttachment[]
  baseBranch?: string
  branchName?: string
  // Per-version model allocations for multi-model comparison mode.
  // When set, each entry expands to `count` versions with that model.
  // Overrides `versions`, `providerID`, and `modelID`.
  modelAllocations?: ModelAllocation[]
}

// Persist tab order for a context (worktree ID or "local")
export interface SetTabOrderRequest {
  type: "agentManager.setTabOrder"
  key: string
  order: string[]
}

// Persist sidebar worktree order
export interface SetWorktreeOrderRequest {
  type: "agentManager.setWorktreeOrder"
  order: string[]
}

// Persist sessions collapsed state
export interface SetSessionsCollapsedRequest {
  type: "agentManager.setSessionsCollapsed"
  collapsed: boolean
}

// Persist review diff style preference
export interface SetReviewDiffStyleRequest {
  type: "agentManager.setReviewDiffStyle"
  style: "unified" | "split"
}

export interface RequestBranchesMessage {
  type: "agentManager.requestBranches"
}

export interface RequestExternalWorktreesMessage {
  type: "agentManager.requestExternalWorktrees"
}

export interface ImportFromBranchRequest {
  type: "agentManager.importFromBranch"
  branch: string
}

export interface ImportFromPRRequest {
  type: "agentManager.importFromPR"
  url: string
}

export interface ImportExternalWorktreeRequest {
  type: "agentManager.importExternalWorktree"
  path: string
  branch: string
}

export interface ImportAllExternalWorktreesRequest {
  type: "agentManager.importAllExternalWorktrees"
}

// Agent Manager: Request one-shot diff fetch (webview → extension)
export interface RequestWorktreeDiffMessage {
  type: "agentManager.requestWorktreeDiff"
  sessionId: string
}

export interface RequestWorktreeDiffFileMessage {
  type: "agentManager.requestWorktreeDiffFile"
  sessionId: string
  file: string
}

// Agent Manager: Start polling for live diff updates (webview → extension)
export interface StartDiffWatchMessage {
  type: "agentManager.startDiffWatch"
  sessionId: string
}

// Agent Manager: Stop polling for diff updates (webview → extension)
export interface StopDiffWatchMessage {
  type: "agentManager.stopDiffWatch"
}

// Agent Manager: PR messages (webview → extension)
export interface RefreshPRMessage {
  type: "agentManager.refreshPR"
  worktreeId: string
}

export interface OpenPRMessage {
  type: "agentManager.openPR"
  worktreeId: string
}

export interface ApplyWorktreeDiffMessage {
  type: "agentManager.applyWorktreeDiff"
  worktreeId: string
  selectedFiles?: string[]
}

// Agent Manager: Revert a single file in a worktree (webview → extension)
export interface RevertWorktreeFileMessage {
  type: "agentManager.revertWorktreeFile"
  sessionId: string
  file: string
}

// Variant persistence (webview → extension)
export interface PersistVariantRequest {
  type: "persistVariant"
  key: string
  value: string
}

// Request stored variants from extension (webview → extension)
export interface RequestVariantsMessage {
  type: "requestVariants"
}

// Enhance prompt request (webview → extension)
export interface EnhancePromptRequest {
  type: "enhancePrompt"
  text: string
  requestId: string
}

// Open the standalone changes viewer tab from the sidebar
export interface OpenChangesRequest {
  type: "openChanges"
}

// Open diff virtual (permission diff) in the lightweight diff virtual panel
export interface OpenDiffVirtualRequest {
  type: "openDiffVirtual"
  diff: PermissionFileDiff
}

export interface RetryConnectionRequest {
  type: "retryConnection"
}

// Open a sub-agent session in a read-only editor panel
export interface OpenSubAgentViewerRequest {
  type: "openSubAgentViewer"
  sessionID: string
  title?: string
}

// Preview an image attachment in VS Code's built-in image viewer
export interface PreviewImageRequest {
  type: "previewImage"
  dataUrl: string
  filename: string
}

// Set default base branch (webview → extension)
export interface SetDefaultBaseBranchRequest {
  type: "agentManager.setDefaultBaseBranch"
  branch?: string
}

export interface ConnectProviderMessage {
  type: "connectProvider"
  requestId: string
  providerID: string
  apiKey: string
}

export interface AuthorizeProviderOAuthMessage {
  type: "authorizeProviderOAuth"
  requestId: string
  providerID: string
  method: number
}

export interface CompleteProviderOAuthMessage {
  type: "completeProviderOAuth"
  requestId: string
  providerID: string
  method: number
  code?: string
}

export interface DisconnectProviderMessage {
  type: "disconnectProvider"
  requestId: string
  providerID: string
}

export interface SaveCustomProviderMessage {
  type: "saveCustomProvider"
  requestId: string
  providerID: string
  config: ProviderConfig
  apiKey?: string
  apiKeyChanged?: boolean
}

export interface FetchCustomProviderModelsMessage {
  type: "fetchCustomProviderModels"
  requestId: string
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
}

export interface PersistRecentsRequest {
  type: "persistRecents"
  recents: ModelSelection[]
}

export interface RequestRecentsMessage {
  type: "requestRecents"
}

export interface ToggleFavoriteRequest {
  type: "toggleFavorite"
  action: "add" | "remove"
  providerID: string
  modelID: string
}

export interface RequestFavoritesMessage {
  type: "requestFavorites"
}

// Continue in Worktree: transfer sidebar session + git state to an isolated worktree
export interface ContinueInWorktreeRequest {
  type: "continueInWorktree"
  sessionId: string
}

// Section CRUD messages (webview → extension)
export interface CreateSectionRequest {
  type: "agentManager.createSection"
  name: string
  color?: string
  worktreeIds?: string[]
}

export interface RenameSectionRequest {
  type: "agentManager.renameSection"
  sectionId: string
  name: string
}

export interface DeleteSectionRequest {
  type: "agentManager.deleteSection"
  sectionId: string
}

export interface SetSectionColorRequest {
  type: "agentManager.setSectionColor"
  sectionId: string
  color: string | null
}

export interface ToggleSectionCollapsedRequest {
  type: "agentManager.toggleSectionCollapsed"
  sectionId: string
}

export interface MoveToSectionRequest {
  type: "agentManager.moveToSection"
  worktreeIds: string[]
  sectionId: string | null
}

export interface MoveSectionRequest {
  type: "agentManager.moveSection"
  sectionId: string
  dir: -1 | 1
}

export type ContinueInWorktreeStatus =
  | "capturing"
  | "creating"
  | "setup"
  | "transferring"
  | "forking"
  | "done"
  | "error"

// Continue in Worktree: progress updates (extension → webview)
export interface ContinueInWorktreeProgressMessage {
  type: "continueInWorktreeProgress"
  status: ContinueInWorktreeStatus
  detail?: string
  error?: string
}

export type WebviewMessage =
  | SendMessageRequest
  | AbortRequest
  | RevertSessionRequest
  | UnrevertSessionRequest
  | PermissionResponseRequest
  | CreateSessionRequest
  | ClearSessionRequest
  | LoadMessagesRequest
  | LoadSessionsRequest
  | RequestCloudSessionsMessage
  | RequestGitRemoteUrlMessage
  | LoginRequest
  | LogoutRequest
  | RefreshProfileRequest
  | OpenExternalRequest
  | OpenSettingsPanelRequest
  | OpenVSCodeSettingsRequest
  | OpenMarketplacePanelRequest
  | OpenFileRequest
  | CancelLoginRequest
  | SetOrganizationRequest
  | WebviewReadyRequest
  | RequestProvidersMessage
  | CompactRequest
  | RequestAgentsMessage
  | RequestSkillsMessage
  | RequestCommandsMessage
  | SendCommandRequest
  | RemoveSkillMessage
  | RemoveModeMessage
  | RemoveMcpMessage
  | RequestMcpStatusMessage
  | ConnectMcpMessage
  | DisconnectMcpMessage
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
  | RequestTimelineSettingMessage
  | RequestBrowserSettingsMessage
  | RequestClaudeCompatSettingMessage
  | RequestConfigMessage
  | RequestGlobalConfigMessage
  | UpdateConfigMessage
  | RequestNotificationSettingsMessage
  | ResetAllSettingsRequest
  | SettingsTabChangedMessage
  | SyncSessionRequest
  | CreateWorktreeSessionRequest
  | RequestNotificationsMessage
  | DismissNotificationMessage
  | CreateWorktreeRequest
  | DeleteWorktreeRequest
  | RemoveStaleWorktreeRequest
  | PromoteSessionRequest
  | OpenLocallyRequest
  | AddSessionToWorktreeRequest
  | ForkSessionRequest
  | CloseSessionRequest
  | RenameWorktreeRequest
  | TelemetryRequest
  | RequestRepoInfoMessage
  | RequestStateMessage
  | ConfigureSetupScriptRequest
  | ShowTerminalRequest
  | ShowLocalTerminalRequest
  | OpenWorktreeRequest
  | CopyToClipboardRequest
  | ShowExistingLocalTerminalRequest
  | AgentManagerOpenFileRequest
  | CreateMultiVersionRequest
  | SetTabOrderRequest
  | SetWorktreeOrderRequest
  | SetSessionsCollapsedRequest
  | SetReviewDiffStyleRequest
  | PersistVariantRequest
  | RequestVariantsMessage
  | RequestCloudSessionDataMessage
  | ImportAndSendMessage
  | RequestBranchesMessage
  | RequestExternalWorktreesMessage
  | ImportFromBranchRequest
  | ImportFromPRRequest
  | ImportExternalWorktreeRequest
  | ImportAllExternalWorktreesRequest
  | RequestWorktreeDiffMessage
  | RequestWorktreeDiffFileMessage
  | StartDiffWatchMessage
  | StopDiffWatchMessage
  | RefreshPRMessage
  | OpenPRMessage
  // legacy-migration start
  | RequestLegacyMigrationDataMessage
  | StartLegacyMigrationMessage
  | SkipLegacyMigrationMessage
  | ClearLegacyDataMessage
  | FinalizeLegacyMigrationMessage
  // legacy-migration end
  | ApplyWorktreeDiffMessage
  | RevertWorktreeFileMessage
  | EnhancePromptRequest
  | OpenChangesRequest
  | OpenDiffVirtualRequest
  | RetryConnectionRequest
  | OpenSubAgentViewerRequest
  | PreviewImageRequest
  | SetDefaultBaseBranchRequest
  | FetchMarketplaceDataMessage
  | FilterMarketplaceItemsMessage
  | InstallMarketplaceItemMessage
  | RemoveInstalledMarketplaceItemMessage
  | ConnectProviderMessage
  | AuthorizeProviderOAuthMessage
  | CompleteProviderOAuthMessage
  | DisconnectProviderMessage
  | SaveCustomProviderMessage
  | FetchCustomProviderModelsMessage
  | PersistRecentsRequest
  | RequestRecentsMessage
  | ToggleFavoriteRequest
  | RequestFavoritesMessage
  | ContinueInWorktreeRequest
  | CreateSectionRequest
  | RenameSectionRequest
  | DeleteSectionRequest
  | SetSectionColorRequest
  | ToggleSectionCollapsedRequest
  | MoveToSectionRequest
  | MoveSectionRequest

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
