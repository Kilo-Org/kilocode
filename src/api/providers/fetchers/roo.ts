import { RooModelsResponseSchema, type ModelInfo, type ModelRecord } from "@roo-code/types"

import { parseApiPrice } from "../../../shared/cost"

import { DEFAULT_HEADERS } from "../constants"
import { resolveVersionedSettings, type VersionedSettings } from "./versionedSettings"

/**
 * Fetches available models from the Roo Code Cloud provider
 *
 * @param baseUrl The base URL of the Roo Code Cloud provider
 * @param apiKey The API key (session token) for the Roo Code Cloud provider
 * @returns A promise that resolves to a record of model IDs to model info
 * @throws Will throw an error if the request fails or the response is not as expected.
 */
export async function getRooModels(baseUrl: string, apiKey?: string): Promise<ModelRecord> {
	// Construct the models endpoint URL early so it's available in catch block for logging
	// Strip trailing /v1 or /v1/ to avoid /v1/v1/models
	const normalizedBase = baseUrl.replace(/\/?v1\/?$/, "")
	const url = `${normalizedBase}/v1/models`

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...DEFAULT_HEADERS,
		}

		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		// Use fetch with AbortController for better timeout handling
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 10000)

		try {
			const response = await fetch(url, {
				headers,
				signal: controller.signal,
			})

			if (!response.ok) {
				// Log detailed error information
				let errorBody = ""
				try {
					errorBody = await response.text()
				} catch {
					errorBody = "(unable to read response body)"
				}

				console.error(`[getRooModels] HTTP error:`, {
					status: response.status,
					statusText: response.statusText,
					url,
					body: errorBody,
				})

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

				// Determine if the model supports native tool calling based on tags
				const supportsNativeTools = tags.includes("tool-use")

				// Determine if the model should hide vendor/company identity (stealth mode)
				const isStealthModel = tags.includes("stealth")

				// Parse pricing (API returns strings, convert to numbers)
				const inputPrice = parseApiPrice(pricing.input)
				const outputPrice = parseApiPrice(pricing.output)
				const cacheReadPrice = pricing.input_cache_read ? parseApiPrice(pricing.input_cache_read) : undefined
				const cacheWritePrice = pricing.input_cache_write ? parseApiPrice(pricing.input_cache_write) : undefined

				// Build the base model info from API response
				const baseModelInfo = {
					maxTokens,
					contextWindow,
					supportsImages,
					supportsReasoningEffort,
					requiredReasoningEffort,
					supportsNativeTools,
					supportsPromptCache: Boolean(cacheReadPrice !== undefined),
					inputPrice,
					outputPrice,
					cacheWritesPrice: cacheWritePrice,
					cacheReadsPrice: cacheReadPrice,
					description: model.description || model.name,
					deprecated: model.deprecated || false,
					isFree: tags.includes("free"),
					defaultTemperature: model.default_temperature,
					defaultToolProtocol: "native" as const,
					isStealthModel: isStealthModel || undefined,
				}

				// Apply API-provided settings on top of base model info
				// Settings allow the proxy to dynamically configure model-specific options
				// like includedTools, excludedTools, reasoningEffort, etc.
				//
				// Two fields are used for backward compatibility:
				// - `settings`: Plain values that work with all client versions (e.g., { includedTools: ['search_replace'] })
				// - `versionedSettings`: Version-keyed settings (e.g., { '3.36.4': { includedTools: ['search_replace'] } })
				//
				// New clients check versionedSettings first - if a matching version is found, those settings are used.
				// Otherwise, falls back to plain `settings`. Old clients only see `settings`.
				const apiSettings = model.settings as Record<string, unknown> | undefined
				const apiVersionedSettings = model.versionedSettings as VersionedSettings | undefined

				// Start with base model info
				let modelInfo: ModelInfo = { ...baseModelInfo }

				// Try to resolve versioned settings first (finds highest version <= current plugin version)
				// If versioned settings match, use them exclusively (they contain all necessary settings)
				// Otherwise fall back to plain settings for backward compatibility
				if (apiVersionedSettings) {
					const resolvedVersionedSettings = resolveVersionedSettings<Partial<ModelInfo>>(apiVersionedSettings)
					if (Object.keys(resolvedVersionedSettings).length > 0) {
						// Versioned settings found - use them exclusively
						modelInfo = { ...modelInfo, ...resolvedVersionedSettings }
					} else if (apiSettings) {
						// No matching versioned settings - fall back to plain settings
						modelInfo = { ...modelInfo, ...(apiSettings as Partial<ModelInfo>) }
					}
				} else if (apiSettings) {
					// No versioned settings at all - use plain settings
					modelInfo = { ...modelInfo, ...(apiSettings as Partial<ModelInfo>) }
				}

				models[modelId] = modelInfo
			}

			return models
		} finally {
			clearTimeout(timeoutId)
		}
	} catch (error: any) {
		// Enhanced error logging
		console.error("[getRooModels] Error fetching Roo Code Cloud models:", {
			message: error.message || String(error),
			name: error.name,
			stack: error.stack,
			url,
			hasApiKey: Boolean(apiKey),
		})

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
