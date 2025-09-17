import {
	internationalZAiModels,
	mainlandZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	type InternationalZAiModelId,
	type MainlandZAiModelId,
	ZAI_DEFAULT_TEMPERATURE,
	zaiApiLineConfigs, // kilocode_change
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class ZAiHandler extends BaseOpenAiCompatibleProvider<InternationalZAiModelId | MainlandZAiModelId> {
	constructor(options: ApiHandlerOptions) {
		const isChina = zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].isChina // kilocode_change
		const models = isChina ? mainlandZAiModels : internationalZAiModels
		const defaultModelId = isChina ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId

		super({
			...options,
			providerName: "Z AI",
			baseURL: zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].baseUrl, // kilocode_change
			apiKey: options.zaiApiKey ?? "not-provided",
			defaultProviderModelId: defaultModelId,
			providerModels: models,
			defaultTemperature: ZAI_DEFAULT_TEMPERATURE,
		})
	}
}
