// kilocode_change - provider added

import {
	type zaiModelId,
	zaiApiLineConfigs,
	zaiCodingModels,
	zaiCodingDefaultModelId,
	ZAI_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class ZAiHandler extends BaseOpenAiCompatibleProvider<zaiModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Z AI",
			baseURL: zaiApiLineConfigs[options.zaiApiLine ?? "international_coding"].baseUrl,
			apiKey: options.zaiApiKey || "not-provided",
			defaultProviderModelId: zaiCodingDefaultModelId,
			providerModels: zaiCodingModels,
			defaultTemperature: ZAI_DEFAULT_TEMPERATURE,
		})
	}
}
