/**
 * Types for extension <-> webview message communication
 */

// Connection states
export type ConnectionState = "connecting" | "connected" | "disconnected" | "error"

// Session status (simplified from backend)
export type SessionStatus = "idle" | "busy" | "retry"

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

// Message structure (simplified for webview)
export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  content?: string
  parts?: Part[]
  createdAt: string
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
  args: Record<string, unknown>
  message?: string
}

// Todo item
export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
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

// ============================================
// Provider catalog (for model selector)
// ============================================

export interface ProviderModel {
  id: string
  name: string
  inputPrice?: number
  outputPrice?: number
  contextLength?: number
  releaseDate?: string
  latest?: boolean
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
// Messages FROM extension TO webview
// ============================================

export interface ReadyMessage {
  type: "ready"
  serverInfo?: ServerInfo
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

export interface ProvidersLoadedMessage {
  type: "providersLoaded"
  providers: Record<string, Provider>
  connected: string[]
  defaults: Record<string, string>
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
  | MessagesLoadedMessage
  | MessageCreatedMessage
  | SessionsLoadedMessage
  | ActionMessage
  | ProfileDataMessage
  | DeviceAuthStartedMessage
  | DeviceAuthCompleteMessage
  | DeviceAuthFailedMessage
  | DeviceAuthCancelledMessage
  | ProvidersLoadedMessage

// ============================================
// Messages FROM webview TO extension
// ============================================

export interface SendMessageRequest {
  type: "sendMessage"
  text: string
  sessionID?: string
  providerID?: string
  modelID?: string
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

export interface WebviewReadyRequest {
  type: "webviewReady"
}

export interface RequestProvidersRequest {
  type: "requestProviders"
}

export type WebviewMessage =
  | SendMessageRequest
  | AbortRequest
  | PermissionResponseRequest
  | CreateSessionRequest
  | LoadMessagesRequest
  | LoadSessionsRequest
  | LoginRequest
  | LogoutRequest
  | RefreshProfileRequest
  | OpenExternalRequest
  | CancelLoginRequest
  | WebviewReadyRequest
  | RequestProvidersRequest

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
