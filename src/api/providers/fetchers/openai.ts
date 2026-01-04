// kilocode_change - new file
import axios from "axios"
import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"

/**
 * OpenAI /v1/models response schema
 *
 * Per the official OpenAI API specification, models only contain:
 * - id: string (required)
 * - object: string (always "model")
 * - created: number (Unix timestamp)
 * - owned_by: string
 *
 * Reference: https://platform.openai.com/docs/api-reference/models/object
 *
 * Note: Many OpenAI-compatible providers extend this with additional fields
 * (context_window, max_output_tokens, etc.). We use passthrough() to preserve
 * these fields and parse commonly used extensions.
 */
const openAiModelSchema = z
	.object({
		id: z.string(),
		object: z.string().optional(),
		created: z.number().optional(),
		owned_by: z.string().optional(),
	})
	.passthrough()

const openAiModelsResponseSchema = z.object({
	data: z.array(openAiModelSchema),
	object: z.string().optional(),
})

type OpenAiModelsResponse = z.infer<typeof openAiModelsResponseSchema>

type OpenAiModel = z.infer<typeof openAiModelSchema>

/**
 * Common extended model fields that OpenAI-compatible providers may include.
 * These are NOT part of the official OpenAI spec but are widely used.
 */
interface ExtendedModelFields {
	// Context/token limits (common naming conventions)
	context_window?: number
	context_length?: number
	max_context_length?: number
	max_input_tokens?: number
	max_tokens?: number
	max_output_tokens?: number
	max_completion_tokens?: number
	// Capability flags
	supports_vision?: boolean
	supports_images?: boolean
	vision?: boolean
	supports_function_calling?: boolean
	supports_tools?: boolean
	// Pricing (in cost per token)
	input_cost_per_token?: number
	output_cost_per_token?: number
	// Description
	description?: string
}

/**
 * Parse an OpenAI model into our ModelInfo format.
 *
 * Handles common extended fields that many OpenAI-compatible providers include.
 */
function parseOpenAiModel(model: OpenAiModel): ModelInfo {
	// Cast to access extended fields that some providers include
	const extendedModel = model as OpenAiModel & ExtendedModelFields

	// Parse context window from common field names
	const contextWindow =
		extendedModel.context_window ??
		extendedModel.context_length ??
		extendedModel.max_context_length ??
		extendedModel.max_input_tokens ??
		32000 // Safe default for most models

	// Parse max output tokens from common field names
	const maxTokens =
		extendedModel.max_output_tokens ?? extendedModel.max_completion_tokens ?? extendedModel.max_tokens ?? 8192 // Conservative default

	// Parse vision/image support
	const supportsImages =
		extendedModel.supports_vision ?? extendedModel.supports_images ?? extendedModel.vision ?? false

	// Parse tool support (default to true as most modern models support tools)
	const supportsNativeTools = extendedModel.supports_function_calling ?? extendedModel.supports_tools ?? true

	// Parse pricing (convert from per-token to per-million-tokens if provided)
	const inputPrice = extendedModel.input_cost_per_token ? extendedModel.input_cost_per_token * 1_000_000 : undefined
	const outputPrice = extendedModel.output_cost_per_token
		? extendedModel.output_cost_per_token * 1_000_000
		: undefined

	return {
		maxTokens,
		contextWindow,
		supportsImages,
		supportsPromptCache: false,
		supportsComputerUse: false,
		description: extendedModel.description ?? model.id,
		// Use the full model ID as display name to avoid mangling by prettyModelName()
		displayName: model.id,
		supportsReasoningEffort: false,
		supportsReasoningBudget: false,
		supportsTemperature: true,
		supportsNativeTools,
		defaultToolProtocol: "native",
		...(inputPrice !== undefined && { inputPrice }),
		...(outputPrice !== undefined && { outputPrice }),
	}
}

export interface GetOpenAiModelsOptions {
	baseUrl?: string
	apiKey?: string
	headers?: Record<string, string>
}

export async function getOpenAiModels(options: GetOpenAiModelsOptions): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	// Note: baseUrl is required for OpenAI Compatible providers
	// If not provided, we return empty models rather than defaulting to api.openai.com
	// since users should explicitly configure their endpoint
	if (!options.baseUrl) {
		console.warn("OpenAI Compatible: No baseUrl provided, returning empty model list")
		return models
	}

	const baseUrl = options.baseUrl

	try {
		const requestHeaders: Record<string, string> = {
			"Content-Type": "application/json",
			...options.headers,
		}

		if (options.apiKey) {
			requestHeaders.Authorization = `Bearer ${options.apiKey}`
		}

		// Ensure baseUrl doesn't have trailing slash and append /models
		const modelsUrl = `${baseUrl.replace(/\/+$/, "")}/models`

		const response = await axios.get<OpenAiModelsResponse>(modelsUrl, {
			headers: requestHeaders,
			timeout: 10_000,
		})

		const result = openAiModelsResponseSchema.safeParse(response.data)
		if (!result.success) {
			console.error("OpenAI Compatible models response validation failed:", result.error.format())
			throw new Error(
				`OpenAI Compatible API returned invalid response format. Validation errors: ${JSON.stringify(result.error.format())}`,
			)
		}

		if (result.data.data.length === 0) {
			console.warn(`OpenAI Compatible (${baseUrl}): API returned empty model list`)
		}

		for (const model of result.data.data) {
			models[model.id] = parseOpenAiModel(model)
		}

		return models
	} catch (error) {
		console.error(`Error fetching OpenAI Compatible models from ${baseUrl}:`, error)

		if (axios.isAxiosError(error)) {
			if (error.code === "ECONNABORTED") {
				const timeoutError = new Error(
					`Failed to fetch OpenAI Compatible models from ${baseUrl}: Request timeout`,
				)
				;(timeoutError as any).cause = error
				throw timeoutError
			} else if (error.response) {
				const responseError = new Error(
					`Failed to fetch OpenAI Compatible models from ${baseUrl}: ${error.response.status} ${error.response.statusText}`,
				)
				;(responseError as any).cause = error
				throw responseError
			} else if (error.request) {
				const requestError = new Error(`Failed to fetch OpenAI Compatible models from ${baseUrl}: No response`)
				;(requestError as any).cause = error
				throw requestError
			}
		}

		const fetchError = new Error(
			`Failed to fetch OpenAI Compatible models from ${baseUrl}: ${error instanceof Error ? error.message : "Unknown error"}`,
		)
		;(fetchError as any).cause = error
		throw fetchError
	}
}
