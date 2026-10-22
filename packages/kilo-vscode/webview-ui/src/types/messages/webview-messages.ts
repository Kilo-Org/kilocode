import type { FileAttachment } from "./parts"
import type { MessageLoadMode } from "./sessions"
import type { ModelSelection } from "./providers"
import type { Activity } from "../../utils/session-activity"

// ============================================
// Messages FROM webview TO extension
// ============================================

export interface SendMessageRequest {
  type: "sendMessage"
  projectId?: string
  text: string
  messageID?: string
  sessionID?: string
  draftID?: string
  providerID?: string
  modelID?: string
  agent?: string
  variant?: string
  files?: FileAttachment[]
  contextDirectory?: string
  /** Label for a prompt Kilo composed, such as an editor code action. */
  injectedTitle?: string
}

export interface AbortRequest {
  type: "abort"
  sessionID: string
  scope?: "session" | "tree"
}

export interface PermissionResponseRequest {
  type: "permissionResponse"
  permissionId: string
  sessionID: string
  response: "once" | "always" | "reject"
  approvedAlways: string[]
  deniedAlways: string[]
  feedback?: string
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
  mode?: MessageLoadMode
  focus?: boolean
  before?: string
  limit?: number
}

export interface LoadSessionsRequest {
  type: "loadSessions"
  more?: boolean
}

export interface RefreshProfileRequest {
  type: "refreshProfile"
}

export interface OpenExternalRequest {
  type: "openExternal"
  url: string
}

export interface OpenWebLinkRequest {
  type: "openWebLink"
  url: string
}

export interface OpenFileRequest {
  type: "openFile"
  filePath: string
  line?: number
  column?: number
  // Optional session id the file reference was rendered for. When present the
  // extension resolves the workspace directory from this instead of its live
  // `currentSession`, so a session switch can't open the wrong worktree's file.
  sessionID?: string
}

export interface OpenContentRequest {
  type: "openContent"
  content: string
  language?: string
}

export interface ValidateFilesRequest {
  type: "validateFiles"
  id: string
  // Explicit session id the candidates were rendered for — the extension
  // resolves the workspace directory from this instead of its own live
  // `currentSession`, so a session switch mid-request can't validate paths
  // against the wrong worktree.
  sessionID: string
  paths: string[]
}

export interface WebviewReadyRequest {
  type: "webviewReady"
}

