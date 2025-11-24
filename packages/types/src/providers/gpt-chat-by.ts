import type { ModelInfo } from "../model.js"

export type GptChatByModelId = keyof typeof gptChatByModels

export const gptChatByDefaultModelId: GptChatByModelId = "coder-flash"

const GTP_CHAT_BY_TAKE_PROFIT_USD = 2.3;

export const gptChatByModels = {
	"coder": {
		maxTokens: 65_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: GTP_CHAT_BY_TAKE_PROFIT_USD,
		outputPrice: 5 * GTP_CHAT_BY_TAKE_PROFIT_USD,
		cacheReadsPrice: 0.2 * GTP_CHAT_BY_TAKE_PROFIT_USD,
		description: `Coder - High-performance coding model with 1M context window for large codebases.`,
	},
	"coder-flash": {
		maxTokens: 65_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.3 * GTP_CHAT_BY_TAKE_PROFIT_USD, // $0.28 per million tokens (cache miss) - Updated Oct 29, 2025
		outputPrice: 1.5 * GTP_CHAT_BY_TAKE_PROFIT_USD, // $0.42 per million tokens - Updated Oct 29, 2025
		cacheReadsPrice: 0.2 * 0.3 * GTP_CHAT_BY_TAKE_PROFIT_USD,
		description: `Coder Flash - Fast coding model with 1M context window optimized for speed.`,
	},
	"turbo": {
		maxTokens: 16_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.05 * GTP_CHAT_BY_TAKE_PROFIT_USD, // $0.28 per million tokens (cache miss) - Updated Oct 29, 2025
		outputPrice: 0.2 * GTP_CHAT_BY_TAKE_PROFIT_USD, // $0.42 per million tokens - Updated Oct 29, 2025
		cacheReadsPrice: 0.2 * 0.05 * GTP_CHAT_BY_TAKE_PROFIT_USD,
		description: `Turbo - Fast model with 1M context window for large codebases.`,
	},
	"plus": {
		maxTokens: 32_000,
		contextWindow: 1_000_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.4 * GTP_CHAT_BY_TAKE_PROFIT_USD, // Updated Oct 29, 2025
		outputPrice: 1.2 * GTP_CHAT_BY_TAKE_PROFIT_USD, // Updated Oct 29, 2025
		cacheReadsPrice: 0.2 * 0.4 * GTP_CHAT_BY_TAKE_PROFIT_USD,
		description: `Plus - High-performance coding model with 1M context window for large requests.`,
	},
	"max": {
		maxTokens: 65_000,
		contextWindow: 262_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.2 * GTP_CHAT_BY_TAKE_PROFIT_USD, // Updated Oct 29, 2025
		outputPrice: 6 * GTP_CHAT_BY_TAKE_PROFIT_USD, // Updated Oct 29, 2025
		cacheReadsPrice: 0.2 * 1.2 * GTP_CHAT_BY_TAKE_PROFIT_USD,
		description: `Coder - Super high-performance model.`,
	},
} as const satisfies Record<string, ModelInfo>

export const GPT_CHAT_BY_DEFAULT_TEMPERATURE = 0.6
