// kilocode_change - new file
import type { ModelInfo } from "../model.js"

// https://docs.z.ai/api-reference/llm/chat-completion
export type ZAIModelId = keyof typeof zaiModels

export const zaiDefaultModelId: ZAIModelId = "glm-4.5"

export const zaiModels = {
	"glm-4.5": {
		maxTokens: 98304,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.2,
		cacheWritesPrice: 0.11,
		cacheReadsPrice: 0,
		description:
			"Z.ai‘s latest flagship model reaches SOTA among global open-source models in overall capabilities, and for the first time natively integrates reasoning, coding, and agent functionalities within a single model!",
	},
	"glm-4.5-air": {
		maxTokens: 98304,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 1.1,
		cacheWritesPrice: 0.03,
		cacheReadsPrice: 0,
		description:
			"Z.ai's new lightweight flagship model delivers SOTA performance with exceptional cost-effectiveness!",
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
