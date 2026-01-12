// kilocode_change new file
import type { ModelInfo } from "../model.js"

// Gemini CLI models with free tier pricing (all $0)
export type GeminiCliModelId = keyof typeof geminiCliModels

export const geminiCliDefaultModelId: GeminiCliModelId = "gemini-2.5-flash"

export const geminiCliModels = {
	"gemini-3-pro-preview": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		supportsReasoningBudget: true,
		maxThinkingTokens: 32_768,
	},
	"gemini-3-flash-preview": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		supportsReasoningBudget: true,
		maxThinkingTokens: 32_768,
	},
	"gemini-2.5-pro": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		maxThinkingTokens: 32_768,
		supportsReasoningBudget: true,
		requiredReasoningBudget: true,
	},
	"gemini-2.5-flash": {
		maxTokens: 64_000,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		maxThinkingTokens: 24_576,
		supportsReasoningBudget: true,
	},
} as const satisfies Record<string, ModelInfo>
