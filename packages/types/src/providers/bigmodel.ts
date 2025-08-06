// kilocode_change - new file
import type { ModelInfo } from "../model.js"

// https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8
export type BigModelModelId = keyof typeof bigModelModels

export const bigModelDefaultModelId: BigModelModelId = "glm-4.5"

export const bigModelModels = {
	"glm-4.5": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.29,
		outputPrice: 1.14,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.057,
		description:
			"GLM-4.5 is Zhipu's latest featured model. Its comprehensive capabilities in reasoning, coding, and agent reach the state-of-the-art (SOTA) level among open-source models, with a context length of up to 128k.",
		tiers: [
			{
				contextWindow: 32_000,
				inputPrice: 0.21,
				outputPrice: 1.0,
				cacheReadsPrice: 0.043,
			},
			{
				contextWindow: 128_000,
				inputPrice: 0.29,
				outputPrice: 1.14,
				cacheReadsPrice: 0.057,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.29,
				outputPrice: 1.14,
				cacheReadsPrice: 0.057,
			},
		],
	},
	"glm-4.5-air": {
		maxTokens: 98_304,
		contextWindow: 131_072,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.1,
		outputPrice: 0.6,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0.02,
		description:
			"GLM-4.5-Air is the lightweight version of GLM-4.5. It balances performance and cost-effectiveness, and can flexibly switch to hybrid thinking models.",
		tiers: [
			{
				contextWindow: 32_000,
				inputPrice: 0.07,
				outputPrice: 0.4,
				cacheReadsPrice: 0.014,
			},
			{
				contextWindow: 128_000,
				inputPrice: 0.1,
				outputPrice: 0.6,
				cacheReadsPrice: 0.02,
			},
			{
				contextWindow: Infinity,
				inputPrice: 0.1,
				outputPrice: 0.6,
				cacheReadsPrice: 0.02,
			},
		],
	},
	"glm-4.5-flash": {
		maxTokens: 98304,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Zhipu's most advanced free model to date.",
	},
} as const satisfies Record<string, ModelInfo>
