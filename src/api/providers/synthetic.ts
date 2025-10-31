// kilocode_change - provider added

import { type SyntheticModelId, syntheticDefaultModelId, syntheticModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class SyntheticHandler extends BaseOpenAiCompatibleProvider<SyntheticModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Synthetic",
			baseURL: "https://api.synthetic.new/openai/v1",
			apiKey: options.syntheticApiKey,
			defaultProviderModelId: syntheticDefaultModelId,
			providerModels: syntheticModels,
			defaultTemperature: 0.5,
		})
	}
}
