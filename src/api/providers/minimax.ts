import { type MinimaxModelId, minimaxDefaultModelId, minimaxModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class MiniMaxHandler extends BaseOpenAiCompatibleProvider<MinimaxModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "MiniMax",
			baseURL: options.minimaxBaseUrl ?? "https://api.minimax.io/v1",
			apiKey: options.minimaxApiKey,
			defaultProviderModelId: minimaxDefaultModelId,
			providerModels: minimaxModels,
			defaultTemperature: 1.0,
		})
	}
}
