import axios from "axios"
import { z } from "zod"

import { type ModelInfo, modelParametersSchema } from "@roo-code/types"

import type { ModelRecord } from "../../../shared/api"

// API constants
export const CHUTES_API_URL = "https://llm.chutes.ai/v1/models"
export const CHUTES_CACHE_DURATION = 1000 * 60 * 30 // 30 minutes

// Zod schemas for type safety
const chutesPriceSchema = z.object({
	input: z.object({
		tao: z.number(),
		usd: z.number(),
	}),
	output: z.object({
		tao: z.number(),
		usd: z.number(),
	}),
})

const chutesModelSchema = z.object({
	id: z.string(),
	root: z.string(),
	price: chutesPriceSchema,
	object: z.literal("model"),
	created: z.number(),
	pricing: z.object({
		prompt: z.number(),
		completion: z.number(),
	}),
	owned_by: z.string(),
	quantization: z.string().optional(),
	max_model_len: z.number(),
	context_length: z.number(),
	input_modalities: z.array(z.string()),
	max_output_length: z.number(),
	output_modalities: z.array(z.string()),
	supported_features: z.array(z.string()).optional(),
	supported_sampling_parameters: z.array(z.string()).optional(),
})

const chutesApiResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(chutesModelSchema),
})

/**
 * Represents a Chutes.ai model available through the API
 */
export type ChutesModel = z.infer<typeof chutesModelSchema>

/**
 * Represents the Chutes.ai API response
 */
export type ChutesApiResponse = z.infer<typeof chutesApiResponseSchema>

interface CacheEntry {
	data: ModelRecord
	rawModels?: ChutesModel[]
	timestamp: number
}

let cache: CacheEntry | null = null

/**
 * Parse a Chutes.ai model into ModelInfo format.
 *
 * @param model - The Chutes.ai model to parse
 * @returns ModelInfo object compatible with the application's model system
 */
function parseChutesModel(model: ChutesModel): ModelInfo {
	// Extract pricing information
	const inputPrice = model.price?.input?.usd
	const outputPrice = model.price?.output?.usd

	// Determine image support
	const supportsImages = model.input_modalities.includes("image")

	// Determine supported features
	const supportedFeatures = model.supported_features || []
	const supportsReasoning = supportedFeatures.includes("reasoning")
	const supportsTools = supportedFeatures.includes("tools")
	const supportsJson = supportedFeatures.includes("json_mode")
	const supportsStructuredOutputs = supportedFeatures.includes("structured_outputs")

	// Build description based on features
	let description = `${model.owned_by} model`
	if (supportsReasoning) {
		description += " with reasoning capabilities"
	}
	if (supportsImages) {
		description += " with vision support"
	}
	if (supportsTools) {
		description += " with tool calling"
	}
	if (supportsJson || supportsStructuredOutputs) {
		description += " with structured output support"
	}
	if (model.quantization) {
		description += ` (${model.quantization})`
	}

	// Determine supported parameters
	const supportedParameters: Array<"max_tokens" | "temperature" | "reasoning" | "include_reasoning"> = [
		"max_tokens",
		"temperature",
	]
	if (supportsReasoning) {
		supportedParameters.push("reasoning", "include_reasoning")
	}

	return {
		maxTokens: model.max_model_len,
		contextWindow: model.context_length,
		supportsImages,
		supportsPromptCache: false, // Chutes.ai doesn't provide this info
		supportsComputerUse: false, // Chutes.ai doesn't provide this info
		supportsReasoningBudget: supportsReasoning,
		supportsTemperature: true, // Most models support temperature
		supportedParameters,
		inputPrice,
		outputPrice,
		description,
	}
}

/**
 * Fetches available models from Chutes.ai
 *
 * @param apiKey - Optional API key for Chutes.ai
 * @returns A promise that resolves to a record of model IDs to model info
 * @throws Will throw an error if the request fails
 */
export async function getChutesModels(apiKey?: string): Promise<ModelRecord> {
	const now = Date.now()

	if (cache && now - cache.timestamp < CHUTES_CACHE_DURATION) {
		return cache.data
	}

	const models: ModelRecord = {}

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get<ChutesApiResponse>(CHUTES_API_URL, {
			headers,
			timeout: 10000,
		})

		const result = chutesApiResponseSchema.safeParse(response.data)

		if (!result.success) {
			console.error("Chutes.ai models response validation failed:", result.error.format())
			throw new Error("Invalid response format from Chutes.ai API")
		}

		for (const model of result.data.data) {
			models[model.id] = parseChutesModel(model)
		}

		cache = { data: models, rawModels: result.data.data, timestamp: now }

		return models
	} catch (error) {
		console.error("Error fetching Chutes.ai models:", error)

		if (cache) {
			return cache.data
		}

		if (axios.isAxiosError(error)) {
			if (error.response) {
				throw new Error(
					`Failed to fetch Chutes.ai models: ${error.response.status} ${error.response.statusText}`,
				)
			} else if (error.request) {
				throw new Error(
					"Failed to fetch Chutes.ai models: No response from server. Check your internet connection.",
				)
			}
		}

		throw new Error(`Failed to fetch Chutes.ai models: ${error instanceof Error ? error.message : "Unknown error"}`)
	}
}

/**
 * Get cached models without making an API request.
 */
export function getCachedChutesModels(): ModelRecord | null {
	return cache?.data || null
}

/**
 * Get cached raw models for UI display.
 */
export function getCachedRawChutesModels(): ChutesModel[] | null {
	return cache?.rawModels || null
}

/**
 * Clear the Chutes.ai cache.
 */
export function clearChutesCache(): void {
	cache = null
}

export interface ChutesModelsResponse {
	models: ChutesModel[]
	cached: boolean
	timestamp: number
}

/**
 * Get Chutes.ai models with metadata for UI display.
 */
export async function getChutesModelsWithMetadata(apiKey?: string): Promise<ChutesModelsResponse> {
	try {
		// First, trigger the fetch to populate cache.
		await getChutesModels(apiKey)

		// Get the raw models from cache.
		const cachedRawModels = getCachedRawChutesModels()

		if (cachedRawModels) {
			return {
				models: cachedRawModels,
				cached: true,
				timestamp: Date.now(),
			}
		}

		// If no cached raw models, fetch directly from API.
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		const response = await axios.get<ChutesApiResponse>(CHUTES_API_URL, {
			headers,
			timeout: 10000,
		})

		const models = response.data?.data || []

		return {
			models,
			cached: false,
			timestamp: Date.now(),
		}
	} catch (error) {
		console.error("Failed to get Chutes.ai models:", error)
		return { models: [], cached: false, timestamp: Date.now() }
	}
}
