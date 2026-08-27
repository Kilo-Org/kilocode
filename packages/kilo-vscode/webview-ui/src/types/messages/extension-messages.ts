import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@kilocode/sdk/v2/client"
import type { DiffSourceCapabilities, DiffSourceDescriptor } from "../../../../src/diff/sources/types"
import type { PartBatch, PartRemove, PartUpdate } from "../../../../src/shared/stream-messages"
import type { MarketplaceItem, MarketplaceInstalledMetadata, MarketplaceRelevanceMetadata } from "../marketplace"
import type { ConnectionState, ServerInfo, SessionStatus } from "./connection"
import type { FileAttachment, Part } from "./parts"
import type {
  CloudSessionInfo,
  Message,
  MessageLoadMode,
  ProjectSessionInfo,
  SessionCloseReason,
  SessionInfo,
  SessionModelUsage,
  SessionUpdate,
} from "./sessions"
import type { AgentManagerSidebarTarget } from "./webview-messages"
import type { PermissionRequest } from "./permissions"
import type { AnacondaDesktopExtensionMessage } from "../../../../src/shared/anaconda-desktop-messages"

export interface BackgroundJobsLoadedMessage {
  type: "backgroundJobsLoaded"
  sessionID: string
  requestID: string
  jobs: BackgroundJobInfo[]
  error?: string
}

export interface BackgroundJobInfo {
  id: string
  type: string
  title?: string
  status: "running" | "completed" | "error" | "cancelled"
  started_at: number
  completed_at?: number
  error?: string
  metadata?: {
    parentSessionId?: string
    sessionId?: string
    background?: boolean
  }
}
import type { QuestionRequest, SuggestionRequest, TodoItem } from "./questions"
import type { ModelSelection, ModelUsageMap, Provider, ProviderAuthState } from "./providers"
import type { SpeechToTextModelDef } from "../../../../src/speech-to-text/models"
import type { AgentInfo, SkillInfo, SlashCommandInfo } from "./agents"
import type {
  BrowserSettings,
  Config,
  ConfigCollections,
  FeatureFlags,
  IndexingStatus,
  KiloEmbeddingModelCatalog,
} from "./config"
import type { WorkStyle, WorkStyleState } from "../../../../src/shared/work-style-presets"
import type { KilocodeNotification, ProfileData } from "./profile"
import type { ProviderUsageLoadedMessage } from "./provider-usage"
import type {
  AgentManagerApplyWorktreeDiffConflict,
  AgentManagerApplyWorktreeDiffStatus,
  BranchInfo,
  ContinueInWorktreeStatus,
  LocalGitStats,
  ManagedSessionState,
  PRStatus,
  ReviewCommentEntry,
  RunStatus,
  SectionState,
  TerminalDestination,
  TerminalFont,
  TerminalPlacement,
  WorktreeErrorCode,
  WorktreeFileDiff,
  WorktreeGitStats,
  WorktreeState,
} from "./agent-manager"
import type {
  MigrationCompleteMessage,
  MigrationDataMessage,
  MigrationProgressMessage,
  MigrationSessionProgressMessage,
  MigrationStateMessage,
} from "./migration"
import type { MemoryEventMessage, MemoryLoadedMessage, MemoryOperationResultMessage } from "./memory"

// ============================================
// Messages FROM extension TO webview
// ============================================

export interface ReadyMessage {
  type: "ready"
  serverInfo?: ServerInfo
  extensionVersion?: string
  vscodeLanguage?: string
  languageOverride?: string
  fontSize?: number
  workspaceDirectory?: string
}

export interface FontSizeChangedMessage {
  type: "fontSizeChanged"
  fontSize: number
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
  projectId?: string
  worktreeId?: string
}

export interface SendMessageFailedMessage {
  type: "sendMessageFailed"
  error: string
  text: string
  sessionID?: string
  draftID?: string
  messageID?: string
  files?: FileAttachment[]
  review?: import("../../../../src/shared/review-comments").ReviewMessageData
}

export interface SessionCommandCompletedMessage {
  type: "sessionCommandCompleted"
  messageID: string
}

