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
		// kilocode_change start pricing updated
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Oct 29, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Oct 29, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Oct 29, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Oct 29, 2025
		// kilocode_change end
		description: `DeepSeek-V3 achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally.`,
	},
	"deepseek-reasoner": {
		maxTokens: 65536, // 64K max output for reasoning mode
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		// kilocode_change start pricing updated
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Oct 29, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Oct 29, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Oct 29, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Oct 29, 2025
		// kilocode_change end
		description: `DeepSeek-R1 achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks. Supports Chain of Thought reasoning with up to 64K output tokens.`,
	},
} as const satisfies Record<string, ModelInfo>

export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.6
