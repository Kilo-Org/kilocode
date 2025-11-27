// kilocode_change - new file
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { DEFAULT_HEADERS } from "../constants"

/**
 * NanoGptModel
 *
 * Nano-GPT API with ?detailed=true returns comprehensive model information.
 */

const nanoGptCapabilitiesSchema = z.object({
	vision: z.boolean().optional(),
})

const nanoGptPricingSchema = z.object({
	prompt: z.number().optional(),
	completion: z.number().optional(),
	currency: z.string().optional(),
	unit: z.string().optional(),
})

export const nanoGptModelSchema = z.object({
	id: z.string(),
	object: z.string().optional(),
	created: z.number().optional(),
	owned_by: z.string().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	context_length: z.number().nullable().optional(),
	capabilities: nanoGptCapabilitiesSchema.optional(),
	pricing: nanoGptPricingSchema.optional(),
	cost_estimate: z.number().nullable().optional(),
	icon_url: z.string().optional(),
})

export type NanoGptModel = z.infer<typeof nanoGptModelSchema>

/**
 * NanoGptModelsResponse
 */

const nanoGptModelsResponseSchema = z.object({
	object: z.string().optional(),
	data: z.array(nanoGptModelSchema),
})

/**
 * getNanoGptModels
 */

export async function getNanoGptModels(options?: {
	nanoGptModelList?: "all" | "personalized" | "subscription"
	apiKey?: string
	headers?: Record<string, string>
}): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}
	const modelListType = options?.nanoGptModelList || "all"

	let path: string
	switch (modelListType) {
		case "personalized":
			path = "/api/personalized/v1/models"
			break
		case "subscription":
			path = "/api/subscription/v1/models"
			break
		case "all":
		default:
			path = "/api/v1/models"
			break
	}

	const baseURL = "https://nano-gpt.com"

	// Prepare headers with API key
	// NOTE: Don't send API key for "all" endpoint because authenticated requests
	// may return filtered results. The "all" endpoint is public and returns all 448 models.
	// API key is only needed for "personalized" and "subscription" endpoints.
	const headers: Record<string, string> = { ...DEFAULT_HEADERS }
	const needsApiKey = modelListType === "personalized" || modelListType === "subscription"

	if (needsApiKey && options?.apiKey) {
		headers.Authorization = `Bearer ${options.apiKey}`
	}
	if (options?.headers) {
		Object.assign(headers, options.headers)
	}

	try {
		// Add ?detailed=true to get comprehensive model information
		const url = `${baseURL}${path}?detailed=true`
		const response = await fetch(url, {
			headers,
		})

		if (!response.ok) {
			const errorText = await response.text()
			console.error(`Nano-GPT API error (${response.status}): ${errorText}`)
			throw new Error(`Nano-GPT API returned ${response.status}: ${errorText}`)
		}

		const json = await response.json()

		// Handle error responses from the API
		if (json.error) {
			console.error(`Nano-GPT API error: ${json.error}`)
			throw new Error(`Nano-GPT API error: ${json.error}`)
		}

		const result = nanoGptModelsResponseSchema.safeParse(json)

		if (!result.success) {
			throw new Error(
				"Nano-GPT models response is invalid: " + JSON.stringify(result.error.format(), undefined, 2),
			)
		}

		for (const model of result.data.data) {
			models[model.id] = parseNanoGptModel({
				model,
				displayName: model.name || model.id,
			})
		}
	} catch (error) {
		console.error(
			`Error fetching Nano-GPT models from ${path}: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
		throw error
	}

	return models
}

/**
 * parseNanoGptModel
 *
 * Parses detailed model information from Nano-GPT API.
 * Pricing is in USD per million tokens.
 */

export const parseNanoGptModel = ({ model, displayName }: { model: NanoGptModel; displayName?: string }): ModelInfo => {
	// Calculate maxTokens as 20% of context window if not explicitly provided
	// Handle null values by providing defaults
	const contextWindow = model.context_length ?? 128_000
	const maxTokens = Math.ceil(contextWindow * 0.2)

	// Pricing is already in per-million-token format from the API
	const inputPrice = model.pricing?.prompt ?? 0
	const outputPrice = model.pricing?.completion ?? 0

	const modelInfo: ModelInfo = {
		maxTokens,
		contextWindow,
		inputPrice,
		outputPrice,
		description: model.description || `Nano-GPT model (${model.owned_by || "unknown provider"})`,
		displayName: displayName || model.name,
		supportsPromptCache: false,
		supportsImages: model.capabilities?.vision || false,
	}

	return modelInfo
}
