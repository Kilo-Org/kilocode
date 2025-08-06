import {
	type FireworksModelId,
	fireworksDefaultModelId,
	fireworksModels,
	FIREWORKS_API_BASE_URL,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class FireworksHandler extends BaseOpenAiCompatibleProvider<FireworksModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Fireworks",
			baseURL: FIREWORKS_API_BASE_URL,
			apiKey: options.fireworksApiKey,
			defaultProviderModelId: fireworksDefaultModelId,
			providerModels: fireworksModels,
			defaultTemperature: 0.5,
		})
	}
}
