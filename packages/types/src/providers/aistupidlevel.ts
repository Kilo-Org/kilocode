import type { ModelInfo } from "../model.js"

export const aiStupidLevelDefaultModelId = "auto-coding"

export const aiStupidLevelDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200000,
	supportsImages: true,
	supportsComputerUse: false,
	supportsPromptCache: false,
	inputPrice: 0,
	outputPrice: 0,
	description: "Optimized for code generation and quality",
}

export const AISTUPIDLEVEL_DEFAULT_TEMPERATURE = 0.7
