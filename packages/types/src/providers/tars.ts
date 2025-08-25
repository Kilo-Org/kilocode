import type { ModelInfo } from "../model.js"

export const tarsDefaultModelId = "claude-3-5-haiku-20241022"

export const tarsDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200000,
	supportsImages: true,
	supportsComputerUse: false,
	supportsPromptCache: true,
	inputPrice: 0.8,
	outputPrice: 4.0,
	cacheWritesPrice: 1.0,
	cacheReadsPrice: 0.08,
	description:
		"Claude 3.5 Haiku - Fast and cost-effective with excellent coding capabilities. Ideal for development tasks with 200k context window",
}
