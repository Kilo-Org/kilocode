import type { ModelInfo } from "../model.js"

export const doubaoDefaultModelId = "doubao-seed-code-preview-latest" // kilocode_change

export const doubaoModels = {
	"doubao-seed-1-6-250615": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.0001, // $0.0001 per million tokens (cache miss)
		outputPrice: 0.0004, // $0.0004 per million tokens
		cacheWritesPrice: 0.0001, // $0.0001 per million tokens (cache miss)
		cacheReadsPrice: 0.00002, // $0.00002 per million tokens (cache hit)
		description: `Doubao Seed 1.6 is a powerful model designed for high-performance tasks with extensive context handling.`,
	},
	"doubao-seed-1-6-thinking-250715": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.0002, // $0.0002 per million tokens
		outputPrice: 0.0008, // $0.0008 per million tokens
		cacheWritesPrice: 0.0002, // $0.0002 per million
		cacheReadsPrice: 0.00004, // $0.00004 per million tokens (cache hit)
		description: `Doubao Seed 1.6 Thinking is optimized for reasoning tasks, providing enhanced performance in complex problem-solving scenarios.`,
	},
	"doubao-seed-1-6-flash-250715": {
		maxTokens: 32_768,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.00015, // $0.00015 per million tokens
		outputPrice: 0.0006, // $0.0006 per million tokens
		cacheWritesPrice: 0.00015, // $0.00015 per million
		cacheReadsPrice: 0.00003, // $0.00003 per million tokens (cache hit)
		description: `Doubao Seed 1.6 Flash is tailored for speed and efficiency, making it ideal for applications requiring rapid responses.`,
	},
	// kilocode_change start
	"doubao-seed-code-preview-251028": {
		// https://www.volcengine.com/docs/82379/1925114
		// https://www.volcengine.com/docs/82379/1949118
		maxTokens: 32_768,
		contextWindow: 256_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.1687, // $0.1687 per million tokens
		outputPrice: 1.1247, // $1.1247 per million tokens
		cacheWritesPrice: 0.0024, // $0.0024 per million
		cacheReadsPrice: 0.0337, // $0.0337 per million tokens (cache hit)
		// The price is inaccurate because it's tiered based on the context window size and is billed in CNY. The exchange rate here is based on November 13, 2025.
		description: `Doubao-seed-code is an AI coding model specifically designed for real-world development scenarios, enhancing bug-fixing and front-end capabilities. It supports transparent input caching, reducing usage costs.`,
	},
	"doubao-seed-code-preview-latest": {
		// https://www.volcengine.com/docs/82379/1925114
		// https://www.volcengine.com/docs/82379/1949118
		maxTokens: 32_768,
		contextWindow: 256_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.1687, // $0.1687 per million tokens
		outputPrice: 1.1247, // $1.1247 per million tokens
		cacheWritesPrice: 0.0024, // $0.0024 per million
		cacheReadsPrice: 0.0337, // $0.0337 per million tokens (cache hit)
		// This price is invalid; this is a dedicated model ID for the "coding plan" subscription.
		description: `Doubao-seed-code is an AI coding model specifically designed for real-world development scenarios, enhancing bug-fixing and front-end capabilities. It supports transparent input caching, reducing usage costs.`,
	},
	// kilocode_change end
} as const satisfies Record<string, ModelInfo>

export const doubaoDefaultModelInfo: ModelInfo = doubaoModels[doubaoDefaultModelId]

export const DOUBAO_API_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
export const DOUBAO_API_CHAT_PATH = "/chat/completions"
