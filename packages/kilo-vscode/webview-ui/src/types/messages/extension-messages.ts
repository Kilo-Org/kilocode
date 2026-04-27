import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import type { PartBatch, PartUpdate } from "../../../../src/shared/stream-messages"
import type { SessionMode } from "../../context/worktree-mode"
import type { MarketplaceItem, MarketplaceInstalledMetadata } from "../marketplace"
import type { ConnectionState, ServerInfo, SessionStatus } from "./connection"
import type { FileAttachment, Part } from "./parts"
import type { CloudSessionInfo, Message, MessageLoadMode, SessionInfo } from "./sessions"
import type { PermissionRequest } from "./permissions"
import type { QuestionRequest, SuggestionRequest, TodoItem } from "./questions"
import type { ModelSelection, Provider, ProviderAuthState } from "./providers"
import type { AgentInfo, SkillInfo, SlashCommandInfo } from "./agents"
import type { BrowserSettings, Config } from "./config"
import type { KilocodeNotification, ProfileData } from "./profile"
import type {
  AgentManagerApplyWorktreeDiffConflict,
  AgentManagerApplyWorktreeDiffStatus,
  BranchInfo,
  ContinueInWorktreeStatus,
  ExternalWorktreeInfo,
  LocalGitStats,
  ManagedSessionState,
  PRStatus,
  ReviewComment,
  RunStatus,
  SectionState,
  WorktreeErrorCode,
  WorktreeFileDiff,
  WorktreeGitStats,
  WorktreeState,
} from "./agent-manager"
import type {
  LegacyMigrationCompleteMessage,
  LegacyMigrationDataMessage,
  LegacyMigrationProgressMessage,
  LegacyMigrationSessionProgressMessage,
  MigrationStateMessage,
} from "./migration"

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

export interface GitStatusMessage {
  type: "gitStatus"
  repo: boolean
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

// Wire shape lives in src/shared/stream-messages.ts; narrow `part` to the
// webview's concrete union.
export type PartUpdatedMessage = PartUpdate<Part>
export type PartsUpdatedMessage = PartBatch<Part>

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

export interface SessionForkedMessage {
  type: "sessionForked"
  sessionID: string
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
  mode?: Exclude<MessageLoadMode, "focus">
  cursor?: string
  hasMore?: boolean
}

export interface MessageCreatedMessage {
  type: "messageCreated"
  message: Message
}

export interface SessionsLoadedMessage {
  type: "sessionsLoaded"
  sessions: SessionInfo[]
  preserveSessionIds?: string[]
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
    model: string
  }
}

export interface ChatCompletionResultMessage {
  type: "chatCompletionResult"
  text: string
  requestId: string
}

export interface FileSearchItem {
  path: string
  type: "file" | "folder"
}

export interface FileSearchResultMessage {
  type: "fileSearchResult"
  paths: string[]
  items?: FileSearchItem[]
  dir: string
  requestId: string
}

export interface TerminalContextResultMessage {
  type: "terminalContextResult"
  requestId: string
  content: string
  truncated?: boolean
}

export interface TerminalContextErrorMessage {
  type: "terminalContextError"
  requestId: string
  error: string
}

export interface GitChangesContextResultMessage {
  type: "gitChangesContextResult"
  requestId: string
  content: string
  truncated?: boolean
}

