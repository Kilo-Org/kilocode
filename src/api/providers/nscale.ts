// kilocode_change - new file
import { type NscaleModelId, nscaleDefaultModelId, nscaleModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class NscaleHandler extends BaseOpenAiCompatibleProvider<NscaleModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Nscale",
			baseURL: "https://inference.api.nscale.com/v1",
			apiKey: options.nscaleApiKey,
			defaultProviderModelId: nscaleDefaultModelId,
			providerModels: nscaleModels,
			defaultTemperature: 0,
		})
	}
}
