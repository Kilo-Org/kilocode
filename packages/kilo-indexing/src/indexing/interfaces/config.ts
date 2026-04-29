import type { EmbedderProvider } from "./manager"

/**
 * Configuration state for the code indexing feature.
 *
 * RATIONALE: Replaced the legacy ApiHandlerOptions / ContextProxy types with
 * indexing-local option shapes so the package does not depend on the
 * extension's configuration plumbing.
 */
export interface CodeIndexConfig {
  isConfigured: boolean
  embedderProvider: EmbedderProvider
  vectorStoreProvider?: "lancedb" | "qdrant"
  lancedbVectorStoreDirectoryPlaceholder?: string
  modelId?: string
  modelDimension?: number
  openAiOptions?: { apiKey: string }
  ollamaOptions?: { baseUrl: string; modelId?: string }
  openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
  geminiOptions?: { apiKey: string }
  mistralOptions?: { apiKey: string }
  vercelAiGatewayOptions?: { apiKey: string }
  bedrockOptions?: { region: string; profile?: string }
  openRouterOptions?: { apiKey: string; specificProvider?: string }
  voyageOptions?: { apiKey: string }
  qdrantUrl?: string
  qdrantApiKey?: string
  searchMinScore?: number
  searchMaxResults?: number
  embeddingBatchSize?: number
  scannerMaxBatchRetries?: number
}

export type PreviousConfigSnapshot = {
  enabled: boolean
  configured: boolean
  embedderProvider: EmbedderProvider
  vectorStoreProvider?: "lancedb" | "qdrant"
  lancedbVectorStoreDirectory?: string
  modelId?: string
  modelDimension?: number
  openAiKey?: string
  ollamaBaseUrl?: string
  openAiCompatibleBaseUrl?: string
  openAiCompatibleApiKey?: string
  geminiApiKey?: string
  mistralApiKey?: string
  vercelAiGatewayApiKey?: string
  bedrockRegion?: string
  bedrockProfile?: string
  openRouterApiKey?: string
  openRouterSpecificProvider?: string
  voyageApiKey?: string
  qdrantUrl?: string
  qdrantApiKey?: string
}
