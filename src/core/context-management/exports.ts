// kilocode_change - updated exports
// Context management module exports

export {
	estimateTokenCount,
	truncateConversation,
	manageContext,
	willManageContext,
	TOKEN_BUFFER_PERCENTAGE,
	type TruncationResult,
	type WillManageContextOptions,
	type ContextManagementOptions,
	type ContextManagementResult,
} from "./index"

export {
	TokenCountingCache,
	getTokenCountingCache,
	resetTokenCountingCache,
	type TokenCacheConfig,
} from "./token-cache"

export {
	ContextPrioritizer,
	getContextPrioritizer,
	resetContextPrioritizer,
	type ContextPriorityLevel,
	type PrioritizedContextItem,
	type PrioritizationConfig,
	type PrioritizationContext,
	type PrioritizationResult,
} from "./prioritizer"

export {
	SemanticCompressor,
	getSemanticCompressor,
	resetSemanticCompressor,
	type CompressionLevel,
	type CompressedContent,
	type SemanticCompressorConfig,
} from "./semantic-compressor"
