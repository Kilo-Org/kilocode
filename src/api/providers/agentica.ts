// kilocode_change - new file
import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"

import { OpenAiHandler } from "./openai"

// Default model if none specified
const agenticaDefaultModelId = "deca-coder-flash"

// Fallback model info for when we can't get info from the API
const defaultModelInfo: ModelInfo = {
	maxTokens: 32768,
	contextWindow: 128000,
	supportsImages: false,
	supportsPromptCache: false,
}

export class AgenticaHandler extends OpenAiHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			openAiApiKey: options.agenticaApiKey ?? "not-provided",
			openAiModelId: options.apiModelId ?? agenticaDefaultModelId,
			openAiBaseUrl: "https://api.genlabs.dev/agentica/v1",
			openAiStreamingEnabled: true,
			includeMaxTokens: true,
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? agenticaDefaultModelId
		// Use default model info - actual capabilities come from the API
		const info = defaultModelInfo
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}
}
