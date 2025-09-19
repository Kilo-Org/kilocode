import type { ModelInfo } from "../model.js"

export const submodelDefaultModelId = "Qwen/Qwen3-235B-A22B-Instruct-2507"

export const submodelDefaultModelInfo: ModelInfo = {
	maxTokens: 32768,
	contextWindow: 262144,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0.2,
	outputPrice: 0.3,
	description: "Qwen3 235B A22B Instruct 2507 model with 262K context window.",
}
