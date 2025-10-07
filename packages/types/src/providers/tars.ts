import type { ModelInfo } from "../model.js"

// https://tars.tetrate.ai/
export const tarsDefaultModelId = "claude-sonnet-4-5-20250929"

export const tarsDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: false,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"Claude Sonnet 4.5 - Most advanced Claude model with superior coding, reasoning, and agentic capabilities. Perfect for complex development tasks with 200k context window",
}
