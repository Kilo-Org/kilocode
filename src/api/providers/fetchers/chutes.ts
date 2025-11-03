// kilocode_change - file added
import axios from "axios"
import { z } from "zod"

import { type ModelInfo } from "@roo-code/types"

/**
 * Chutes.AI individual model schema - flexible to handle API variations
 */
const chutesModelSchema = z.object({
	id: z.string(),
	root: z.string().optional(),
	price: z
		.object({
			input: z.object({
				tao: z.number(),
				usd: z.number(),
			}),
			output: z.object({
				tao: z.number(),
				usd: z.number(),
			}),
		})
		.optional()
		.nullable(),
	object: z.string().optional(),
	created: z.number().optional(),
	pricing: z
		.object({
			prompt: z.number().optional(),
			completion: z.number().optional(),
			tao: z
				.object({
					input: z.number().optional(),
					output: z.number().optional(),
				})
				.optional(),
			usd: z
				.object({
					input: z.number().optional(),
					output: z.number().optional(),
				})
				.optional(),
		})
		.optional()
		.nullable(),
	owned_by: z.string().optional(),
	quantization: z.string().optional().nullable(),
	max_model_len: z.number().optional(),
	context_length: z.number().optional(),
	input_modalities: z.array(z.string()).optional(),
	max_output_length: z.number().optional(),
	output_modalities: z.array(z.string()).optional(),
	supported_features: z.union([z.array(z.string()), z.record(z.any())]).optional(),
	supported_sampling_parameters: z.array(z.string()).optional(),
	parent: z.string().optional().nullable(),
	permission: z.array(z.any()).optional(),
	sampling_params: z.record(z.any()).optional(),
})

export type ChutesModel = z.infer<typeof chutesModelSchema>

/**
 * Chutes.API response schema
 */
const chutesApiResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(chutesModelSchema),
})

type ChutesApiResponse = z.infer<typeof chutesApiResponseSchema>

/**
 * Special model ID patterns that require specific handling
 *
 * These hardcoded sets are necessary because:
 * - DEEPSEEK_R1_MODELS: These reasoning models require special handling (supportsReasoningBudget: true)
 *   and higher maxTokens (32768) regardless of their context window. The API doesn't provide a "reasoning"
 *   flag in a consistent location, so we identify them by ID.
 * - GLM_MODELS: These vision models need explicit supportsImages: true because the API doesn't always
 *   include "vision" in supported_features or "image" in input_modalities consistently.
 */
const DEEPSEEK_R1_MODELS = new Set([
	"deepseek-ai/DeepSeek-R1-0528",
	"deepseek-ai/DeepSeek-R1",
	"deepseek-ai/DeepSeek-R1-Zero",
])

const GLM_MODELS = new Set(["zai-org/GLM-4.5V"])

/**
 * Parse a Chutes.AI model response into our ModelInfo format
 */
function parseChutesModel(model: ChutesModel): ModelInfo {
	const { id, context_length, max_model_len, supported_features, price, input_modalities, output_modalities } = model

	// Use context_length for the context window, fallback to max_model_len if needed
	const contextWindow = context_length || max_model_len || 8192

	// Calculate maxTokens with the following logic:
	// - Take 20% of context window (ceil) as a reasonable default output limit
	// - Cap at 32,768 tokens to avoid excessive output lengths that could impact performance
	// - Take the minimum of these two values and the context window itself
	// This ensures reasonable output limits while respecting model constraints
	const maxTokens = Math.min(contextWindow, Math.ceil(contextWindow * 0.2), 32768)

	// Handle reasoning models
	const isReasoning = DEEPSEEK_R1_MODELS.has(id)

	// Parse pricing - Chutes API returns prices already in dollars per million tokens
	// (not per token like OpenRouter), so we use the values directly
	const inputPrice = price?.input?.usd ?? 0
	const outputPrice = price?.output?.usd ?? 0

	// Determine capabilities from modalities and features
	// supported_features can be either an array or an object, handle both
	const featuresArray = Array.isArray(supported_features) ? supported_features : []
	const supportsImages = featuresArray.includes("vision") || input_modalities?.includes("image") || false
	const supportsPromptCache = true // Most models support some form of caching

	// Build model info object
	const modelInfo: ModelInfo = {
		maxTokens: isReasoning ? 32768 : maxTokens, // Reasoning models need higher token limits
		contextWindow,
		supportsImages,
		supportsPromptCache,
		supportsComputerUse: false, // Chutes doesn't expose computer use capability
		inputPrice,
		outputPrice,
		description: `${id} via Chutes.AI`,
		supportsReasoningEffort: false,
		supportsReasoningBudget: isReasoning,
		supportedParameters: [],
	}

	// Set special properties for specific model families
	if (DEEPSEEK_R1_MODELS.has(id)) {
		// DeepSeek R1 models already have special handling in the provider
		// Keep default behavior but ensure reasonable token limits
	}

	if (GLM_MODELS.has(id)) {
		// GLM-4.5V is a vision model - ensure vision support is properly marked
		modelInfo.supportsImages = true
	}

	return modelInfo
}

/**
 * Fetches available models from Chutes.AI
 *
 * @param apiKey - Optional API key for Chutes.AI
 * @returns Promise resolving to a record of model information
 */
export async function getChutesModels(apiKey?: string): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		}

		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`
		}

		const response = await axios.get<ChutesApiResponse>("https://llm.chutes.ai/v1/models", {
			headers,
			timeout: 10_000, // 10 second timeout
		})

		const result = chutesApiResponseSchema.safeParse(response.data)

		if (!result.success) {
			console.error("Chutes.AI models response validation failed:", result.error.format())
			throw new Error(
				`Chutes.AI API returned invalid response format. This indicates an API contract change. Validation errors: ${JSON.stringify(result.error.format())}`,
			)
		}

		for (const model of result.data.data) {
			models[model.id] = parseChutesModel(model)
		}

		return models
	} catch (error) {
		console.error("Error fetching Chutes.AI models:", error)

		// Provide more specific error messages for common failure scenarios
		if (axios.isAxiosError(error)) {
			if (error.code === "ECONNABORTED") {
				const timeoutError = new Error("Failed to fetch Chutes.AI models: Request timeout")
				;(timeoutError as any).cause = error
				throw timeoutError
			} else if (error.response) {
				const responseError = new Error(
					`Failed to fetch Chutes.AI models: ${error.response.status} ${error.response.statusText}`,
				)
				;(responseError as any).cause = error
				throw responseError
			} else if (error.request) {
				const requestError = new Error("Failed to fetch Chutes.AI models: No response")
				;(requestError as any).cause = error
				throw requestError
			}
		}

		const fetchError = new Error(
			`Failed to fetch Chutes.AI models: ${error instanceof Error ? error.message : "Unknown error"}`,
		)
		;(fetchError as any).cause = error
		throw fetchError
	}
}
