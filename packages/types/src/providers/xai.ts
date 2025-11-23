import type { ModelInfo } from "../model.js"

// https://docs.x.ai/docs/api-reference
export type XAIModelId = keyof typeof xaiModels

export const xaiDefaultModelId: XAIModelId = "grok-code-fast-1"

export const xaiModels = {
	"grok-code-fast-1": {
		maxTokens: 16_384,
		contextWindow: 262_144,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.2,
		outputPrice: 1.5,
		cacheWritesPrice: 0.02,
		cacheReadsPrice: 0.02,
		description: "xAI's Grok Code Fast model with 256K context window",
	},
	"grok-4": {
		maxTokens: 8192,
		contextWindow: 256000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.0,
		outputPrice: 15.0,
		cacheWritesPrice: 0.75,
		cacheReadsPrice: 0.75,
		description: "xAI's Grok-4 model with 256K context window",
	},
	// kilocode_change start
	"grok-4-fast": {
		maxTokens: 30_000,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.4, // This is the pricing for prompts above 128K context
		outputPrice: 1.0,
		cacheReadsPrice: 0.05,
		description: "xAI's Grok-4-Fast model with reasonning and a 2M context window",
		tiers: [
			{
				contextWindow: 128_000,
				inputPrice: 0.2,
				outputPrice: 0.5,
				cacheReadsPrice: 0.05,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.4,
				outputPrice: 1,
				cacheReadsPrice: 0.05,
			},
		],
	},
	"grok-4-fast-non-reasoning": {
		maxTokens: 30_000,
		contextWindow: 2_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.4, // This is the pricing for prompts above 128K context
		outputPrice: 1.0,
		cacheReadsPrice: 0.05,
		description: "xAI's Grok-4-Fast model without reasonning and with a 2M context window",
		tiers: [
			{
				contextWindow: 128_000,
				inputPrice: 0.2,
				outputPrice: 0.5,
				cacheReadsPrice: 0.05,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.4,
				outputPrice: 1,
				cacheReadsPrice: 0.05,
			},
		],
	}
} as const satisfies Record<string, ModelInfo>