export interface GitChangesContextErrorMessage {
  type: "gitChangesContextError"
  requestId: string
  error: string
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

export interface SuggestionRequestMessage {
  type: "suggestionRequest"
  suggestion: SuggestionRequest
}

export interface SuggestionResolvedMessage {
  type: "suggestionResolved"
  requestID: string
}

export interface SuggestionErrorMessage {
  type: "suggestionError"
  requestID: string
}

export interface BrowserSettingsLoadedMessage {
  type: "browserSettingsLoaded"
  settings: BrowserSettings
}

export interface ClaudeCompatSettingLoadedMessage {
  type: "claudeCompatSettingLoaded"
  enabled: boolean
}

export interface ConfigLoadedMessage {
  type: "configLoaded"
  config: Config
}

export interface ConfigUpdatedMessage {
  type: "configUpdated"
  config: Config
}

export interface ConfigUpdateFailedMessage {
  type: "configUpdateFailed"
  message: string
  details?: string
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
  mode: SessionMode
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
  runStatuses?: RunStatus[]
  runScriptConfigured?: boolean
  runScriptPath?: string
}

// ---------------------------------------------------------------------------
// Agent Manager terminal messages
// ---------------------------------------------------------------------------

export interface AgentManagerTerminalCreatedMessage {
  type: "agentManager.terminal.created"
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  terminalId: string
  title: string
  wsUrl: string
}

export interface AgentManagerTerminalClosedMessage {
  type: "agentManager.terminal.closed"
  terminalId: string
}

export interface AgentManagerTerminalErrorMessage {
  type: "agentManager.terminal.error"
  terminalId?: string
  message: string
}

export interface AgentManagerRunStatusMessage extends RunStatus {
  type: "agentManager.runStatus"
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

// Per-mode model selections loaded from model.json (extension → webview)
export interface ModelSelectionsLoadedMessage {
  type: "modelSelectionsLoaded"
  selections: Record<string, ModelSelection>
}

export interface AgentManagerBranchesMessage {
  type: "agentManager.branches"
  branches: BranchInfo[]
  defaultBranch: string
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

// Agent Manager: Worktree git stats push (extension → webview)
export interface AgentManagerWorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  stats: WorktreeGitStats[]
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

export interface DiffViewerRevertFileResultMessage {
  type: "diffViewer.revertFileResult"
  file: string
  status: "success" | "error"
  message: string
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

export interface McpStatusEntry {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  error?: string
}

export interface McpStatusLoadedMessage {
  type: "mcpStatusLoaded"
  status: Record<string, McpStatusEntry>
}

// Continue in Worktree: progress updates (extension → webview)
export interface ContinueInWorktreeProgressMessage {
  type: "continueInWorktreeProgress"
  status: ContinueInWorktreeStatus
  detail?: string
  error?: string
}

export interface RemoteStatusMessage {
  type: "remoteStatus"
  enabled: boolean
  connected: boolean
}

export type ExtensionMessage =
  | ReadyMessage
  | GitStatusMessage
  | ConnectionStateMessage
  | ErrorMessage
  | SendMessageFailedMessage
  | PartUpdatedMessage
  | PartsUpdatedMessage
  | SessionStatusMessage
  | SessionErrorMessage
  | PermissionRequestMessage
  | PermissionResolvedMessage
  | PermissionErrorMessage
  | TodoUpdatedMessage
  | SessionCreatedMessage
  | SessionForkedMessage
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
  | TerminalContextResultMessage
  | TerminalContextErrorMessage
  | GitChangesContextResultMessage
  | GitChangesContextErrorMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | QuestionErrorMessage
  | SuggestionRequestMessage
  | SuggestionResolvedMessage
  | SuggestionErrorMessage
  | BrowserSettingsLoadedMessage
  | ClaudeCompatSettingLoadedMessage
  | ConfigLoadedMessage
  | ConfigUpdatedMessage
  | ConfigUpdateFailedMessage
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
  | AgentManagerRunStatusMessage
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
  | AgentManagerTerminalCreatedMessage
  | AgentManagerTerminalClosedMessage
  | AgentManagerTerminalErrorMessage
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
  | DiffViewerRevertFileResultMessage
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
  | ModelSelectionsLoadedMessage
  | LanguageChangedMessage
  | ContinueInWorktreeProgressMessage
  | WorktreeStatsLoadedMessage
  | McpStatusLoadedMessage
  | ClearPendingPromptsMessage
  | ExtensionDataReadyMessage
  | RemoteStatusMessage
