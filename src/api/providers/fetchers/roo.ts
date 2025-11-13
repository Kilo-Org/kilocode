import { RooModelsResponseSchema } from "@roo-code/types"

import type { ModelRecord } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"

import { DEFAULT_HEADERS } from "../constants"

/**
 * Fetches available models from the Roo Code Cloud provider
 *
 * @param baseUrl The base URL of the Roo Code Cloud provider
 * @param apiKey The API key (session token) for the Roo Code Cloud provider
 * @returns A promise that resolves to a record of model IDs to model info
 * @throws Will throw an error if the request fails or the response is not as expected.
 */
export async function getRooModels(baseUrl: string, apiKey?: string): Promise<ModelRecord> {
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...DEFAULT_HEADERS,
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		// Construct the models endpoint URL
		// Strip trailing /v1 or /v1/ to avoid /v1/v1/models
		const normalizedBase = baseUrl.replace(/\/?v1\/?$/, "")
		const url = `${normalizedBase}/v1/models`

		// Use fetch with AbortController for better timeout handling
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 10000)

		try {
			const response = await fetch(url, {
				headers,
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}

			const data = await response.json()
			const models: ModelRecord = {}

			// Validate response against schema
			const parsed = RooModelsResponseSchema.safeParse(data)

			if (!parsed.success) {
				console.error("Error fetching Roo Code Cloud models: Unexpected response format", data)
				console.error("Validation errors:", parsed.error.format())
				throw new Error("Failed to fetch Roo Code Cloud models: Unexpected response format.")
			}

			// Process the validated model data
			for (const model of parsed.data.data) {
				const modelId = model.id

				if (!modelId) continue

				// Extract model data from the validated API response
				// All required fields are guaranteed by the schema
				const contextWindow = model.context_window
				const maxTokens = model.max_tokens
				const tags = model.tags || []
				const pricing = model.pricing

				// Determine if the model supports images based on tags
				const supportsImages = tags.includes("vision")

				// Determine if the model supports reasoning effort based on tags
				const supportsReasoningEffort = tags.includes("reasoning")

				// Determine if the model requires reasoning effort based on tags
				const requiredReasoningEffort = tags.includes("reasoning-required")

				// Parse pricing (API returns strings, convert to numbers)
				const inputPrice = parseApiPrice(pricing.input)
				const outputPrice = parseApiPrice(pricing.output)
				const cacheReadPrice = pricing.input_cache_read ? parseApiPrice(pricing.input_cache_read) : undefined
				const cacheWritePrice = pricing.input_cache_write ? parseApiPrice(pricing.input_cache_write) : undefined

				models[modelId] = {
					maxTokens,
					contextWindow,
					supportsImages,
					supportsReasoningEffort,
					requiredReasoningEffort,
					supportsPromptCache: Boolean(cacheReadPrice !== undefined),
					inputPrice,
					outputPrice,
					cacheWritesPrice: cacheWritePrice,
					cacheReadsPrice: cacheReadPrice,
					description: model.description || model.name,
					deprecated: model.deprecated || false,
					isFree: tags.includes("free"),
				}
			}

			return models
		} finally {
			clearTimeout(timeoutId)
		}
	} catch (error: any) {
		console.error("Error fetching Roo Code Cloud models:", error.message ? error.message : error)

		// Handle abort/timeout
		if (error.name === "AbortError") {
			throw new Error("Failed to fetch Roo Code Cloud models: Request timed out after 10 seconds.")
		}

		// Handle fetch errors
		if (error.message?.includes("HTTP")) {
			throw new Error(`Failed to fetch Roo Code Cloud models: ${error.message}. Check base URL and API key.`)
		}

		// Handle network errors
		if (error instanceof TypeError) {
			throw new Error(
				"Failed to fetch Roo Code Cloud models: No response from server. Check Roo Code Cloud server status and base URL.",
			)
		}

		throw new Error(`Failed to fetch Roo Code Cloud models: ${error.message || "An unknown error occurred."}`)
	}
}
