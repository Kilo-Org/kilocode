// kilocode_change - new file
import type { ModelInfo } from "../model.js"

// https://inference.api.nscale.com/v1
// Nscale is an OpenAI-compatible API with dynamic model fetching
export type NscaleModelId = string

export const nscaleDefaultModelId: NscaleModelId = "meta-llama/Llama-3.3-70B-Instruct"

// Models are fetched dynamically from the Nscale API
// Provide a default model info for the default model to ensure the provider works
export const nscaleModels = {
	"meta-llama/Llama-3.3-70B-Instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
	},
} as const satisfies Record<string, ModelInfo>
