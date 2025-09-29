import type { ModelInfo } from "../model.js"

// https://platform.deepseek.com/docs/api
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"

export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Sept 29, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Sept 29, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Sept 29, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Sept 29, 2025
		description: `DeepSeek-V3.2 (Non-thinking Mode). Optimized for speed and efficiency without explicit reasoning traces. Best for general chat, fast API responses, and lightweight tasks while still leveraging V3.1’s strong performance across domains.`,
	},
	"deepseek-reasoner": {
		maxTokens: 65536, // 64K max output for reasoning mode
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Sept 29, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Sept 29, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Sept 29, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Sept 29, 2025
		description: `DeepSeek-V3.2 (Thinking Mode). Enables advanced reasoning with visible chain-of-thought traces and extended outputs (up to 64K tokens). Recommended for math, coding, and complex multi-step problems where reasoning quality is critical.`,
	},
} as const satisfies Record<string, ModelInfo>

export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.6
