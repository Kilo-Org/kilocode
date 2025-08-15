// kilocode_change -- file added

import type { ModelInfo } from "../model.js"
import type { ProviderName } from "../provider-settings.js"

export const qwenCodeModels = {
	"qwen3-coder-plus": {
		id: "qwen3-coder-plus",
		name: "Qwen3 Coder Plus",
		provider: "qwen-code" as ProviderName,
		contextWindow: 1000000,
		maxTokens: 65536,
		supportsPromptCache: false,
	},
	"qwen3-coder-flash": {
		id: "qwen3-coder-flash",
		name: "Qwen3 Coder Flash",
		provider: "qwen-code" as ProviderName,
		contextWindow: 1000000,
		maxTokens: 65536,
		supportsPromptCache: false,
	},
} as const

export type QwenCodeModelId = keyof typeof qwenCodeModels

export const qwenCodeDefaultModelId: QwenCodeModelId = "qwen3-coder-plus"

export const isQwenCodeModel = (modelId: string): modelId is QwenCodeModelId => {
	return modelId in qwenCodeModels
}

export const getQwenCodeModelInfo = (modelId: string): ModelInfo => {
	if (isQwenCodeModel(modelId)) {
		return qwenCodeModels[modelId]
	}
	// Fallback to a default or throw an error
	return qwenCodeModels[qwenCodeDefaultModelId]
}

export type QwenCodeProvider = {
	id: "qwen-code"
	apiKey?: string
	baseUrl?: string
	model: QwenCodeModelId
}
