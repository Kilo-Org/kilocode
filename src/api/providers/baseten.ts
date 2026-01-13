import { type BasetenModelId, basetenDefaultModelId, basetenModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class BasetenHandler extends BaseOpenAiCompatibleProvider<BasetenModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Baseten",
			baseURL: "https://inference.baseten.co/v1",
			apiKey: options.basetenApiKey,
			defaultProviderModelId: basetenDefaultModelId,
			providerModels: basetenModels,
			defaultTemperature: 0.5,
		})
	}
}
