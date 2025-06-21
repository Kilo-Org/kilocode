import type { ModelInfo } from "../model.js"

// MakeHub
// https://makehub.ai/models
export type MakehubModelId = keyof typeof makehubModels

export const makehubDefaultModelId: MakehubModelId = "anthropic/claude-4-sonnet"

export const makehubDefaultModelInfo: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 3.0,
	outputPrice: 15.0,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
	description:
		"The best coding model, optimized by MakeHub, and automatically routed to the fastest provider. Claude 4 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities.",
}

export const makehubModels = {
	"anthropic/claude-4-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsComputerUse: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 3.75,
		cacheReadsPrice: 0.3,
		description:
			"The best coding model, optimized by MakeHub, and automatically routed to the fastest provider. Claude 4 Sonnet is an advanced large language model with improved reasoning, coding, and problem-solving capabilities.",
	},
} as const satisfies Record<string, ModelInfo>

export const MAKEHUB_DEFAULT_TEMPERATURE = 0
