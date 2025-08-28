import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

/*
   Get Submodel Models from API
*/
export async function getSubmodelModels(apiKey?: string | null): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get("https://llm.submodel.ai/v1/models", { headers })
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_length,
				contextWindow: rawModel.context_length,
				supportsImages: rawModel.supported_features?.includes("image"),
				supportsComputerUse: rawModel.supported_features?.includes("computer_use"),
				supportsPromptCache: rawModel.supported_features?.includes("caching"),
				inputPrice: parseApiPrice(rawModel.pricing?.prompt),
				outputPrice: parseApiPrice(rawModel.pricing?.completion),
				description: rawModel?.description || null,
				cacheWritesPrice: parseApiPrice(rawModel.pricing?.cache_write),
				cacheReadsPrice: parseApiPrice(rawModel.pricing?.cache_read),
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching Submodel models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
