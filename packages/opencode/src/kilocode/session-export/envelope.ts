export type ExportEnvelope = {
  id: string
  schemaVersion: 1
  type: ExportEventType
  sessionId: string
  rootSessionId: string
  parentSessionId?: string
  requestId?: string
  turnId?: string
  seq: number
  eventSeq?: number
  ts: number
  agentVersion: string
}

export const ExportEventTypes = [
  "llm_request_started",
  "llm_request_completed",
  "workspace_baseline_started",
  "workspace_baseline_completed",
  "workspace_delta_captured",
  "tool_executed",
  "terminal_outcome",
  "permission_decided",
  "compaction_captured",
  "feedback_captured",
  "scrub_report",
  "session_degraded",
] as const

export type ExportEventType = (typeof ExportEventTypes)[number]

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type UploadedEvent = JsonObject & {
  id: string
  type: ExportEventType
  sessionId: string
  rootSessionId: string
  parentSessionId?: string
  requestId?: string
  seq: number
  ts: number
}

export type BatchEnvelope = {
  schemaVersion: 1
  agentVersion: string
  surface: string
  batchId: string
  events: UploadedEvent[]
  systemPrompts?: Record<string, JsonValue>
  toolSchemas?: Record<string, JsonValue>
  permissionSets?: Record<string, JsonValue>
  agents?: Record<string, JsonValue>
  chunks: { id: string; bytes: string; size: number; encoding: "zstd+base64" }[]
}
