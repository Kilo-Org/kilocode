// ============================================
// Local types — NOT from the SDK / API
// ============================================
// These types are specific to the VS Code extension and don't have
// equivalents in @kilocode/sdk. All API types (Session, Event, Agent,
// McpStatus, Config, etc.) should be imported from "@kilocode/sdk/v2/client".

/** Connection config used by the extension to reach the local CLI server */
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

export interface CloudSessionsResponse {
  cliSessions: CloudSessionInfo[]
  nextCursor: string | null
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