export interface WebviewFocusChangedRequest {
  type: "webviewFocusChanged"
  focused: boolean
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

export interface OpenVSCodeSettingsRequest {
  type: "openVSCodeSettings"
  query: string
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
  projectId?: string
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
  agentManagerContext?: string
  contextDirectory?: string
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

export interface ExportSessionTranscriptRequest {
  type: "exportSessionTranscript"
  sessionID: string
}

export interface RequestFileSearchMessage {
  type: "requestFileSearch"
  query: string
  requestId: string
  sessionID?: string
}

export interface RequestSessionSearchMessage {
  type: "requestSessionSearch"
  requestId: string
  sessionID?: string
}

export interface RequestFilePickerMessage {
  type: "requestFilePicker"
  requestId: string
}

export interface UpdateSettingRequest {
  type: "updateSetting"
  key: string
  value: unknown
}

export interface RequestTimelineSettingMessage {
  type: "requestTimelineSetting"
}

export interface RequestThroughputSettingMessage {
  type: "requestThroughputSetting"
}

export interface RequestAutoApprovalReasonSettingMessage {
  type: "requestAutoApprovalReasonSetting"
}

export interface StreamSessionVisibleMessage {
  type: "streamSessionVisible"
  sessionID: string
  visible: boolean
}

export interface RequestConfigMessage {
  type: "requestConfig"
}

export interface RequestGlobalConfigMessage {
  type: "requestGlobalConfig"
}

export interface RequestChatSettingsMessage {
  type: "requestChatSettings"
}

export interface RequestNotificationsMessage {
  type: "requestNotifications"
}

export interface DismissNotificationMessage {
  type: "dismissNotification"
  notificationId: string
}

// Copy text to the system clipboard via the extension host
export interface CopyToClipboardRequest {
  type: "copyToClipboard"
  id: string
  text: string
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

export interface RetryConnectionRequest {
  type: "retryConnection"
}

export interface ReloadRequest {
  type: "reload"
}

// Preview an image attachment in VS Code's built-in image viewer
export interface PreviewImageRequest {
  type: "previewImage"
  dataUrl: string
  filename: string
}

export interface SaveImageRequest {
  type: "saveImage"
  dataUrl: string
  filename: string
}

// Report open local sidebar/editor-tab session IDs without creating new provider connections.
export interface SidebarOpenSessionsMessage {
  type: "sidebar.openSessions"
  sessionIDs: string[]
}

export interface PersistRecentsRequest {
  type: "persistRecents"
  recents: ModelSelection[]
}

export interface RequestRecentsMessage {
  type: "requestRecents"
}

export interface PersistModelSelectorExpandedRequest {
  type: "persistModelSelectorExpanded"
  value: boolean
}

export interface RequestModelSelectorExpandedMessage {
  type: "requestModelSelectorExpanded"
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

export interface SidebarForkSessionRequest {
  type: "forkSession"
  sessionId: string
  messageId?: string
}

export interface SyncSessionRequest {
  type: "syncSession"
  sessionID: string
  parentSessionID?: string
  scope?: "task" | "inspector"
}

export interface UnsyncSessionRequest {
  type: "unsyncSession"
  sessionID: string
  scope?: "task" | "inspector"
}

export type WebviewMessage =
  | UnsyncSessionRequest
  | SyncSessionRequest
  | SidebarForkSessionRequest
  | { type: "sessionActivity"; state: Activity }
  | { type: "acknowledgeSession"; sessionID: string; eventID: string }
  | { type: "requestWorkspaceScope" }
  | SendMessageRequest
  | AbortRequest
  | PermissionResponseRequest
  | CreateSessionRequest
  | ClearSessionRequest
  | LoadMessagesRequest
  | LoadSessionsRequest
  | RefreshProfileRequest
  | OpenExternalRequest
  | OpenWebLinkRequest
  | OpenVSCodeSettingsRequest
  | OpenFileRequest
  | ValidateFilesRequest
  | WebviewReadyRequest
  | WebviewFocusChangedRequest
  | RequestProvidersMessage
  | CompactRequest
  | RequestAgentsMessage
  | RequestSkillsMessage
  | RequestCommandsMessage
  | SendCommandRequest
  | SetLanguageRequest
  | QuestionReplyRequest
  | QuestionRejectRequest
  | DeleteSessionRequest
  | RenameSessionRequest
  | ExportSessionTranscriptRequest
  | RequestFileSearchMessage
  | RequestSessionSearchMessage
  | RequestFilePickerMessage
  | UpdateSettingRequest
  | RequestTimelineSettingMessage
  | RequestThroughputSettingMessage
  | RequestAutoApprovalReasonSettingMessage
  | StreamSessionVisibleMessage
  | RequestConfigMessage
  | RequestGlobalConfigMessage
  | RequestChatSettingsMessage
  | RequestNotificationsMessage
  | DismissNotificationMessage
  | CopyToClipboardRequest
  | PersistVariantRequest
  | RequestVariantsMessage
  | RetryConnectionRequest
  | ReloadRequest
  | PreviewImageRequest
  | SaveImageRequest
  | SidebarOpenSessionsMessage
  | PersistRecentsRequest
  | RequestRecentsMessage
  | PersistModelSelectorExpandedRequest
  | RequestModelSelectorExpandedMessage
  | ToggleFavoriteRequest
  | RequestFavoritesMessage
  | OpenContentRequest

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
