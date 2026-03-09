// ============================================
// Local types — NOT from the SDK / API
// ============================================
// These types are specific to the VS Code extension and don't have
// equivalents in @kilocode/sdk. All API types (Session, Event, Agent,
// McpStatus, Config, etc.) should be imported from "@kilocode/sdk/v2/client".

// Session status from SessionStatus.Info
export type SessionStatusInfo =
  | { type: "idle" }
  | { type: "retry"; attempt: number; message: string; next: number }
  | { type: "busy" }

// Token usage shape returned by the server on assistant messages
export interface TokenUsage {
  input: number
  output: number
  reasoning?: number
  cache?: { read: number; write: number }
}

// Message types from MessageV2
export interface MessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
  agent?: string
  providerID?: string
  modelID?: string
  model?: { providerID: string; modelID: string }
  mode?: string
  parentID?: string
  path?: { cwd: string; root: string }
  error?: { name: string; data?: Record<string, unknown> }
  summary?: { title?: string; body?: string; diffs?: unknown[] } | boolean
  cost?: number
  tokens?: TokenUsage
}

// Part types - simplified for UI display
export type MessagePart =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; tool: string; state: ToolState }
  | { type: "reasoning"; id: string; text: string }

export type ToolState =
  | { status: "pending"; input: Record<string, unknown> }
  | { status: "running"; input: Record<string, unknown>; title?: string }
  | { status: "completed"; input: Record<string, unknown>; output: string; title: string }
  | { status: "error"; input: Record<string, unknown>; error: string }

// Permission request from PermissionNext.Request
export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}

// SSE Event types - based on BusEvent definitions
export type SSEEvent =
  | { type: "server.connected"; properties: Record<string, never> }
  | { type: "server.heartbeat"; properties: Record<string, never> }
  | { type: "session.created"; properties: { info: SessionInfo } }
  | { type: "session.updated"; properties: { info: SessionInfo } }
  | { type: "session.status"; properties: { sessionID: string; status: SessionStatusInfo } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "message.updated"; properties: { info: MessageInfo } }
  | { type: "message.part.updated"; properties: { part: MessagePart; delta?: string } }
  | {
      type: "message.part.delta"
      properties: { sessionID: string; messageID: string; partID: string; field: string; delta: string }
    }
  | { type: "permission.asked"; properties: PermissionRequest }
  | {
      type: "permission.replied"
      properties: { sessionID: string; requestID: string; reply: "once" | "always" | "reject" }
    }
  | { type: "todo.updated"; properties: { sessionID: string; items: TodoItem[] } }
  | { type: "question.asked"; properties: QuestionRequest }
  | { type: "question.replied"; properties: { sessionID: string; requestID: string; answers: string[][] } }
  | { type: "question.rejected"; properties: { sessionID: string; requestID: string } }

export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
}

// Question types from Question module
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
  blocking?: boolean
  tool?: {
    messageID: string
    callID: string
  }
}

// Agent/mode info from the CLI /agent endpoint
export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  native?: boolean
  hidden?: boolean
  color?: string
}

// Provider/model types from provider catalog

// Model definition from provider catalog
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
  capabilities?: { reasoning: boolean }
}

// Provider definition
export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

// Response from provider list endpoint
export interface ProviderListResponse {
  all: Record<string, Provider>
  connected: string[]
  default: Record<string, string> // providerID → default modelID
}

// Model selection (providerID + modelID pair)
export interface ModelSelection {
  providerID: string
  modelID: string
}

// Server connection config
export interface ServerConfig {
  baseUrl: string
  password: string
}

// Provider OAuth types
export interface ProviderAuthAuthorization {
  url: string
  method: "auto" | "code"
  instructions: string
}

// Kilo notification from kilo-gateway
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
}

// Profile types from kilo-gateway
export interface KilocodeOrganization {
  id: string
  name: string
  role: string
}

export interface KilocodeProfile {
  email: string
  name?: string
  organizations?: KilocodeOrganization[]
}

export interface KilocodeBalance {
  balance: number
}

export interface ProfileData {
  profile: KilocodeProfile
  balance: KilocodeBalance | null
  currentOrgId: string | null
}

// Cloud session from the Kilo cloud API (cli_sessions_v2)
export interface CloudSessionInfo {
  session_id: string
  title: string | null
  created_at: string
  updated_at: string
  version: number
}

// Full cloud session data for preview (from /kilo/cloud/session/:id)
export interface CloudSessionData {
  info: {
    id: string
    title: string
    time: { created: number; updated: number }
    [key: string]: unknown
  }
  messages: Array<{
    info: {
      id: string
      sessionID: string
      role: "user" | "assistant"
      time: { created: number; completed?: number }
      cost?: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } }
      tokens?: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } }
      [key: string]: unknown
    }
    parts: Array<{
      id: string
      sessionID: string
      messageID: string
      type: string
      [key: string]: unknown
    }>
  }>
}

/** VS Code editor context sent alongside messages to the CLI backend */
export interface WorktreeFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export interface EditorContext {
  /** Workspace-relative paths of currently visible editors */
  visibleFiles?: string[]
  /** Workspace-relative paths of open tabs */
  openTabs?: string[]
  /** Workspace-relative path of the active editor file */
  activeFile?: string
  /** User's default shell (from vscode.env.shell) */
  shell?: string
  /** User's timezone (e.g. "Europe/Amsterdam") */
  timezone?: string
}
