// Provider/model types for model selector

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
  capabilities?: {
    reasoning: boolean
    input?: { text: boolean; image: boolean; audio: boolean; video: boolean; pdf: boolean }
  }
  options?: { description?: string }
  recommendedIndex?: number
  isFree?: boolean
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
  env?: string[]
}

export interface ModelSelection {
  providerID: string
  modelID: string
}

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
