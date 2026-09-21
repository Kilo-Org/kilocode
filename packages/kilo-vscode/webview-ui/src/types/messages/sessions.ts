import type { KilocodeSessionModelUsageResponse } from "@kilocode/sdk/v2"
import type { Part, TokenUsage } from "./parts"

export type SessionModelUsage = KilocodeSessionModelUsageResponse

export type SessionCloseReason = "completed" | "error" | "interrupted" | "superseded"

// Message structure (simplified for webview)
export interface Message {
  id: string
  sessionID: string
  role: "user" | "assistant"
  content?: string
  parts?: Part[]
  createdAt: string
  time?: { created: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  providerID?: string
  modelID?: string
  mode?: string
  parentID?: string
  path?: { cwd: string; root: string }
  error?: { name: string; data?: Record<string, unknown> }
  sessionErrorID?: string
  summary?: { title?: string; body?: string; diffs?: unknown[] } | boolean
  cost?: number
  tokens?: TokenUsage
  finish?: string
}

// File diff info (matches Snapshot.FileDiff from CLI backend)
export interface SessionFileDiff {
  file: string
  before: string
  after: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

// Session info (simplified for webview)
export interface SessionInfo {
  id: string
  parentID?: string | null
  title?: string
  createdAt: string
  updatedAt: string
  goal?: {
    text: string
    active: boolean
    status?: "active" | "complete" | "blocked" | "paused"
    reason?: string
  } | null
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
    workspace?: "restored" | "snapshots-disabled" | "unavailable"
  } | null
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: SessionFileDiff[]
  } | null
}

export interface ProjectSessionInfo extends SessionInfo {
  worktreeId: string | null
}

export type SessionUpdate = Partial<SessionInfo> & Pick<SessionInfo, "id">

// Cloud session info (from Kilo cloud API)
export interface CloudSessionInfo {
  session_id: string
  title: string | null
  created_at: string
  updated_at: string
}

export type MessageLoadMode = "replace" | "prepend" | "focus" | "reconcile"
