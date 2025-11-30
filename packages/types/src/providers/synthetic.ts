// kilocode_change: provider added - dynamic models only

import type { ModelInfo } from "../model.js"

export type SyntheticModelId = string

export const syntheticDefaultModelId = "hf:zai-org/GLM-4.6"

// Models used in tests and as fallback for dynamic provider
export const syntheticModels: Record<string, ModelInfo> = {
	"hf:zai-org/GLM-4.6": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.19,
		description: "GLM-4.6",
		supportsComputerUse: false,
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		supportedParameters: [],
	},
}
