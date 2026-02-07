// kilocode_change - new file
import axios from "axios"

import type { ModelInfo } from "@roo-code/types"

/**
 * Parse features field (may be comma-separated string or array)
 */
function parseFeatures(features: string | string[] | undefined): string[] {
	if (!features) return []
	if (Array.isArray(features)) return features
	return features.split(",").map((f) => f.trim())
}

/**
 * Parse input_modalities field (may be comma-separated string or array)
 */
function parseModalities(modalities: string | string[] | undefined): string[] {
	if (!modalities) return []
	if (Array.isArray(modalities)) return modalities
	return modalities.split(",").map((m) => m.trim())
}

export interface GetAihubmixModelsOptions {
	baseUrl?: string
	apiKey?: string
}

/**
 * Fetch available models from AIhubmix API
 * API: https://aihubmix.com/api/v1/models?type=llm&sort_by=coding
 */
export async function getAihubmixModels(options?: GetAihubmixModelsOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseUrl = options?.baseUrl || "https://aihubmix.com"

	try {
		const response = await axios.get(`${baseUrl}/api/v1/models?type=llm&sort_by=coding`)

		if (!response.data?.success || !Array.isArray(response.data?.data)) {
			console.error("Invalid response from AIhubmix API:", response.data)
			return models
		}

		const rawModels = response.data.data

		let preferredIndex = 0
		for (const rawModel of rawModels) {
			if (!rawModel.model_id || typeof rawModel.model_id !== "string") {
				continue
			}

			const features = parseFeatures(rawModel.features)
			const inputModalities = parseModalities(rawModel.input_modalities)
			const pricing = rawModel.pricing || {}

			// Check if model supports images
			const supportsImages = inputModalities.includes("image")

			// Check if model supports thinking/reasoning
			const supportsThinking = features.includes("thinking")

			// Check if model supports prompt cache: cache_read price differs from input price
			const supportsPromptCache =
				pricing.cache_read !== undefined && pricing.input !== undefined && pricing.cache_read !== pricing.input

			const modelInfo: ModelInfo = {
				maxTokens: rawModel.max_output ?? 8192,
				contextWindow: rawModel.context_length ?? 128000,
				supportsImages,
				supportsPromptCache,
				supportsNativeTools: true,
				defaultToolProtocol: "native",
				inputPrice: pricing.input,
				outputPrice: pricing.output,
				cacheWritesPrice: pricing.cache_write,
				cacheReadsPrice: pricing.cache_read,
				description: rawModel.desc || "",
				preferredIndex, // Preserve API return order (sort_by=coding)
				// If thinking is supported, set reasoning-related properties
				...(supportsThinking && rawModel.thinking_config
					? {
							supportsReasoningBudget: true,
						}
					: {}),
			}

			models[rawModel.model_id] = modelInfo
			preferredIndex++
		}

		console.log(`Fetched ${Object.keys(models).length} AIhubmix models`)
	} catch (error) {
		console.error(`Error fetching AIhubmix models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
	}

	return models
}
