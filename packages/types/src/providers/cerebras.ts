import type { ModelInfo } from "../model.js"

// https://inference-docs.cerebras.ai/api-reference/chat-completions
export type CerebrasModelId = keyof typeof cerebrasModels

export const cerebrasDefaultModelId: CerebrasModelId = "gpt-oss-120b"

export const cerebrasModels = {
	"zai-glm-4.7": {
		maxTokens: 16384, // Conservative default to avoid premature rate limiting (Cerebras reserves quota upfront)
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsTemperature: true,
		defaultTemperature: 0.9,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Highly capable general-purpose model on Cerebras (up to 1,000 tokens/s), competitive with leading proprietary models on coding tasks.",
	},
	"qwen-3-235b-a22b-instruct-2507": {
		maxTokens: 16384, // Conservative default to avoid premature rate limiting
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		description: "Intelligent model with ~1400 tokens/s",
	},
	"gpt-oss-120b": {
		maxTokens: 16384, // Conservative default to avoid premature rate limiting
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		description:
			"OpenAI GPT OSS model with ~2800 tokens/s\n\n• 64K context window\n• Excels at efficient reasoning across science, math, and coding",
	},
} as const satisfies Record<string, ModelInfo>
