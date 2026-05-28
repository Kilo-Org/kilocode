import type { ExportEnvelope } from "./envelope"
import type { Permission } from "@/permission"
import type { MessageV2 } from "@/session/message-v2"
import type { ModelMessage, TextStreamPart, Tool } from "ai"

export type { ExportEnvelope } from "./envelope"

export type LlmStreamPart = TextStreamPart<Record<string, Tool>>

export type LlmRequestStarted = ExportEnvelope & {
  type: "llm_request_started"
  requestId: string
  userMessageId: string
  assistantMessageId?: string
  agent: string
  modeId: string
  model: {
    providerId: string
    modelId: string
    variant?: string
    isFree: true
  }
  input: {
    system: string[]
    messages: ModelMessage[]
    tools: Record<string, Tool>
    permissions: Permission.Ruleset
    toolChoice?: "auto" | "required" | "none"
    params: Record<string, unknown>
  }
  gitContext?: { branch: string; sha: string; dirtyFileCount: number }
  agentInfo?: unknown
  time: { created: number }
}

export type LlmRequestCompleted = ExportEnvelope & {
  type: "llm_request_completed"
  requestId: string
  output: {
    textParts: string[]
    reasoningParts?: string[]
    toolCalls?: LlmStreamPart[]
    finishReason?: string
    error?: unknown
    usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  }
  durationMs: number
  retryCount: number
  time: { completed: number }
}

export type WorkspaceBaselineStarted = ExportEnvelope & {
  type: "workspace_baseline_started"
  requestedAt: number
}

export type FileEntry = {
  path: string
  kind: "file" | "symlink" | "directory"
  size?: number
  hash?: string
  content?: string
  chunkIds?: string[]
  encoding?: "utf8" | "base64"
  omitted?: { reason: "secret" | "pii" | "binary" | "large" | "high_risk_path" | "error"; detail?: string }
}

export type CaptureMetadata = {
  mode: "git-tracked-and-untracked" | "none"
  fileCount: number
  totalBytes: number
  omittedCountsByReason: Record<string, number>
  truncated: boolean
}

export type WorkspaceBaselineCompleted = ExportEnvelope & {
  type: "workspace_baseline_completed"
  snapshotId?: string
  consistency: "stable" | "eventual" | "missing"
  files: FileEntry[]
  capture?: CaptureMetadata
  truncated?: boolean
  originalFileCount?: number
  originalTotalSize?: number
}

export type DeltaEntry = {
  path: string
  status: "added" | "modified" | "removed" | "renamed"
  additions?: number
  deletions?: number
  patchChunkIds: string[]
  patch?: string
}

export type WorkspaceDeltaCaptured = ExportEnvelope & {
  type: "workspace_delta_captured"
  snapshotHash: string
  prevSnapshotHash: string
  trigger: "next_request" | "turn_end" | "session_close"
  diff: DeltaEntry[]
}

export type ToolExecuted = ExportEnvelope & {
  type: "tool_executed"
  toolCallId: string
  toolName: string
  source: "builtin" | "mcp"
  mcpServer?: string
  inputChunkIds: string[]
  outputChunkIds: string[]
  toolInput?: unknown
  toolOutput?: string
  errorCode?: string
  exitCode?: number
  signal?: string
  durationMs: number
  retryCount: number
}

export type TerminalOutcome = ExportEnvelope & {
  type: "terminal_outcome"
  toolCallId: string
  exitCode: number
  signal?: string
  durationMs: number
}

export type PermissionDecided = ExportEnvelope & {
  type: "permission_decided"
  toolName: string
  decision: "allow" | "deny" | "always_allow" | "always_deny"
  reason?: string
  durationToDecideMs: number
}

export type CompactionCaptured = ExportEnvelope & {
  type: "compaction_captured"
  input: {
    inputMessagesSnapshot: ModelMessage[]
    selectedContext: MessageV2.WithParts[]
    previousSummary?: string
    prompt: string
    tailStartId?: string
  }
  output: {
    summary: string
    assistantMessageId: string
  }
  modelId: string
  durationMs: number
  usage?: { inputTokens: number; outputTokens: number }
}

export type FeedbackCaptured = ExportEnvelope & {
  type: "feedback_captured"
  messageId: string
  rating: "up" | "down"
  previousRating?: "up" | "down"
}

export type ScrubReport = ExportEnvelope & {
  type: "scrub_report"
  client_scrubbed: boolean
  redactionsByType: Record<string, number>
  failureReason?: string
}

export type SessionDegraded = ExportEnvelope & {
  type: "session_degraded"
  reason: "ring_buffer_overflow"
}

export type ExportEvent =
  | LlmRequestStarted
  | LlmRequestCompleted
  | WorkspaceBaselineStarted
  | WorkspaceBaselineCompleted
  | WorkspaceDeltaCaptured
  | ToolExecuted
  | TerminalOutcome
  | PermissionDecided
  | CompactionCaptured
  | FeedbackCaptured
  | ScrubReport
  | SessionDegraded
