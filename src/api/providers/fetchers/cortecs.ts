import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

export async function getCortecsModels(baseUrl?: string, apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		baseUrl = (baseUrl || "https://api.cortecs.ai/v1/").replace(/\/?$/, "/")
		const modelsUrl = new URL("models?tag=Code", baseUrl)

		const response = await axios.get(modelsUrl.toString(), { headers })
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const modelInfo: ModelInfo = {
				maxTokens: rawModel.context_size,
				contextWindow: rawModel.context_size,
				supportsPromptCache: false,
				supportsImages: rawModel.tags.includes("Image"),
				supportsComputerUse: false,
				inputPrice: rawModel.pricing.input_token,
				outputPrice: rawModel.pricing.input_token,
				description: rawModel.description,
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching cortecs models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
