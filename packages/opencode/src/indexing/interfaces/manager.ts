// kilocode_change - new file

import type { VectorStoreSearchResult } from "./vector-store"
import type { Emitter } from "../runtime"

export interface ICodeIndexManager {
  onProgressUpdate: Emitter<{
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
    gitBranch?: string
    manifest?: { totalFiles: number; totalChunks: number; lastUpdated: string }
  }>

  readonly state: IndexingState
  readonly isFeatureEnabled: boolean
  readonly isFeatureConfigured: boolean

  loadConfiguration(): Promise<void>
  startIndexing(): Promise<void>
  stopWatcher(): void
  clearIndexData(): Promise<void>
  searchIndex(query: string, directoryPrefix?: string): Promise<VectorStoreSearchResult[]>
  getCurrentStatus(): {
    systemStatus: IndexingState
    message?: string
    processedItems: number
    totalItems: number
    currentItemUnit: string
  }
  dispose(): void
}

export type IndexingState = "Standby" | "Indexing" | "Indexed" | "Error"

export type EmbedderProvider =
  | "openai"
  | "ollama"
  | "openai-compatible"
  | "gemini"
  | "mistral"
  | "vercel-ai-gateway"
  | "bedrock"
  | "openrouter"
  | "voyage"

export interface IndexProgressUpdate {
  systemStatus: IndexingState
  message?: string
  processedBlockCount?: number
  totalBlockCount?: number
}
