import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

const ASKSAGE_DEFAULT_BASE_URL = "https://api.asksage.ai/server/v1"

export async function getAskSageModels(baseUrl?: string, apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const resolvedBaseUrl = baseUrl || ASKSAGE_DEFAULT_BASE_URL
		const modelsUrl = `${resolvedBaseUrl.replace(/\/+$/, "")}/models`

		const response = await axios.get(modelsUrl, { headers })
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens || 4096,
				contextWindow: rawModel.context_window || 128_000,
				supportsPromptCache: false,
				supportsImages: true,
				supportsNativeTools: true,
				defaultToolProtocol: "native",
				inputPrice: rawModel.input_price || 0,
				outputPrice: rawModel.output_price || 0,
				description: rawModel.description,
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching AskSage models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
