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

// Message types from MessageV2
export interface MessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: {
    created: number
    completed?: number
  }
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

export interface TodoItem {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
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
