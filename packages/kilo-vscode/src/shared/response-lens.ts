export const responseLensLevels = ["simple", "school", "high-school", "university"] as const
export type ResponseLensLevel = (typeof responseLensLevels)[number]
export type ResponseLensModel = { providerID: string; modelID: string }
export type ResponseLensContext = { role: "user" | "assistant"; text: string }
export type ResponseLensReference = { kind: "file" | "url"; target: string }
export type ResponseLensSource = {
  kind: "file" | "url"
  label: string
  detail: string
  truncated: boolean
  chars: number
}
export type ResponseLensSettings = { enabled: boolean; level: ResponseLensLevel; model?: ResponseLensModel }

export interface ExplainBrieflyRequest {
  type: "explainBriefly"
  requestId: string
  sessionID: string
  messageID: string
  text: string
  level: ResponseLensLevel
  model: ResponseLensModel
  context: ResponseLensContext[]
  references?: ResponseLensReference[]
}

export interface CancelExplainBrieflyRequest {
  type: "cancelExplainBriefly"
  requestId: string
}

export interface ExplainBrieflyResult {
  type: "explainBrieflyResult"
  requestId: string
  text: string
  truncated: boolean
  model: ResponseLensModel
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  sources?: ResponseLensSource[]
}

export interface ExplainBrieflyError {
  type: "explainBrieflyError"
  requestId: string
  error: string
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit
}

function model(value: unknown): value is ResponseLensModel {
  return (
    record(value) &&
    text(value.providerID, 512) &&
    text(value.modelID, 512) &&
    Object.keys(value).every((key) => key === "providerID" || key === "modelID")
  )
}

export function validResponseLensSettings(value: unknown): value is ResponseLensSettings {
  return (
    record(value) &&
    typeof value.enabled === "boolean" &&
    responseLensLevels.includes(value.level as ResponseLensLevel) &&
    (value.model === undefined || model(value.model)) &&
    Object.keys(value).every((key) => key === "enabled" || key === "level" || key === "model")
  )
}

export function responseLensSettings(value: unknown): ResponseLensSettings {
  return validResponseLensSettings(value) ? value : { enabled: true, level: "simple" }
}

export function validExplainBrieflyRequest(value: unknown): value is ExplainBrieflyRequest {
  if (!record(value) || value.type !== "explainBriefly") return false
  if (!text(value.requestId, 512) || !text(value.sessionID, 512) || !text(value.messageID, 512)) return false
  if (!text(value.text, 4000) || !responseLensLevels.includes(value.level as ResponseLensLevel) || !model(value.model))
    return false
  if (!Array.isArray(value.context) || value.context.length > 4) return false
  if (
    value.references !== undefined &&
    (!Array.isArray(value.references) ||
      value.references.length > 2 ||
      !value.references.every(
        (entry) => record(entry) && (entry.kind === "file" || entry.kind === "url") && text(entry.target, 2048),
      ))
  )
    return false
  let size = 0
  for (const entry of value.context) {
    if (!record(entry) || (entry.role !== "user" && entry.role !== "assistant") || !text(entry.text, 8000)) return false
    size += entry.text.length
  }
  return size <= 8000
}
