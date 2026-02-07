import { z } from "zod"

/**
 * Codebase Index Constants
 */
export const CODEBASE_INDEX_DEFAULTS = {
	MIN_SEARCH_RESULTS: 10,
	MAX_SEARCH_RESULTS: 200,
	DEFAULT_SEARCH_RESULTS: 50,
	SEARCH_RESULTS_STEP: 10,
	MIN_SEARCH_SCORE: 0,
	MAX_SEARCH_SCORE: 1,
	DEFAULT_SEARCH_MIN_SCORE: 0.4,
	SEARCH_SCORE_STEP: 0.05,
	// kilocode_change start
	MIN_EMBEDDING_BATCH_SIZE: 10,
	MAX_EMBEDDING_BATCH_SIZE: 200,
	DEFAULT_EMBEDDING_BATCH_SIZE: 60,
	EMBEDDING_BATCH_SIZE_STEP: 10,
	MIN_SCANNER_MAX_BATCH_RETRIES: 1,
	MAX_SCANNER_MAX_BATCH_RETRIES: 10,
	DEFAULT_SCANNER_MAX_BATCH_RETRIES: 3,
	SCANNER_MAX_BATCH_RETRIES_STEP: 1,
	// kilocode_change end
} as const

/**
 * CodebaseIndexConfig
 */

export const codebaseIndexConfigSchema = z.object({
	codebaseIndexEnabled: z.boolean().optional(),
	codebaseIndexQdrantUrl: z.string().optional(),
	codebaseIndexEmbedderProvider: z
		.enum([
			"openai",
			"ollama",
			"openai-compatible",
			"gemini",
			"mistral",
			"vercel-ai-gateway",
			"bedrock",
			"openrouter",
			"voyage",
		])
		.optional(),
	// kilocode_change start
	codebaseIndexVectorStoreProvider: z.enum(["lancedb", "qdrant"]).optional(),
	codebaseIndexLancedbVectorStoreDirectory: z.string().optional(),
	// kilocode_change end
	codebaseIndexEmbedderBaseUrl: z.string().optional(),
	codebaseIndexEmbedderModelId: z.string().optional(),
	codebaseIndexEmbedderModelDimension: z.number().optional(),
	codebaseIndexSearchMinScore: z.number().min(0).max(1).optional(),
	codebaseIndexSearchMaxResults: z
		.number()
		.min(CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS)
		.max(CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS)
		.optional(),
	// kilocode_change start
	codebaseIndexEmbeddingBatchSize: z
		.number()
		.min(CODEBASE_INDEX_DEFAULTS.MIN_EMBEDDING_BATCH_SIZE)
		.max(CODEBASE_INDEX_DEFAULTS.MAX_EMBEDDING_BATCH_SIZE)
		.optional(),
	codebaseIndexScannerMaxBatchRetries: z
		.number()
		.min(CODEBASE_INDEX_DEFAULTS.MIN_SCANNER_MAX_BATCH_RETRIES)
		.max(CODEBASE_INDEX_DEFAULTS.MAX_SCANNER_MAX_BATCH_RETRIES)
		.optional(),
	// kilocode_change end
	// OpenAI Compatible specific fields
	codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
	codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
	// Bedrock specific fields
	codebaseIndexBedrockRegion: z.string().optional(),
	codebaseIndexBedrockProfile: z.string().optional(),
	// OpenRouter specific fields
	codebaseIndexOpenRouterSpecificProvider: z.string().optional(),
})

export type CodebaseIndexConfig = z.infer<typeof codebaseIndexConfigSchema>

/**
 * CodebaseIndexModels
 */

export const codebaseIndexModelsSchema = z.object({
	openai: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	ollama: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	"openai-compatible": z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	gemini: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	mistral: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	"vercel-ai-gateway": z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	openrouter: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	bedrock: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
	voyage: z.record(z.string(), z.object({ dimension: z.number() })).optional(),
})

export type CodebaseIndexModels = z.infer<typeof codebaseIndexModelsSchema>

/**
 * CdebaseIndexProvider
 */

export const codebaseIndexProviderSchema = z.object({
	codeIndexOpenAiKey: z.string().optional(),
	codeIndexQdrantApiKey: z.string().optional(),
	codebaseIndexOpenAiCompatibleBaseUrl: z.string().optional(),
	codebaseIndexOpenAiCompatibleApiKey: z.string().optional(),
	codebaseIndexOpenAiCompatibleModelDimension: z.number().optional(),
	codebaseIndexGeminiApiKey: z.string().optional(),
	codebaseIndexMistralApiKey: z.string().optional(),
	codebaseIndexVercelAiGatewayApiKey: z.string().optional(),
	codebaseIndexOpenRouterApiKey: z.string().optional(),
	codebaseIndexVoyageApiKey: z.string().optional(),
})

export type CodebaseIndexProvider = z.infer<typeof codebaseIndexProviderSchema>
