import type { ModelInfo } from "../model.js"

export type FireworksModelId =
	| "accounts/fireworks/models/kimi-k2-thinking"
	| "accounts/fireworks/models/kimi-k2-instruct"
	| "accounts/fireworks/models/kimi-k2-instruct-0905"
	| "accounts/fireworks/models/minimax-m2"
	| "accounts/fireworks/models/minimax-m2p1"
	| "accounts/fireworks/models/qwen3-235b-a22b"
	| "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
	| "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct"
	| "accounts/fireworks/models/deepseek-r1-0528"
	| "accounts/fireworks/models/deepseek-v3"
	| "accounts/fireworks/models/deepseek-v3-0324"
	| "accounts/fireworks/models/deepseek-v3p1"
	| "accounts/fireworks/models/deepseek-v3p2"
	| "accounts/fireworks/models/glm-4p5"
	| "accounts/fireworks/models/glm-4p5-air"
	| "accounts/fireworks/models/glm-4p6"
	| "accounts/fireworks/models/glm-4p7"
	| "accounts/fireworks/models/gpt-oss-20b"
	| "accounts/fireworks/models/gpt-oss-120b"

export const fireworksDefaultModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct-0905"

export const fireworksModels = {
	"accounts/fireworks/models/kimi-k2-thinking": {
		maxTokens: 256000,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheReadsPrice: 0.3,
		displayName: "Kimi K2 Thinking",
	},
	"accounts/fireworks/models/kimi-k2-instruct-0905": {
		maxTokens: 16384,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.6,
		outputPrice: 2.5,
		cacheReadsPrice: 0.3,
		displayName: "Kimi K2 Instruct 0905",
		description:
			"Kimi K2 model gets a new version update: Agentic coding: more accurate, better generalization across scaffolds. Frontend coding: improved aesthetics and functionalities on web, 3d, and other tasks. Context length: extended from 128k to 256k, providing better long-horizon support.",
	},
	"accounts/fireworks/models/kimi-k2-instruct": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.6,
		outputPrice: 2.5,
		deprecated: true,
	},
	"accounts/fireworks/models/minimax-m2": {
		maxTokens: 192000,
		contextWindow: 192000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheReadsPrice: 0.15,
		displayName: "MiniMax-M2",
	},
	"accounts/fireworks/models/minimax-m2p1": {
		maxTokens: 200000,
		contextWindow: 200000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 0.3,
		outputPrice: 1.2,
		cacheReadsPrice: 0.15,
		displayName: "MiniMax-M2.1",
	},
	"accounts/fireworks/models/qwen3-235b-a22b": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 0.22,
		outputPrice: 0.88,
		cacheReadsPrice: 0.11,
		displayName: "Qwen3 235B A22B",
	},
	"accounts/fireworks/models/qwen3-235b-a22b-instruct-2507": {
		maxTokens: 256000,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.22,
		outputPrice: 0.88,
		description: "Latest Qwen3 thinking model, competitive against the best closed source models in Jul 2025.",
		displayName: "Qwen3 235B A22B Instruct 2507",
	},
	"accounts/fireworks/models/qwen3-coder-480b-a35b-instruct": {
		maxTokens: 256_000,
		contextWindow: 256_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.45,
		outputPrice: 1.8,
		cacheReadsPrice: 0.23,
		displayName: "Qwen3 Coder 480B A35B Instruct",
	},
	"accounts/fireworks/models/deepseek-r1-0528": {
		maxTokens: 160000,
		contextWindow: 160000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 3,
		outputPrice: 8,
		displayName: "DeepSeek R1 0528",
	},
	"accounts/fireworks/models/deepseek-v3": {
		maxTokens: 16384,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.9,
		outputPrice: 0.9,
		deprecated: true,
		description:
			"A strong Mixture-of-Experts (MoE) language model with 671B total parameters with 37B activated for each token from Deepseek.",
	},
	"accounts/fireworks/models/deepseek-v3-0324": {
		maxTokens: 160000,
		contextWindow: 160000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		inputPrice: 0.9,
		outputPrice: 0.9,
		displayName: "DeepSeek V3 0324",
	},
	"accounts/fireworks/models/deepseek-v3p1": {
		maxTokens: 160_000,
		contextWindow: 160_000,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.56,
		outputPrice: 1.68,
		displayName: "DeepSeek V3.1",
	},
	"accounts/fireworks/models/deepseek-v3p2": {
		maxTokens: 160_000,
		contextWindow: 160_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 0.56,
		outputPrice: 1.68,
		cacheReadsPrice: 0.28,
		displayName: "Deepseek v3.2",
	},
	"accounts/fireworks/models/glm-4p5": {
		maxTokens: 131_072,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.55,
		outputPrice: 2.19,
		displayName: "GLM-4.5",
	},
	"accounts/fireworks/models/glm-4p5-air": {
		maxTokens: 131_072,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
    defaultToolProtocol: "native",
		inputPrice: 0.22,
		outputPrice: 0.88,
		displayName: "GLM-4.5 Air",
		description:
			"Z.ai GLM-4.5-Air with 106B total parameters and 12B active parameters. Features unified reasoning, coding, and intelligent agent capabilities.",
	},
	"accounts/fireworks/models/glm-4p6": {
		maxTokens: 198_000,
		contextWindow: 198_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.55,
		outputPrice: 2.19,
		cacheReadsPrice: 0.28,
		displayName: "GLM-4.6",
	},
	"accounts/fireworks/models/glm-4p7": {
		maxTokens: 198_000,
		contextWindow: 198_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheReadsPrice: 0.3,
		displayName: "GLM-4.7",
	},
	"accounts/fireworks/models/gpt-oss-20b": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
    defaultToolProtocol: "native",
		inputPrice: 0.05,
		outputPrice: 0.2,
		cacheReadsPrice: 0.04,
		displayName: "GPT-OSS 20B",
		description:
			"OpenAI gpt-oss-20b: Compact model for local/edge deployments. Optimized for low-latency and resource-constrained environments with chain-of-thought output, adjustable reasoning, and agentic workflows.",
	},
	"accounts/fireworks/models/gpt-oss-120b": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.15,
		outputPrice: 0.6,
		cacheReadsPrice: 0.08,
		displayName: "GPT-OSS 120B",
	},
} as const satisfies Record<string, ModelInfo>
