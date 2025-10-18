import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"

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

export async function getAIStupidLevelModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const baseURL = "https://api.aistupidlevel.info/v1"

	// Define the standard routing strategies as fallback
	const defaultModels = [
		{
			id: "auto",
			name: "Auto (Best Overall)",
			description: "Best overall performance across all metrics",
			context_window: 200000,
			max_tokens: 8192,
		},
		{
			id: "auto-coding",
			name: "Auto Coding",
			description: "Optimized for code generation and quality",
			context_window: 200000,
			max_tokens: 8192,
		},
		{
			id: "auto-reasoning",
			name: "Auto Reasoning",
			description: "Best for complex reasoning and problem-solving",
			context_window: 200000,
			max_tokens: 8192,
		},
		{
			id: "auto-creative",
			name: "Auto Creative",
			description: "Optimized for creative writing quality",
			context_window: 200000,
			max_tokens: 8192,
		},
		{
			id: "auto-cheapest",
			name: "Auto Cheapest",
			description: "Most cost-effective option",
			context_window: 200000,
			max_tokens: 8192,
		},
		{
			id: "auto-fastest",
			name: "Auto Fastest",
			description: "Fastest response time",
			context_window: 200000,
			max_tokens: 8192,
		},
	]

	try {
		const headers: Record<string, string> = {}
		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get<AIStupidLevelModelsResponse>(`${baseURL}/models`, {
			headers,
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
		inputPrice: model.pricing?.input ? parseApiPrice(model.pricing.input) : 0,
		outputPrice: model.pricing?.output ? parseApiPrice(model.pricing.output) : 0,
		description: model.description || model.name,
	}

	return modelInfo
}
