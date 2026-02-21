// kilocode_change - new file
import type { ModelInfo } from "../model.js"

export const POE_BASE_URL = "https://api.poe.com/v1/"

// Default fallback values for Poe when model metadata is not yet loaded.
export const poeDefaultModelId = "gpt-4o"

export const poeDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 128000,
	supportsImages: true,
	supportsPromptCache: false,
	supportsNativeTools: true,
	inputPrice: 2.25,
	outputPrice: 9.0,
	description: "GPT-4o via Poe API",
}
