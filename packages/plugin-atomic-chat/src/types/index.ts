// OpenAI-compatible /v1/models entry
export interface AtomicChatModel {
  id: string
  object: string
  created: number
  owned_by: string
}

export interface AtomicChatModelsResponse {
  object: string
  data: AtomicChatModel[]
}

export type ModelType = "chat" | "embedding" | "unknown"

export type LoadingStatus = "not_loaded" | "loading" | "loaded" | "error"

export interface ModelValidationError {
  type: "offline" | "not_found" | "network" | "permission" | "timeout" | "unknown"
  severity: "low" | "medium" | "high" | "critical"
  message: string
  canRetry: boolean
  autoFixAvailable: boolean
}

export interface AutoFixSuggestion {
  action: string
  command?: string
  steps?: string[]
  automated: boolean
}

export interface SimilarModel {
  model: string
  similarity: number
  reason: string
}

export interface CacheStats {
  size: number
  entries: Array<{
    baseURL: string
    age: number
    modelCount: number
    ttl: number
  }>
}
