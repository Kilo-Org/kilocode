import type { ProviderAuthMethod, ProviderFailure } from "@kilocode/sdk-v1/v2/client"
import type { PartBatch, PartRemove, PartUpdate } from "../../../../src/shared/stream-messages"
import type { ConnectionState, ServerInfo, SessionStatus } from "./connection"
import type { FileAttachment, Part } from "./parts"
import type { Message, MessageLoadMode, SessionCloseReason, SessionInfo, SessionUpdate } from "./sessions"
import type { PermissionRequest } from "./permissions"
import type { CodeContext } from "../../../../src/shared/code-context"
import type { QuestionRequest, TodoItem } from "./questions"
import type { ModelSelection, Provider, ProviderAuthState } from "./providers"
import type { AgentInfo, SkillInfo, SlashCommandInfo } from "./agents"
import type { Config, ConfigCollections, FeatureFlags } from "./config"
import type { KilocodeNotification, ProfileData } from "./profile"

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

export interface WorkspaceScopeMessage {
  type: "workspaceScope"
  folder?: { name: string; path: string }
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
  eventID: string
  reason: SessionCloseReason
  parentID?: string
}

export interface SessionErrorMessage {
  type: "sessionError"
  eventID: string
  sessionID?: string
  error?: { name: string; data?: Record<string, unknown> }
  phase?: "admission" | "execution"
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

export interface MessageCreatedMessage {
  type: "messageCreated"
  message: Message
}

export interface SessionsLoadedMessage {
  type: "sessionsLoaded"
  projectId?: string
  sessions: SessionInfo[]
  preserveSessionIds?: string[]
  append?: boolean
  hasMore?: boolean
}

export interface OpenSessionMessage {
  type: "openSession"
  sessionID: string
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

export interface AppendChatContextMessage {
  type: "appendChatContext"
  context: CodeContext
}

export interface TriggerTaskMessage {
  type: "triggerTask"
  text: string
  /** Label for a prompt Kilo composed, such as an editor code action. */
  injectedTitle?: string
}

export interface ProfileDataMessage {
  type: "profileData"
  data: ProfileData | null
}

export interface NavigateMessage {
  type: "navigate"
  view: "newTask" | "marketplace" | "history" | "profile" | "settings" | "subAgentViewer"
  tab?: string
  subtab?: string
  focus?: string
  projectId?: string
}

export interface ChatSettingsLoadedMessage {
  type: "chatSettingsLoaded"
  settings: {
    shiftTabCyclesVariant: boolean
    browserAutomation: boolean
    agentManagerBrowserOpenLinksIn: "external" | "integrated"
    workspaceTrusted: boolean
  }
}

export interface ProvidersLoadedMessage {
  type: "providersLoaded"
  providers: Record<string, Provider>
  connected: string[]
  defaults: Record<string, string>
  organizationId?: string | null
  ready?: boolean
  defaultSelection: ModelSelection
  authMethods: Record<string, ProviderAuthMethod[]>
  authStates: Record<string, ProviderAuthState>
  /** The organization's Kilo catalog failed to load, so Kilo has no models to pick. */
  kiloUnavailable?: boolean
  /** Typed reasons providers failed to load, so the UI can explain why instead of hiding them. */
  failures?: ProviderFailure[]
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

export interface FileSearchItem {
  path: string
  type: "file" | "folder" | "opened-file"
  /**
   * Owning workspace folder name, set only when the workspace has more than one
   * folder. Entries outside the session's own project carry an absolute path and
   * are mention-only: they are never auto-attached, so the agent must Read them
   * under the normal external-directory permission check.
   */
  root?: string
  /**
   * Path within the owning folder, set only when `path` is absolute. The `@`
   * menu is ranked again in the webview, and scoring an absolute path there
   * would let the filesystem prefix match every entry under that folder.
   */
  relative?: string
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

export interface ExtensionSettings {
  maxCost?: number
  claudeMigration?: boolean
  conversationPromptHistory?: boolean
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

export interface GlobalConfigLoadedMessage {
  type: "globalConfigLoaded"
  config: Config
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

export interface PushFixesSettingLoadedMessage {
  type: "pushFixesSettingLoaded"
  enabled: boolean
}

export interface ShortcutHintsSettingLoadedMessage {
  type: "shortcutHintsSettingLoaded"
  visible: boolean
}

/** Shortcut labels (user keybindings applied) and editor state for prompt hints. */
export interface ShortcutContextMessage {
  type: "shortcutContext"
  bindings: Record<string, string>
  /** The active text editor has selected text. */
  selection: boolean
}

export interface NotificationsLoadedMessage {
  type: "notificationsLoaded"
  notifications: KilocodeNotification[]
  dismissedIds: string[]
}

// ---------------------------------------------------------------------------
// Agent Manager terminal messages
// ---------------------------------------------------------------------------

// Stored variant selections loaded from extension globalState (extension → webview)
export interface VariantsLoadedMessage {
  type: "variantsLoaded"
  variants: Record<string, string>
}

export interface RecentsLoadedMessage {
  type: "recentsLoaded"
  recents: ModelSelection[]
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

export interface ClearPendingPromptsMessage {
  type: "clearPendingPrompts"
}

export interface ExtensionDataReadyMessage {
  type: "extensionDataReady"
}

// ============================================
// Marketplace Messages
// ============================================

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

export interface SessionForkedMessage {
  type: "sessionForked"
  projectId?: string
  sessionID: string
  forkedFromID: string
}

export type ExtensionMessage =
  | SessionForkedMessage
  | { type: "sessionAcknowledged"; sessionID: string; eventID: string }
  | { type: "webviewActiveChanged"; active: boolean }
  | ReadyMessage
  | WorkspaceScopeMessage
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
  | SessionUpdatedMessage
  | SessionDeletedMessage
  | MessageRemovedMessage
  | MessagesLoadedMessage
  | MessageCreatedMessage
  | SessionsLoadedMessage
  | ActionMessage
  | ProfileDataMessage
  | NavigateMessage
  | ChatSettingsLoadedMessage
  | ProvidersLoadedMessage
  | { type: "providersLoading" }
  | AgentsLoadedMessage
  | SkillsLoadedMessage
  | CommandsLoadedMessage
  | FileSearchResultMessage
  | SessionSearchResultMessage
  | FilePickerResultMessage
  | QuestionRequestMessage
  | QuestionResolvedMessage
  | QuestionErrorMessage
  | ConfigLoadedMessage
  | GlobalConfigLoadedMessage
  | TimelineSettingLoadedMessage
  | ThroughputSettingLoadedMessage
  | AutoApprovalReasonSettingLoadedMessage
  | PushFixesSettingLoadedMessage
  | ShortcutHintsSettingLoadedMessage
  | ShortcutContextMessage
  | NotificationsLoadedMessage
  | SetChatBoxMessage
  | AppendChatBoxMessage
  | AppendChatContextMessage
  | TriggerTaskMessage
  | VariantsLoadedMessage
  | OpenSessionMessage
  | SelectKiloModelMessage
  | WorkspaceDirectoryChangedMessage
  | RecentsLoadedMessage
  | ModelSelectorExpandedLoadedMessage
  | FavoritesLoadedMessage
  | LanguageChangedMessage
  | ClearPendingPromptsMessage
  | ExtensionDataReadyMessage
  | ValidateFilesResultMessage
  | ClipboardWriteResultMessage
