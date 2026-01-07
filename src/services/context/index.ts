// kilocode_change - new file
// Context services exports

export {
	IncrementalContextManager,
	type DirtyFile,
	type ContextChunk,
	type IncrementalIndexingStats,
} from "./incremental-context-manager"

export {
	RelevanceEngine,
	getRelevanceEngine,
	resetRelevanceEngine,
	type RelevanceFactors,
	type ScoredItem,
	type ScoringWeights,
	type UserFeedback,
	type RelevanceEngineConfig,
} from "./relevance-engine"