// Wire shape lives in src/shared/stream-messages.ts; narrow `part` to the
// webview's concrete union.
export type PartUpdatedMessage = PartUpdate<Part>
export type PartsUpdatedMessage = PartBatch<Part>
export type PartRemovedMessage = PartRemove

export interface SessionStatusMessage {
  type: "sessionStatus"
  sessionID: string
  status: SessionStatus
  // Retry fields (present when status === "retry")
  attempt?: number
  message?: string
  next?: number
}

export interface SessionTurnClosedMessage {
  type: "sessionTurnClosed"
  sessionID: string
  reason: SessionCloseReason
}

export interface SessionErrorMessage {
  type: "sessionError"
  eventID: string
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
  stale?: boolean
}

export interface TodoUpdatedMessage {
  type: "todoUpdated"
  sessionID: string
  items: TodoItem[]
}

export interface SessionCreatedMessage {
  type: "sessionCreated"
  projectId?: string
  session: SessionInfo
  draftID?: string
  activate?: boolean
}

export interface SessionForkedMessage {
  type: "sessionForked"
  projectId?: string
  sessionID: string
  forkedFromID: string
}

export interface SessionUpdatedMessage {
  type: "sessionUpdated"
  session: SessionUpdate
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
  since?: number
}

export interface SessionModelUsageLoadedMessage {
  type: "sessionModelUsageLoaded"
  sessionID: string
  requestID: string
  data?: SessionModelUsage
}

export interface SessionModelUsageChangedMessage {
  type: "sessionModelUsageChanged"
  sessionID: string
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

export interface SelectKiloModelMessage {
  type: "selectKiloModel"
  modelID?: string
  agent?: string
}

export interface ActionMessage {
  type: "action"
  action: string
}

/** Image attachment carried back into the prompt input when restoring a message. */
export interface RestoredImage {
  dataUrl: string
  mime: string
  filename?: string
}

export interface SetChatBoxMessage {
  type: "setChatBoxMessage"
  text: string
  /**
   * Exact relative paths of the file attachments carried by the restored
   * message, if known (e.g. when reverting to a message that had @mentions).
   * When present, PromptInput seeds these directly instead of re-deriving
   * candidate mentions from the text via regex, which cannot tell a complete
   * mention from a truncated prefix when the real path contains a space.
   */
  paths?: string[]
  /** Past chats referenced by the restored message, seeded the same way as paths. */
  sessions?: SessionSearchItem[]
  /**
   * Images attached to the restored message. Present means authoritative:
   * PromptInput replaces its current attachments with this list (an empty
   * array clears them); absent leaves current attachments untouched.
   */
  images?: RestoredImage[]
}

export interface AppendChatBoxMessage {
  type: "appendChatBoxMessage"
  text: string
}

export interface AppendReviewCommentsMessage {
  type: "appendReviewComments"
  comments: ReviewCommentEntry[]
  autoSend?: boolean
}

export interface DocumentResultMessage {
  type: "document.result"
  sessionId: string
  contextKey?: string
  file: string
  requestedFile?: string
  content?: string
  kind?: "text" | "image"
  mime?: string
  data?: string
  error?: string
}

export interface DocumentOpenMessage {
  type: "document.open"
  sessionId?: string
  contextKey: string
  file: string
  line?: number
  column?: number
}

export interface AppendReviewCommentsToTerminalMessage {
  type: "appendReviewCommentsToTerminal"
  comments: ReviewCommentEntry[]
  autoSend?: boolean
  targetTerminalId: string
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
  projectId?: string
}

export interface AgentManagerSettingsProject {
  id: string
  root: string
  label: string
  pinned: boolean
  missing: boolean
  defaultBaseBranch?: string
  defaultBranch?: string
  setupScriptPath?: string
}

export interface AgentManagerSettingsLoadedMessage {
  type: "agentManagerSettingsLoaded"
  projects: AgentManagerSettingsProject[]
  projectId?: string
  requestId: string
}

export interface AgentManagerSettingsBranchesLoadedMessage {
  type: "agentManagerSettingsBranchesLoaded"
  projectId: string
  branches: BranchInfo[]
  defaultBranch: string
  requestId: string
  error?: boolean
  configuredBaseBranch?: string
  setupScriptPath?: string
}

export interface IndexingStatusLoadedMessage {
  type: "indexingStatusLoaded"
  status: IndexingStatus
  projectId?: string
}

export interface IndexingSettingsLoadedMessage {
  type: "indexingSettingsLoaded"
  settings: {
    showButtonWhenDisabled: boolean
    consent: boolean
    projects: Array<{ id: string; root: string; label: string }>
    projectId?: string
  }
}

export interface ChatSettingsLoadedMessage {
  type: "chatSettingsLoaded"
  settings: {
    shiftTabCyclesVariant: boolean
  }
}

export interface KiloEmbeddingModelsLoadedMessage {
  type: "kiloEmbeddingModelsLoaded"
  catalog: KiloEmbeddingModelCatalog
}

export interface ImageModelsLoadedMessage {
  type: "imageModelsLoaded"
  models: Array<{ id: string; name: string; description?: string }>
}

export interface SpeechToTextModelsLoadedMessage {
  type: "speechToTextModelsLoaded"
  models: SpeechToTextModelDef[]
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
    /** `null` means "no explicit setting — use the resolved default." */
    provider: string | null
    /** `null` means "no explicit setting — use the resolved default." */
    model: string | null
  }
}

