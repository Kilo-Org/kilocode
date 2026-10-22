// ============================================
// Local types — NOT from the SDK / API
// ============================================
// These types are specific to the VS Code extension and don't have
// equivalents in @kilocode/sdk. All API types (Session, Event, Agent,
// McpStatus, Config, etc.) should be imported from "@kilocode/sdk-v1/v2/client".

import type { IndexingStatus as SdkIndexingStatus } from "@kilocode/sdk-v1/v2/client"

/** Connection config used by the extension to reach the local CLI server */
export interface ServerConfig {
  baseUrl: string
  password: string
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
  selectedOrganizationId?: string
  hasPersonalAccount?: boolean
}

export interface KilocodeBalance {
  balance: number
}

// Full cloud session data for preview (from /kilo/cloud/session/:id)
export interface CloudSessionMessage {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    parentID?: string
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
}

export type IndexingStatus = SdkIndexingStatus

export interface EditorContext {
  /** Workspace-relative paths of currently visible editors */
  visibleFiles?: string[]
  /** Workspace-relative paths of open tabs */
  openTabs?: string[]
  /** Workspace-relative path of the active editor file */
  activeFile?: string
  /** User's default shell (from vscode.env.shell) */
  shell?: string
}
