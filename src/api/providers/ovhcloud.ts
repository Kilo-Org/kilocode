import {
	type OVHCloudAiEndpointsModelId,
	ovhCloudAiEndpointsDefaultModelId,
	ovhCloudAiEndpointsModels,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class OVHCloudAIEndpointsHandler extends BaseOpenAiCompatibleProvider<OVHCloudAiEndpointsModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "OVHCloud AI Endpoints",
			baseURL: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
			apiKey: options.ovhCloudAiEndpointsApiKey,
			defaultProviderModelId: ovhCloudAiEndpointsDefaultModelId,
			providerModels: ovhCloudAiEndpointsModels,
			defaultTemperature: 0.7,
		})
	}
}
