import type { ModelInfo } from "../model.js"

// CometAPI model definitions
// CometAPI provides access to various AI models through their unified API

export const cometApiModels = {
	"cometapi-3-7-sonnet": {
		maxTokens: 8192,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 15.0,
		description: "Anthropic's Claude 3.7 Sonnet via CometAPI",
	},
} as const satisfies Record<string, ModelInfo>

export type CometApiModelId = keyof typeof cometApiModels
export const cometApiDefaultModelId: CometApiModelId = Object.keys(cometApiModels)[0] as CometApiModelId
