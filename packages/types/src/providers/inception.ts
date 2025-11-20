// kilocode_change - file added

import type { ModelInfo } from "../model.js"

// Default fallback values for Inception when model metadata is not yet loaded.

export const inceptionDefaultModelId = "mercury-coder"

export const inceptionDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 128000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0.00000025,
	outputPrice: 0.000001,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
}
