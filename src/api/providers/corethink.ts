import { type CorethinkModelId, corethinkDefaultModelId, corethinkModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class CorethinkHandler extends BaseOpenAiCompatibleProvider<CorethinkModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Corethink",
			baseURL: "https://api.corethink.ai/v1/kilo",
			apiKey: options.corethinkApiKey || "API_KEY_NOT_NEEDED_FOR_NOW",
			defaultProviderModelId: corethinkDefaultModelId,
			providerModels: corethinkModels,
			defaultTemperature: 0.5,
		})
	}
}
