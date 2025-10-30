// kilocode_change - file added
import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

export async function getOvhCloudAiEndpointsModels(): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://catalog.endpoints.ai.ovh.net/rest/v2/openrouter")
		for (const model of response.data.data) {
			models[model.name] = {
				maxTokens: model.max_output_length,
				contextWindow: model.context_length,
				supportsImages: model.input_modalities.includes("image"),
				supportsPromptCache: model.input_modalities.includes("cache"),
				inputPrice: parseApiPrice(model.pricing.prompt),
				outputPrice: parseApiPrice(model.pricing.completion),
				description: model.description,
			} satisfies ModelInfo
		}
	} catch (error) {
		console.error(
			`Error fetching OVHcloud AI Endpoints models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

	return models
}
