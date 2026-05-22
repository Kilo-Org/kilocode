export type ExportEnvelope = {
  id: string
  schemaVersion: 1
  type: ExportEventType
  sessionId: string
  rootSessionId: string
  parentSessionId?: string
  requestId?: string
  seq: number
  ts: number
  agentVersion: string
}

export type ExportEventType =
  | "llm_request_started"
  | "llm_request_completed"
  | "workspace_baseline_started"
  | "workspace_baseline_completed"
  | "workspace_delta_captured"
  | "tool_executed"
  | "terminal_outcome"
  | "permission_decided"
  | "compaction_captured"
  | "feedback_captured"
  | "scrub_report"
  | "session_degraded"

export type BatchEnvelope = {
  schemaVersion: 1
  agentVersion: string
  batchId: string
  events: unknown[]
  chunks: { id: string; bytes: Uint8Array; size: number; encoding: "zstd" }[]
}
