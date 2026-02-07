import type { ModelInfo } from "../model.js"
import { ZaiApiLine } from "../provider-settings.js"

// Z AI
// https://docs.z.ai/guides/llm/glm-4-32b-0414-128k
// https://docs.z.ai/guides/llm/glm-4.5
// https://docs.z.ai/guides/llm/glm-4.6
// https://docs.z.ai/guides/llm/glm-4.7
// https://docs.z.ai/guides/overview/pricing
// https://bigmodel.cn/pricing

export type InternationalZAiModelId = keyof typeof internationalZAiModels
export const internationalZAiDefaultModelId: InternationalZAiModelId = "glm-4.7"
export const internationalZAiModels = {
	"glm-4.5": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
	},
	"glm-4.5-air": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.2,
		outputPrice: 1.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.03,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
	},
	"glm-4.5-x": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 2.2,
		outputPrice: 8.9,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.45,
		description:
			"GLM-4.5-X is a high-performance variant optimized for strong reasoning with ultra-fast responses.",
	},
	"glm-4.5-airx": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 1.1,
		outputPrice: 4.5,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.22,
		description: "GLM-4.5-AirX is a lightweight, ultra-fast variant delivering strong performance with lower cost.",
	},
	"glm-4.5-flash": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "GLM-4.5-Flash is a free, high-speed model excellent for reasoning, coding, and agentic tasks.",
	},
	"glm-4.5v": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.6,
		outputPrice: 1.8,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.5V is Z.AI's multimodal visual reasoning model (image/video/text/file input), optimized for GUI tasks, grounding, and document/video understanding.",
	},
	"glm-4.6": {
		maxTokens: 16_384,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.6 is Zhipu's newest model with an extended context window of up to 200k tokens, providing enhanced capabilities for processing longer documents and conversations.",
	},
	// kilocode_change start
	"glm-4.6v": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.3,
		outputPrice: 0.9,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.05,
		description:
			"GLM-4.6V is Z.AI's multimodal visual reasoning model (image/video/text/file input), optimized for GUI tasks, grounding, document/video understanding, native function calling capabilities.",
	},
	"glm-4.6v-flash": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description:
			"GLM-4.6V-Flash is a free, high-speed multimodal model with visual reasoning capabilities, excellent for reasoning, coding, and agentic tasks.",
	},
	// kilocode_change end
	"glm-4.7": {
		maxTokens: 16_384,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsReasoningEffort: ["disable", "medium"],
		reasoningEffort: "medium",
		preserveReasoning: true,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.11,
		description:
			"GLM-4.7 is Zhipu's latest model with built-in thinking capabilities enabled by default. It provides enhanced reasoning for complex tasks while maintaining fast response times.",
		preferredIndex: 1,
	},
	// kilocode_change start
	"glm-4.7-flash": {
		maxTokens: 16_384,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description:
			"GLM-4.7-Flash is a free, high-speed model with built-in thinking capabilities, excellent for reasoning, coding, and agentic tasks.",
		preferredIndex: 2,
	},
	// kilocode_change end
	"glm-4-32b-0414-128k": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.1,
		outputPrice: 0.1,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "GLM-4-32B is a 32 billion parameter model with 128k context length, optimized for efficiency.",
	},
} as const satisfies Record<string, ModelInfo>

export type MainlandZAiModelId = keyof typeof mainlandZAiModels
export const mainlandZAiDefaultModelId: MainlandZAiModelId = "glm-4.7"
export const mainlandZAiModels = {
	"glm-4.5": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
	},
	"glm-4.5-air": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.1,
		outputPrice: 0.6,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.02,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
	},
	"glm-4.5-x": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5-X is a high-performance variant optimized for strong reasoning with ultra-fast responses.",
	},
	"glm-4.5-airx": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.1,
		outputPrice: 0.6,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.02,
		description: "GLM-4.5-AirX is a lightweight, ultra-fast variant delivering strong performance with lower cost.",
	},
	"glm-4.5-flash": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "GLM-4.5-Flash is a free, high-speed model excellent for reasoning, coding, and agentic tasks.",
	},
	"glm-4.5v": {
		maxTokens: 16_384,
		contextWindow: 131_072,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.29,
		outputPrice: 0.93,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5V is Z.AI's multimodal visual reasoning model (image/video/text/file input), optimized for GUI tasks, grounding, and document/video understanding.",
	},
	"glm-4.6": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.6 is Zhipu's newest model with an extended context window of up to 200k tokens, providing enhanced capabilities for processing longer documents and conversations.",
	},
	"glm-4.7": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsReasoningEffort: ["disable", "medium"],
		reasoningEffort: "medium",
		preserveReasoning: true,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.7 is Zhipu's latest model with built-in thinking capabilities enabled by default. It provides enhanced reasoning for complex tasks while maintaining fast response times.",
		preferredIndex: 1,
	},
	// kilocode_change start
	"glm-4.7-flash": {
		maxTokens: 16_384,
		contextWindow: 204_800,
		supportsImages: false,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description:
			"GLM-4.7-Flash is a free, high-speed model with built-in thinking capabilities, excellent for reasoning, coding, and agentic tasks.",
		preferredIndex: 2,
	},
	// kilocode_change end
} as const satisfies Record<string, ModelInfo>

export const ZAI_DEFAULT_TEMPERATURE = 0.6

export const zaiApiLineConfigs = {
	international_coding: {
		name: "International Coding",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		isChina: false,
	},
	china_coding: {
		name: "China Coding",
		baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
		isChina: true,
	},
	international_api: {
		name: "International API",
		baseUrl: "https://api.z.ai/api/paas/v4",
		isChina: false,
	},
	china_api: {
		name: "China API",
		baseUrl: "https://open.bigmodel.cn/api/paas/v4",
		isChina: true,
	},
} satisfies Record<ZaiApiLine, { name: string; baseUrl: string; isChina: boolean }>
