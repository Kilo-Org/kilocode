// kilocode_change - new file
// Condense module exports

export {
	summarizeConversation,
	getMessagesSinceLastSummary,
	getEffectiveApiHistory,
	cleanupAfterTruncation,
	hasToolResultBlocks,
	getToolUseBlocks,
	getKeepMessagesWithToolBlocks,
	N_MESSAGES_TO_KEEP,
	MIN_CONDENSE_THRESHOLD,
	MAX_CONDENSE_THRESHOLD,
	type SummarizeResponse,
} from "./index"

export {
	HierarchicalSummarizer,
	getHierarchicalSummarizer,
	resetHierarchicalSummarizer,
	type SummaryLevel,
	type SummaryNode,
	type SummaryTree,
	type HierarchicalSummarizerConfig,
} from "./hierarchical-summarizer"
