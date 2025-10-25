import axios from "axios"
import { z } from "zod"

import { aiStupidLevelFallbackModels, type ModelInfo } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

/**
 * AIStupidLevelModel
 */

const aiStupidLevelModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	context_window: z.number().optional(),
	max_tokens: z.number().optional(),
	pricing: z
		.object({
			input: z.string().optional(),
			output: z.string().optional(),
		})
		.optional(),
})

export type AIStupidLevelModel = z.infer<typeof aiStupidLevelModelSchema>

/**
 * AIStupidLevelModelsResponse
 */

const aiStupidLevelModelsResponseSchema = z.object({
	data: z.array(aiStupidLevelModelSchema),
})

type AIStupidLevelModelsResponse = z.infer<typeof aiStupidLevelModelsResponseSchema>

/**
 * getAIStupidLevelModels
 */

export async function getAIStupidLevelModels(apiKey: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = "https://api.aistupidlevel.info/v1"

	// Create default models from fallback list
	const defaultModels = aiStupidLevelFallbackModels.map((id) => ({
		id,
		context_window: 200000,
		max_tokens: 8192,
	}))

	try {
		const response = await axios.get<AIStupidLevelModelsResponse>(`${baseURL}/models`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			timeout: 10000,
		})

		const result = aiStupidLevelModelsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("AIStupidLevel models response is invalid", result.error.format())
		}

		if (data && data.length > 0) {
			for (const model of data) {
				models[model.id] = parseAIStupidLevelModel(model)
			}
		} else {
			// Use default models if API doesn't return any
			for (const model of defaultModels) {
				models[model.id] = parseAIStupidLevelModel(model)
			}
		}
	} catch (error) {
		console.error(
			`Error fetching AIStupidLevel models, using defaults: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)

		// Use default models on error
		for (const model of defaultModels) {
			models[model.id] = parseAIStupidLevelModel(model)
		}
	}

	return models
}

/**
 * parseAIStupidLevelModel
 */

export const parseAIStupidLevelModel = (model: AIStupidLevelModel): ModelInfo => {
	const modelInfo: ModelInfo = {
		maxTokens: model.max_tokens || 8192,
		contextWindow: model.context_window || 200000,
		supportsImages: true, // AIStupidLevel routes to models that support images
		supportsComputerUse: false,
		supportsPromptCache: false,
		inputPrice: model.pricing?.input ? parseApiPrice(model.pricing.input) : 0.5,
		outputPrice: model.pricing?.output ? parseApiPrice(model.pricing.output) : 1.5,
		description: model.description || model.name,
	}

	return modelInfo
}
