import { ApiHandlerOptions } from "../../../shared/api" // Adjust path if needed
import { EmbedderProvider } from "./manager"

/**
 * Configuration state for the code indexing feature
 */
export interface CodeIndexConfig {
	isConfigured: boolean
	embedderProvider: EmbedderProvider
	// kilocode_change start
	vectorStoreProvider?: "lancedb" | "qdrant"
	lancedbVectorStoreDirectoryPlaceholder?: string
	// kilocode_change end
	modelId?: string
	modelDimension?: number // Generic dimension property for all providers
	openAiOptions?: ApiHandlerOptions
	ollamaOptions?: ApiHandlerOptions
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
	// kilocode_change start
	embeddingBatchSize?: number
	scannerMaxBatchRetries?: number
	// kilocode_change end
}

/**
 * Snapshot of previous configuration used to determine if a restart is required
 */
export type PreviousConfigSnapshot = {
	enabled: boolean
	configured: boolean
	embedderProvider: EmbedderProvider
	// kilocode_change start
	vectorStoreProvider?: "lancedb" | "qdrant"
	lancedbVectorStoreDirectory?: string
	// kilocode_change end
	modelId?: string
	modelDimension?: number // Generic dimension property
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
