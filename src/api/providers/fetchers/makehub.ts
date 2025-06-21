import axios from "axios"
import type { ModelRecord } from "../../../shared/api"

const MAKEHUB_BASE_URL = "https://api.makehub.ai/v1"

interface MakehubModelResponse {
	data: Array<{
		context: number
		model_id: string
		model_name: string
		display_name?: string
		organisation: string
		price_per_input_token: number
		price_per_output_token: number
		provider_name: string
		quantisation: string | null
		max_tokens?: number
		supports_images?: boolean
		supports_prompt_cache?: boolean
		cache_writes_price?: number
		cache_reads_price?: number
		assistant_ready: boolean
		providers_available?: string[]
		thinking_config?: {
			max_budget?: number
			output_price?: number
		}
		tiers?: Array<{
			context_window: number
			input_price?: number
			output_price?: number
			cache_writes_price?: number
			cache_reads_price?: number
		}>
		capabilities?: {
			image_input?: boolean
			tool_calling?: boolean
			json_mode?: boolean
		}
	}>
}

/**
 * Fetches available models from the MakeHub API
 *
 * @param apiKey - The API key for authentication
 * @returns A promise that resolves to a record of model IDs to model info
 */
export const getMakehubModels = async (apiKey?: string): Promise<ModelRecord> => {
	try {
		// Configure headers based on whether API key is provided
		const headers: Record<string, string> = {
			Accept: "application/json",
			"Content-Type": "application/json",
			"HTTP-Referer": "vscode.dev",
			"X-Title": "RooCode",
		}

		// Add Authorization header if API key is provided
		if (apiKey && apiKey.trim()) {
			headers.Authorization = `Bearer ${apiKey.trim()}`
		}

		const response = await axios.get<MakehubModelResponse>(`${MAKEHUB_BASE_URL}/models`, {
			headers,
			timeout: 15000,
		})

		if (!response.data?.data) {
			console.error("MakeHub: Invalid API response format:", response.data)
			throw new Error("Invalid API response format from MakeHub")
		}

		const modelRecord: ModelRecord = {}

		for (const model of response.data.data) {
			if (!model.model_id || !model.assistant_ready) {
				continue
			}

			// Create a model ID that includes provider information
			const fullModelId = model.model_id.includes("/")
				? model.model_id // Already has organization format
				: `${model.organisation}/${model.model_id}` // Add organization prefix

			// Validate pricing data
			if (typeof model.price_per_input_token !== "number" || typeof model.price_per_output_token !== "number") {
				console.warn(`MakeHub: Invalid pricing for model ${fullModelId}`, {
					input: model.price_per_input_token,
					output: model.price_per_output_token,
				})
				continue
			}

			// Convert pricing to per-million-tokens format and validate reasonable values
			const inputPriceConverted = model.price_per_input_token * 1000000
			const outputPriceConverted = model.price_per_output_token * 1000000

			if (inputPriceConverted > 1000 || outputPriceConverted > 1000) {
				console.warn(`MakeHub: Unusually high pricing for model ${fullModelId}`, {
					inputPerMillion: inputPriceConverted,
					outputPerMillion: outputPriceConverted,
				})
			}

			modelRecord[fullModelId] = {
				maxTokens: model.max_tokens ?? undefined,
				contextWindow: model.context, // MakeHub API returns context window directly (e.g., 200000 tokens)
				supportsImages: model.capabilities?.image_input ?? false,
				supportsComputerUse: model.capabilities?.tool_calling ?? false,
				supportsPromptCache: model.supports_prompt_cache ?? false,
				inputPrice: model.price_per_input_token * 1000000, // Convert from per-token to per-million-tokens
				outputPrice: model.price_per_output_token * 1000000, // Convert from per-token to per-million-tokens
				cacheWritesPrice: model.cache_writes_price ? model.cache_writes_price * 1000000 : undefined,
				cacheReadsPrice: model.cache_reads_price ? model.cache_reads_price * 1000000 : undefined,
				description: model.display_name,
				tiers: model.tiers?.map((tier) => ({
					contextWindow: tier.context_window, // Context window returned directly from API
					inputPrice: tier.input_price ? tier.input_price * 1000000 : undefined,
					outputPrice: tier.output_price ? tier.output_price * 1000000 : undefined,
					cacheWritesPrice: tier.cache_writes_price ? tier.cache_writes_price * 1000000 : undefined,
					cacheReadsPrice: tier.cache_reads_price ? tier.cache_reads_price * 1000000 : undefined,
				})),
			}
		}

		return modelRecord
	} catch (error) {
		console.error("MakeHub: Error fetching models:", error)
		if (axios.isAxiosError(error)) {
			console.error("MakeHub: HTTP Error Details:", {
				status: error.response?.status,
				statusText: error.response?.statusText,
				data: error.response?.data,
				hasApiKey: !!apiKey,
			})

			if (error.response?.status === 401) {
				throw new Error("MakeHub: Invalid API key. Please check your API key configuration.")
			} else if (error.response?.status === 403) {
				throw new Error("MakeHub: Access forbidden. Please check your API key permissions.")
			} else if (error.response && error.response.status >= 500) {
				throw new Error("MakeHub: Server error. Please try again later.")
			} else if (error.code === "ECONNABORTED") {
				throw new Error("MakeHub: Request timeout. Please check your internet connection.")
			}
		}

		throw new Error(`MakeHub: Failed to fetch models - ${error.message || "Unknown error"}`)
	}
}
