import type { ModelInfo } from "../model.js"

export const corethinkModels = {
	"corethink": {
		maxTokens: 8192,
		contextWindow: 79000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		inputPrice: 1.0,
		outputPrice: 1.0,
		cacheWritesPrice: 0,
		cacheReadsPrice: 0,
		description: "Corethink 1 - AI coding assistant powered by Corethink.",
	},
} as const satisfies Record<string, ModelInfo>

export type CorethinkModelId = keyof typeof corethinkModels

export const corethinkDefaultModelId = "corethink" satisfies CorethinkModelId
