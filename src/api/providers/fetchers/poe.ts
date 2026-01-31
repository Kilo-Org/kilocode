// kilocode_change - file added
import axios from "axios"

import { type ModelInfo, POE_BASE_URL } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

export async function getPoeModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}
		const modelsUrl = new URL("models", POE_BASE_URL)

		const response = await axios.get(modelsUrl.toString(), { headers })
		const rawModels = response.data.data

		for (const rawModel of rawModels) {
			const { architecture, reasoning, context_window } = rawModel

			const supportText = architecture?.output_modalities?.includes("text")

			if (!supportText) {
				continue
			}

			const supportsImages = architecture?.input_modalities?.includes("image") ?? false

			// Read reasoning capabilities from the API's reasoning object
			const supportsReasoningBudget = reasoning?.budget ? true : false
			const supportsReasoningEffort = reasoning?.supports_reasoning_effort ?? false
			const requiredReasoningBudget = reasoning?.required ?? false

			// Handle context window structure
			const contextLength = context_window?.context_length ?? 0
			const maxOutputTokens = context_window?.max_output_tokens ?? 0

			// Determine cache support from pricing fields
			const hasCacheReads = rawModel.pricing?.input_cache_read || rawModel.pricing?.cache_read
			const supportsPromptCache = !!hasCacheReads

			const modelInfo: ModelInfo = {
				maxTokens: maxOutputTokens,
				contextWindow: contextLength,
				supportsPromptCache,
				supportsImages,
				supportsComputerUse: rawModel.supports_computer_use,
				supportsReasoningBudget,
				supportsReasoningEffort,
				requiredReasoningBudget: requiredReasoningBudget || undefined,
				inputPrice: parseApiPrice(rawModel.pricing?.prompt),
				outputPrice: parseApiPrice(rawModel.pricing?.completion),
				description: rawModel.description,
				cacheWritesPrice: parseApiPrice(
					rawModel.pricing?.input_cache_write || rawModel.pricing?.cache_creation,
				),
				cacheReadsPrice: parseApiPrice(rawModel.pricing?.input_cache_read || rawModel.pricing?.cache_read),
			}

			models[rawModel.id] = modelInfo
		}
	} catch (error) {
		console.error(`Error fetching Poe models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
