// Provider/model types for model selector

export type ProcessingMode = "standard" | "flex"

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
  variants?: Record<string, Record<string, unknown>>
  api?: { id?: string; npm?: string; url?: string }
  capabilities?: {
    reasoning: boolean
    input?: { text: boolean; image: boolean; audio: boolean; video: boolean; pdf: boolean }
  }
  options?: { description?: string }
  autoRouting?: { models: string[] }
  recommendedIndex?: number
  isFree?: boolean
  mayTrainOnYourPrompts?: boolean
  hasUserByokAvailable?: boolean
  terminalBench?: {
    overallScore: number
    avgAttemptCostUsd: number
  }
  cost?: {
    input: number
    output: number
    cache?: {
      read: number
      write: number
    }
  }
}

export interface Provider {
  id: string
  name: string
  models: Record<string, ProviderModel>
  source?: "env" | "config" | "custom" | "api"
  options?: { baseURL?: string }
  env?: string[]
  metadata?: {
    noteKey?: string
    icon?: string
    priority?: number
  }
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

export interface ModelUsage {
  count: number
  lastUsed: number
}

export type ModelUsageMap = Record<string, ModelUsage>

export type ProviderAuthState = "api" | "oauth" | "wellknown"

export interface ProviderConfig {
  name?: string
  api_key?: string
  base_url?: string
  models?: Record<string, unknown>
  npm?: string
  env?: string[]
  options?: Record<string, unknown>
}
