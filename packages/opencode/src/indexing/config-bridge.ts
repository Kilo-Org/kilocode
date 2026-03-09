// kilocode_change - new file

import type { Config } from "../config/config"
import type { IndexingConfigInput } from "./config-manager"

/**
 * CONTRACT: Converts the user-facing Config.Indexing schema (from kilo.json)
 * into the IndexingConfigInput that CodeIndexConfigManager expects.
 *
 * RATIONALE: The bridge lives in the indexing package so the config package
 * never imports indexing types. Dependency arrow: indexing -> config.
 */
export function toIndexingConfigInput(cfg: Config.Indexing | undefined): IndexingConfigInput {
  const provider = cfg?.provider ?? "openai"

  return {
    enabled: cfg?.enabled ?? false,
    embedderProvider: provider,
    vectorStoreProvider: cfg?.vectorStore,
    modelId: cfg?.model,
    modelDimension: cfg?.dimension,
    lancedbVectorStoreDirectory: cfg?.lancedb?.directory,
    qdrantUrl: cfg?.qdrant?.url,
    qdrantApiKey: cfg?.qdrant?.apiKey,
    searchMinScore: cfg?.searchMinScore,
    searchMaxResults: cfg?.searchMaxResults,
    embeddingBatchSize: cfg?.embeddingBatchSize,
    scannerMaxBatchRetries: cfg?.scannerMaxBatchRetries,
    openAiKey: cfg?.openai?.apiKey,
    ollamaBaseUrl: cfg?.ollama?.baseUrl,
    openAiCompatibleBaseUrl: cfg?.["openai-compatible"]?.baseUrl,
    openAiCompatibleApiKey: cfg?.["openai-compatible"]?.apiKey,
    geminiApiKey: cfg?.gemini?.apiKey,
    mistralApiKey: cfg?.mistral?.apiKey,
    vercelAiGatewayApiKey: cfg?.["vercel-ai-gateway"]?.apiKey,
    bedrockRegion: cfg?.bedrock?.region,
    bedrockProfile: cfg?.bedrock?.profile,
    openRouterApiKey: cfg?.openrouter?.apiKey,
    openRouterSpecificProvider: cfg?.openrouter?.specificProvider,
    voyageApiKey: cfg?.voyage?.apiKey,
  }
}