export interface ChatCompletionResultMessage {
  type: "chatCompletionResult"
  text: string
  requestId: string
}

export interface SpeechToTextResultMessage {
  type: "speechToTextResult"
  text: string
  requestId: string
}

export interface SpeechToTextStartedMessage {
  type: "speechToTextStarted"
  requestId: string
}

export interface SpeechToTextCancelledMessage {
  type: "speechToTextCancelled"
  requestId: string
}

export interface SpeechToTextErrorMessage {
  type: "speechToTextError"
  error: string
  code?: string
  requestId: string
}

export interface FileSearchItem {
  path: string
  type: "file" | "folder" | "opened-file"
}

export interface FileSearchResultMessage {
  type: "fileSearchResult"
  paths: string[]
  items?: FileSearchItem[]
  dir: string
  requestId: string
}

export interface SessionSearchItem {
  id: string
  title: string
  updated: number
  /** Name of the worktree the session runs in, when listed across the worktree family. */
  worktreeName?: string
}

export interface SessionSearchResultMessage {
  type: "sessionSearchResult"
  sessions: SessionSearchItem[]
  requestId: string
}

export interface FilePickerResultMessage {
  type: "filePickerResult"
  path: string
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

export interface SessionCostAlertMessage {
  type: "sessionCostAlert"
  sessionID: string
  limit: number
  cost: string
}

export interface SessionCostAlertResolvedMessage {
  type: "sessionCostAlertResolved"
  sessionID: string
  limit: number
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

export interface ExtensionSettings {
  maxCost?: number
  multiProject?: boolean
  [key: string]: unknown
}

export interface SettingsConfigBinding {
  id: string
  scope: "global" | "project"
  target: {
    scope: "global" | "project"
    path: string
    revision: string
    exists: boolean
    writable: boolean
    raw: Record<string, unknown>
  }
  project?: { id: string; root: string; generation: number; pinned: boolean }
}

export interface ConfigLoadedMessage {
  type: "configLoaded"
  config: Config
  globalConfig?: Config
  projectConfig?: Config
  bindings?: { global?: SettingsConfigBinding; project?: SettingsConfigBinding }
  collections?: ConfigCollections
  settings?: ExtensionSettings
  features: FeatureFlags
}

export interface ConfigUpdatedMessage {
  type: "configUpdated"
  config: Config
  globalConfig?: Config
  projectConfig?: Config
  bindings?: { global?: SettingsConfigBinding; project?: SettingsConfigBinding }
  collections?: ConfigCollections
  settings?: ExtensionSettings
  features: FeatureFlags
}

export interface ConfigUpdateFailedMessage {
  type: "configUpdateFailed"
  message: string
  details?: string
  completedScopes?: Array<"global" | "project">
  config?: Config
  globalConfig?: Config
  projectConfig?: Config
  bindings?: { global?: SettingsConfigBinding; project?: SettingsConfigBinding }
}

export interface ConfigBindingExpiredMessage {
  type: "configBindingExpired"
  reason: "project-changed" | "reconnected"
}

export interface GlobalConfigLoadedMessage {
  type: "globalConfigLoaded"
  config: Config
}

export interface NotificationSettingsLoadedMessage {
  type: "notificationSettingsLoaded"
  settings: {
    attentionEnabled: boolean
    attentionSound: string
  }
}

export interface TimelineSettingLoadedMessage {
  type: "timelineSettingLoaded"
  visible: boolean
}

export interface ThroughputSettingLoadedMessage {
  type: "throughputSettingLoaded"
  visible: boolean
}

export interface AutoApprovalReasonSettingLoadedMessage {
  type: "autoApprovalReasonSettingLoaded"
  visible: boolean
}

export interface WorkStyleLoadedMessage {
  type: "workStyleLoaded"
  style: WorkStyleState
}

export interface WorkStyleAppliedMessage {
  type: "workStyleApplied"
  style: WorkStyle
}

export interface WorkStyleApplyFailedMessage {
  type: "workStyleApplyFailed"
  message: string
  rollbackFailed: boolean
}

export interface NotificationsLoadedMessage {
  type: "notificationsLoaded"
  notifications: KilocodeNotification[]
  dismissedIds: string[]
}

// Agent Manager repo info (current branch of the main workspace)
export interface AgentManagerRepoInfoMessage {
  type: "agentManager.repoInfo"
  branch: string
  defaultBranch?: string
  projectId?: string
}

// Agent Manager worktree setup progress
export interface AgentManagerWorktreeSetupMessage {
  type: "agentManager.worktreeSetup"
  /** Owning project; absent in single-project mode. */
  projectId?: string
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
  projectId?: string
  sessionId: string
  worktreeId: string
}

// Agent Manager session forked from an existing session
export interface AgentManagerSessionForkedMessage {
  type: "agentManager.sessionForked"
  projectId?: string
  sessionId: string
  forkedFromId: string
  worktreeId?: string
}

export interface AgentManagerWorktreeActivityMessage {
  type: "agentManager.worktreeActivity"
  active: string[]
}

export interface AgentManagerSessionClosedMessage {
  type: "agentManager.sessionClosed"
  projectId?: string
  sessionId: string
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
  sidebarCollapsed?: boolean
  reviewDiffStyle?: "unified" | "split"
  reviewMarkdownRender?: boolean
  isGitRepo?: boolean
  defaultBaseBranch?: string
  runStatuses?: RunStatus[]
  runScriptConfigured?: boolean
  runScriptPath?: string
  /** Owning project for this state payload. Absent in legacy single-project payloads. */
  projectId?: string
  /** Last selected sidebar target for seamless project-switch restore. */
  activeTarget?: AgentManagerSidebarTarget
  terminalDestination?: TerminalDestination
  terminalFont?: TerminalFont
}

// A registered Agent Manager project as shown in the sidebar
export interface AgentProjectSnapshot {
  id: string
  root: string
  label: string
  pinned: boolean
  active: boolean
  expanded: boolean
  initialized: boolean
  missing: boolean
}

// Project catalog push from extension to webview
export interface AgentManagerProjectsMessage {
  type: "agentManager.projects"
  multiProject: boolean
  projects: AgentProjectSnapshot[]
}

export interface AgentManagerSelectionActivatedMessage {
  type: "agentManager.selectionActivated"
  target: AgentManagerSidebarTarget
}

export interface AgentManagerProjectSessionsMessage {
  type: "agentManager.projectSessions"
  projectId: string
  sessions: ProjectSessionInfo[]
}

// ---------------------------------------------------------------------------
// Agent Manager terminal messages
// ---------------------------------------------------------------------------

export interface AgentManagerTerminalCreatedMessage {
  type: "agentManager.terminal.created"
  /** Logical terminal id selected by the webview before PTY startup.
   *  Deliberately not named `requestId`: that field name is the generic
   *  webview request/response correlation channel. */
  createId: string
  placement: TerminalPlacement
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  /** Project that owns the create; the webview namespaces its per-project
   *  terminal state with it (mirrors `ScriptTerminalView.projectId`). */
  projectId?: string
  terminalId: string
  title: string
  wsUrl: string
  font: TerminalFont
}

export interface AgentManagerTerminalRestartedMessage {
  type: "agentManager.terminal.restarted"
  terminalId: string
  wsUrl: string
}

export interface AgentManagerTerminalFontChangedMessage {
  type: "agentManager.terminal.fontChanged"
  font: TerminalFont
}

export interface AgentManagerTerminalClosedMessage {
  type: "agentManager.terminal.closed"
  terminalId: string
}

export interface AgentManagerTerminalErrorMessage {
  type: "agentManager.terminal.error"
  terminalId?: string
  /** Set when the error answers a specific create request. */
  createId?: string
  message: string
}

export interface AgentManagerTerminalDestinationChangedMessage {
  type: "agentManager.terminal.destinationChanged"
  destination: TerminalDestination
}

/** Provider-owned script terminal (Run/Setup). Full snapshots replace only these terminal kinds. */
export type ScriptTerminalKind = "run" | "setup"

export interface ScriptTerminalView {
  terminalId: string
  /** Owning project; absent in single-project mode. */
  projectId?: string
  /** null for LOCAL, worktree id otherwise */
  worktreeId: string | null
  kind: ScriptTerminalKind
  title: "Run" | "Setup"
  wsUrl: string
  state: "running" | "stopping" | "exited" | "failed"
  exitCode?: number
  font: TerminalFont
}

export interface AgentManagerScriptTerminalsMessage {
  type: "agentManager.scriptTerminals"
  terminals: ScriptTerminalView[]
}

export interface AgentManagerRunStatusMessage extends RunStatus {
  type: "agentManager.runStatus"
}

// Resolved keybindings for agent manager actions
export interface AgentManagerKeybindingsMessage {
  type: "agentManager.keybindings"
  bindings: Record<string, string>
}

export interface AutoApproveStateMessage {
  type: "autoApproveState"
  active: boolean
}

export interface SandboxStatusMessage {
  type: "sandboxStatus"
  sessionID: string
  enabled: boolean
  available: boolean
  reason?: string
  version: number
  directory: string
  revision: number
  requestID?: string
}

export interface SandboxDefaultStatusMessage {
  type: "sandboxDefaultStatus"
  desired: boolean
  enabled: boolean
  available: boolean
  reason?: string
  revision: number
  requestID?: string
}

export interface SandboxStatusErrorMessage {
  type: "sandboxStatusError"
  sessionID: string
  directory: string
  message: string
  revision: number
  requestID?: string
}

// Multi-version creation progress (extension → webview)
export interface AgentManagerMultiVersionProgressMessage {
  type: "agentManager.multiVersionProgress"
  /** Owning project; absent in single-project mode. */
  projectId?: string
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

export interface ModelUsageLoadedMessage {
  type: "modelUsageLoaded"
  usage: ModelUsageMap
}

// Persisted model-selector expand/collapse preference (extension → webview)
export interface ModelSelectorExpandedLoadedMessage {
  type: "modelSelectorExpandedLoaded"
  value: boolean
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
  projectId?: string
  branches: BranchInfo[]
  defaultBranch: string
}

// Agent Manager Import tab: result feedback (extension → webview)
export interface AgentManagerImportResultMessage {
  type: "agentManager.importResult"
  projectId?: string
  success: boolean
  message: string
  errorCode?: WorktreeErrorCode
}

// Agent Manager: Diff data push (extension → webview)
export interface AgentManagerWorktreeDiffMessage {
  type: "agentManager.worktreeDiff"
  projectId?: string
  sessionId: string
  diffs: WorktreeFileDiff[]
}

export interface AgentManagerWorktreeDiffFileMessage {
  type: "agentManager.worktreeDiffFile"
  projectId?: string
  sessionId: string
  file: string
  diff: WorktreeFileDiff | null
}

export interface AgentManagerDocumentMessage {
  type: "agentManager.document"
  sessionId: string
  contextKey?: string
  file: string
  requestedFile?: string
  content?: string
  kind?: "text" | "image"
  mime?: string
  data?: string
  error?: string
}

// Agent Manager: Diff loading state (extension → webview)
export interface AgentManagerWorktreeDiffLoadingMessage {
  type: "agentManager.worktreeDiffLoading"
  projectId?: string
  sessionId: string
  loading: boolean
}

// Agent Manager: Source-level diff notice (extension → webview)
export interface AgentManagerWorktreeDiffNoticeMessage {
  type: "agentManager.worktreeDiffNotice"
  projectId?: string
  sessionId: string
  notice?: DiffViewerNotice
}

export interface AgentManagerApplyWorktreeDiffResultMessage {
  type: "agentManager.applyWorktreeDiffResult"
  projectId?: string
  worktreeId: string
  status: AgentManagerApplyWorktreeDiffStatus
  message: string
  conflicts?: AgentManagerApplyWorktreeDiffConflict[]
}

// Agent Manager: Revert single file result (extension → webview)
export interface AgentManagerRevertWorktreeFileResultMessage {
  type: "agentManager.revertWorktreeFileResult"
  projectId?: string
  sessionId: string
  file: string
  status: "success" | "error"
  message: string
}

// Agent Manager: Branch picker data for a diff context (extension → webview)
export interface AgentManagerDiffBranchesMessage {
  type: "agentManager.diffBranches"
  projectId?: string
  sessionId: string
  branches: BranchInfo[]
  defaultBranch: string
  autoBase?: string
  currentBase?: string
  isAuto: boolean
  currentBranch?: string
}

// Agent Manager: Worktree git stats push (extension → webview)
export interface AgentManagerWorktreeStatsMessage {
  type: "agentManager.worktreeStats"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  stats: WorktreeGitStats[]
}

// Agent Manager: Local workspace git stats push (extension → webview)
export interface AgentManagerLocalStatsMessage {
  type: "agentManager.localStats"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  stats: LocalGitStats
}

// Agent Manager: PR status push (extension → webview)
export interface AgentManagerPRStatusMessage {
  type: "agentManager.prStatus"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  worktreeId: string
  pr: PRStatus | null
  error?: "gh_missing" | "gh_auth" | "fetch_failed"
}

export interface AgentManagerPRErrorMessage {
  type: "agentManager.prError"
  projectId?: string
  error: "gh_missing" | "gh_auth" | "fetch_failed"
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
  /** Owning project; absent in single-project mode. */
  projectId?: string
  sessionId: string
  providerID: string
  modelID: string
}

// Request webview to send initial prompt to a newly created session (extension → webview)
export interface AgentManagerSendInitialMessage {
  type: "agentManager.sendInitialMessage"
  /** Owning project; absent in single-project mode. */
  projectId?: string
  sessionId: string
  worktreeId: string
  text?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
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

export interface DiffViewerDiffFileMessage {
  type: "diffViewer.diffFile"
  file: string
  diff: WorktreeFileDiff | null
}

export interface DiffViewerMarkdownRenderMessage {
  type: "diffViewer.markdownRender"
  render: boolean
}

export interface DiffViewerInitialFileMessage {
  type: "diffViewer.initialFile"
  file?: string
}

export interface DiffViewerInitialMarkdownMessage {
  type: "diffViewer.initialMarkdown"
  render: boolean
}

export interface SetAvailableSourcesMessage {
  type: "setAvailableSources"
  descriptors: DiffSourceDescriptor[]
  currentId: string
}

export interface DiffViewerCapabilitiesMessage {
  type: "diffViewer.capabilities"
  capabilities: DiffSourceCapabilities
}

/**
 * Well-known notice kinds surfaced by a diff source. The webview maps these
 * to translated user-facing messages. `undefined` clears any active notice.
 */
export type DiffViewerNotice = "snapshots-disabled"

export interface DiffViewerNoticeMessage {
  type: "diffViewer.notice"
  notice: DiffViewerNotice | undefined
}

/**
 * Branch list and current base state for the workspace source's base picker.
 * Sent in response to `diffViewer.requestBranches`. `currentBase` is the
 * active base (override when set, otherwise `autoBase`); `isAuto` is true
 * when no override is active.
 */
export interface DiffViewerBranchesLoadedMessage {
  type: "diffViewer.branches"
  branches: BranchInfo[]
  defaultBranch: string
  autoBase: string | undefined
  currentBase: string | undefined
  isAuto: boolean
  currentBranch: string | undefined
}

export interface ClearPendingPromptsMessage {
  type: "clearPendingPrompts"
}

export interface ExtensionDataReadyMessage {
  type: "extensionDataReady"
}

export interface TelemetryStateMessage {
  type: "telemetryState"
  enabled: boolean
}

// ============================================
// Marketplace Messages
// ============================================

export interface MarketplaceDataMessage {
  type: "marketplaceData"
  marketplaceItems: MarketplaceItem[]
  marketplaceInstalledMetadata: MarketplaceInstalledMetadata
  marketplaceRelevance: MarketplaceRelevanceMetadata
  errors?: string[]
  showAgentMigrationBanner?: boolean
}

export interface MarketplaceInstallResultMessage {
  type: "marketplaceInstallResult"
  success: boolean
  slug: string
  error?: string
}

export interface OpenInstallModalMessage {
  type: "openInstallModal"
  mpItem: MarketplaceItem
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

export interface ValidateFilesResultMessage {
  type: "validateFilesResult"
  id: string
  existing: string[]
}

export interface ClipboardWriteResultMessage {
  type: "clipboardWriteResult"
  id: string
  ok: boolean
  error?: string
}

export interface AgentManagerFocusContextRequestedMessage {
  type: "agentManager.focusContextRequested"
}

export type ExtensionMessage =
  | DocumentResultMessage
  | DocumentOpenMessage
  | AgentManagerFocusContextRequestedMessage
  | ReadyMessage
  | FontSizeChangedMessage
  | GitStatusMessage
  | ConnectionStateMessage
  | ErrorMessage
  | SendMessageFailedMessage
  | SessionCommandCompletedMessage
  | PartUpdatedMessage
  | PartsUpdatedMessage
  | PartRemovedMessage
  | SessionStatusMessage
  | SessionTurnClosedMessage
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
  | SessionModelUsageLoadedMessage
  | SessionModelUsageChangedMessage
  | ModelUsageLoadedMessage
  | MessageCreatedMessage
  | SessionsLoadedMessage
  | CloudSessionsLoadedMessage
  | GitRemoteUrlLoadedMessage
  | ActionMessage
  | ProfileDataMessage
  | ProviderUsageLoadedMessage
  | DeviceAuthStartedMessage
  | DeviceAuthCompleteMessage
  | DeviceAuthFailedMessage
  | DeviceAuthCancelledMessage
  | NavigateMessage
  | AgentManagerSettingsLoadedMessage
  | AgentManagerSettingsBranchesLoadedMessage
  | IndexingStatusLoadedMessage
  | IndexingSettingsLoadedMessage
  | ChatSettingsLoadedMessage
  | KiloEmbeddingModelsLoadedMessage
  | ImageModelsLoadedMessage
  | SpeechToTextModelsLoadedMessage
  | ProvidersLoadedMessage
  | AgentsLoadedMessage
  | SkillsLoadedMessage
  | CommandsLoadedMessage
  | AutocompleteSettingsLoadedMessage
  | ChatCompletionResultMessage
  | SpeechToTextStartedMessage
  | SpeechToTextCancelledMessage
  | SpeechToTextResultMessage
  | SpeechToTextErrorMessage
  | FileSearchResultMessage
  | SessionSearchResultMessage
  | FilePickerResultMessage
  | TerminalContextResultMessage
  | TerminalContextErrorMessage
  | GitChangesContextResultMessage
  | GitChangesContextErrorMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | QuestionErrorMessage
  | SessionCostAlertMessage
  | SessionCostAlertResolvedMessage
  | SuggestionRequestMessage
  | SuggestionResolvedMessage
  | SuggestionErrorMessage
  | BrowserSettingsLoadedMessage
  | ClaudeCompatSettingLoadedMessage
  | ConfigLoadedMessage
  | ConfigUpdatedMessage
  | ConfigUpdateFailedMessage
  | ConfigBindingExpiredMessage
  | GlobalConfigLoadedMessage
  | NotificationSettingsLoadedMessage
  | TimelineSettingLoadedMessage
  | ThroughputSettingLoadedMessage
  | AutoApprovalReasonSettingLoadedMessage
  | WorkStyleLoadedMessage
  | WorkStyleAppliedMessage
  | WorkStyleApplyFailedMessage
  | NotificationsLoadedMessage
  | AgentManagerRepoInfoMessage
  | AgentManagerWorktreeSetupMessage
  | AgentManagerSessionAddedMessage
  | AgentManagerSessionForkedMessage
  | AgentManagerSessionClosedMessage
  | AgentManagerWorktreeActivityMessage
  | AgentManagerStateMessage
  | AgentManagerProjectsMessage
  | AgentManagerSelectionActivatedMessage
  | AgentManagerProjectSessionsMessage
  | AgentManagerRunStatusMessage
  | AgentManagerKeybindingsMessage
  | AutoApproveStateMessage
  | SandboxStatusMessage
  | SandboxDefaultStatusMessage
  | SandboxStatusErrorMessage
  | AgentManagerMultiVersionProgressMessage
  | AgentManagerSetSessionModelMessage
  | AgentManagerSendInitialMessage
  | SetChatBoxMessage
  | AppendChatBoxMessage
  | AppendReviewCommentsMessage
  | AppendReviewCommentsToTerminalMessage
  | TriggerTaskMessage
  | VariantsLoadedMessage
  | CloudSessionDataLoadedMessage
  | CloudSessionImportedMessage
  | CloudSessionImportFailedMessage
  | OpenCloudSessionMessage
  | SelectKiloModelMessage
  | AgentManagerBranchesMessage
  | AgentManagerImportResultMessage
  | WorkspaceDirectoryChangedMessage
  | AgentManagerWorktreeDiffMessage
  | AgentManagerWorktreeDiffFileMessage
  | AgentManagerDocumentMessage
  | AgentManagerWorktreeDiffLoadingMessage
  | AgentManagerWorktreeDiffNoticeMessage
  | AgentManagerApplyWorktreeDiffResultMessage
  | AgentManagerRevertWorktreeFileResultMessage
  | AgentManagerDiffBranchesMessage
  | AgentManagerWorktreeStatsMessage
  | AgentManagerLocalStatsMessage
  | AgentManagerPRStatusMessage
  | AgentManagerPRErrorMessage
  | AgentManagerTerminalCreatedMessage
  | AgentManagerTerminalRestartedMessage
  | AgentManagerTerminalFontChangedMessage
  | AgentManagerTerminalClosedMessage
  | AgentManagerTerminalErrorMessage
  | AgentManagerTerminalDestinationChangedMessage
  | AgentManagerScriptTerminalsMessage
  // legacy-migration start
  | MigrationStateMessage
  | MigrationDataMessage
  | MigrationProgressMessage
  | MigrationSessionProgressMessage
  | MigrationCompleteMessage
  // legacy-migration end
  | EnhancePromptResultMessage
  | EnhancePromptErrorMessage
  | ViewSubAgentSessionMessage
  | DiffViewerDiffsMessage
  | DiffViewerLoadingMessage
  | DiffViewerRevertFileResultMessage
  | DiffViewerDiffFileMessage
  | DiffViewerMarkdownRenderMessage
  | DiffViewerInitialFileMessage
  | DiffViewerInitialMarkdownMessage
  | SetAvailableSourcesMessage
  | DiffViewerCapabilitiesMessage
  | DiffViewerNoticeMessage
  | DiffViewerBranchesLoadedMessage
  | MarketplaceDataMessage
  | MarketplaceInstallResultMessage
  | MarketplaceRemoveResultMessage
  | OpenInstallModalMessage
  | ProviderOAuthReadyMessage
  | ProviderConnectedMessage
  | ProviderDisconnectedMessage
  | ProviderActionErrorMessage
  | AnacondaDesktopExtensionMessage
  | CustomProviderModelsFetchedMessage
  | RecentsLoadedMessage
  | ModelSelectorExpandedLoadedMessage
  | FavoritesLoadedMessage
  | ModelSelectionsLoadedMessage
  | LanguageChangedMessage
  | ContinueInWorktreeProgressMessage
  | WorktreeStatsLoadedMessage
  | McpStatusLoadedMessage
  | ClearPendingPromptsMessage
  | ExtensionDataReadyMessage
  | TelemetryStateMessage
  | RemoteStatusMessage
  | ValidateFilesResultMessage
  | ClipboardWriteResultMessage
  | MemoryLoadedMessage
  | MemoryEventMessage
  | MemoryOperationResultMessage
  | BackgroundJobsLoadedMessage
