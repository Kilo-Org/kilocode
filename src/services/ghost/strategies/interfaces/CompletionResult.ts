import { FillInAtCursorSuggestion } from "../../classic-auto-complete/HoleFiller"

/**
 * Standardized result structure for all completion strategies
 */
export interface CompletionResult {
	/** The generated completion suggestion */
	suggestion: FillInAtCursorSuggestion

	/** Cost information for the completion */
	cost: number

	/** Token usage information */
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number

	/** Which strategy was used to generate this result */
	strategyUsed: string

	/** Optional: Performance metrics */
	metrics?: {
		duration: number
		promptGenerationTime: number
		serverCallTime: number
	}

	/** Optional: Strategy-specific metadata */
	strategyMetadata?: Record<string, any>
}
