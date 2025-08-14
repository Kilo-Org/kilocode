import axios from "axios"

import { type ModelInfo, tarsDefaultModelId, tarsDefaultModelInfo } from "@roo-code/types"

import { ModelRecord } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"

export async function fetchTarsModels(
	apiKey?: string,
	baseUrl = "https://api.router.tetrate.ai/v1",
): Promise<ModelRecord> {
	const models: ModelRecord = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const url = `${baseUrl}/models`
		const response = await axios.get(url, { headers })
		const rawModels = response.data.data

		if (!rawModels || !Array.isArray(rawModels)) {
			return {
				[tarsDefaultModelId]: tarsDefaultModelInfo,
			}
		}

		for (const rawModel of rawModels) {
			const reasoningBudget =
				rawModel.supports_reasoning &&
				(rawModel.id.includes("claude") ||
					rawModel.id.includes("coding/gemini-2.5") ||
					rawModel.id.includes("vertex/gemini-2.5"))
			const reasoningEffort =
				rawModel.supports_reasoning &&
				(rawModel.id.includes("openai") || rawModel.id.includes("google/gemini-2.5"))

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output_tokens,
				contextWindow: rawModel.context_window,
				supportsPromptCache: rawModel.supports_caching,
				supportsImages: rawModel.supports_vision,
				supportsComputerUse: rawModel.supports_computer_use,
				supportsReasoningBudget: reasoningBudget,
				supportsReasoningEffort: reasoningEffort,
				inputPrice: parseApiPrice(rawModel.input_price),
				outputPrice: parseApiPrice(rawModel.output_price),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(rawModel.caching_price),
				cacheReadsPrice: parseApiPrice(rawModel.cached_price),
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching TARS models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
		return {
			[tarsDefaultModelId]: tarsDefaultModelInfo,
		}
	}

	if (Object.keys(models).length === 0) {
		return {
			[tarsDefaultModelId]: tarsDefaultModelInfo,
		}
	}

	return models
}
