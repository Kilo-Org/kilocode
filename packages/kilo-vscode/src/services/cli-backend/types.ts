// Session types from @kilocode/cli
export interface SessionInfo {
  id: string
  title: string
  directory: string
  parentID?: string
  share?: string
  time: {
    created: number
    updated: number
    archived?: number
  }
}

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
  // Present on assistant messages
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

// Profile types from kilo-gateway
export interface KilocodeOrganization {
  id: string
  name: string
  role: string
}

export interface KilocodeProfile {
  id?: string
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

// MCP server status — discriminated union returned by the backend
export type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

// MCP server configuration for local (stdio) servers
export interface McpLocalConfig {
  type: "local"
  command: string[]
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

// MCP server configuration for remote (SSE) servers
export interface McpRemoteConfig {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  timeout?: number
}

// Union of all MCP server config types
export type McpConfig = McpLocalConfig | McpRemoteConfig

// ============================================
// Backend Config Types (from CLI server)
// ============================================

/** Permission level for a tool */
export type PermissionLevel = "allow" | "ask" | "deny"

/** Per-tool permission configuration */
export type PermissionConfig = Partial<Record<string, PermissionLevel>>

/** Per-agent configuration */
export interface AgentConfig {
  model?: string
  prompt?: string
  temperature?: number
  top_p?: number
  steps?: number
  permission?: PermissionConfig
}

/** Custom provider configuration (OpenAI-compatible) */
export interface ProviderConfig {
  name?: string
  api_key?: string
  base_url?: string
  models?: Record<string, unknown>
}

/** MCP server configuration (backend config shape) */
export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

/** Custom command configuration */
export interface CommandConfig {
  command: string
  description?: string
}

/** Skills configuration */
export interface SkillsConfig {
  paths?: string[]
  urls?: string[]
}

/** Compaction configuration */
export interface CompactionConfig {
  auto?: boolean
  prune?: boolean
}

/** Watcher configuration */
export interface WatcherConfig {
  ignore?: string[]
}

/** Experimental flags */
export interface ExperimentalConfig {
  disable_paste_summary?: boolean
  batch_tool?: boolean
  primary_tools?: string[]
  continue_loop_on_deny?: boolean
  mcp_timeout?: number
}

/** Full backend Config object (partial — all fields optional for PATCH) */
export interface Config {
  permission?: PermissionConfig
  model?: string
  small_model?: string
  default_agent?: string
  agent?: Record<string, AgentConfig>
  provider?: Record<string, ProviderConfig>
  disabled_providers?: string[]
  enabled_providers?: string[]
  mcp?: Record<string, McpServerConfig>
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
