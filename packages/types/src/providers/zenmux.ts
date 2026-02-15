// kilocode_change - new file
import type { ModelInfo } from "../model.js"

// Default model for ZenMux - using OpenAI GPT-5 as default
export const zenmuxDefaultModelId = "anthropic/claude-opus-4"

export const zenmuxDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 15.0,
	outputPrice: 75.0,
	cacheWritesPrice: 18.75,
	cacheReadsPrice: 1.5,
	description: "Claude Opus 4 via ZenMux",
}
