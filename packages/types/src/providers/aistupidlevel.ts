import type { ModelInfo } from "../model.js"

export const aiStupidLevelDefaultModelId = "auto-coding"

export const aiStupidLevelDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200000,
	supportsImages: true,
	supportsComputerUse: false,
	supportsPromptCache: false,
	// Pricing varies by underlying model selected, these are approximate averages
	inputPrice: 0.5, // ~$0.50 per million input tokens (average across routed models)
	outputPrice: 1.5, // ~$1.50 per million output tokens (average across routed models)
	description: "Optimized for code generation and quality",
}

export const AISTUPIDLEVEL_DEFAULT_TEMPERATURE = 0.7

// Default fallback models when API fetch fails
export const aiStupidLevelFallbackModels = [
	"auto",
	"auto-coding",
	"auto-reasoning",
	"auto-creative",
	"auto-cheapest",
	"auto-fastest",
]
