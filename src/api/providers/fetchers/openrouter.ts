import axios from "axios"
import { z } from "zod"

import {
	type ModelInfo,
	isModelParameter,
	OPEN_ROUTER_COMPUTER_USE_MODELS,
	OPEN_ROUTER_REASONING_BUDGET_MODELS,
	OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS,
	anthropicModels,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"
import { DEFAULT_HEADERS } from "../constants" // kilocode_change

/**
 * OpenRouterBaseModel
 */

const openRouterArchitectureSchema = z.object({
	input_modalities: z.array(z.string()).nullish(),
	output_modalities: z.array(z.string()).nullish(),
	tokenizer: z.string().nullish(),
})

const openRouterPricingSchema = z.object({
	prompt: z.string().nullish(),
	completion: z.string().nullish(),
	input_cache_write: z.string().nullish(),
	input_cache_read: z.string().nullish(),
})

const modelRouterBaseModelSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	context_length: z.number(),
	max_completion_tokens: z.number().nullish(),
	preferredIndex: z.number().nullish(), // kilocode_change
	pricing: openRouterPricingSchema.optional(),
})

export type OpenRouterBaseModel = z.infer<typeof modelRouterBaseModelSchema>

/**
 * OpenRouterModel
 */

export const openRouterModelSchema = modelRouterBaseModelSchema.extend({
	id: z.string(),
	architecture: openRouterArchitectureSchema.optional(),
	top_provider: z.object({ max_completion_tokens: z.number().nullish() }).optional(),
	supported_parameters: z.array(z.string()).optional(),
})

export type OpenRouterModel = z.infer<typeof openRouterModelSchema>

/**
 * OpenRouterModelEndpoint
 */

export const openRouterModelEndpointSchema = modelRouterBaseModelSchema.extend({
	model_name: z.string(), // kilocode_change
	provider_name: z.string(),
	tag: z.string().optional(),
})

export type OpenRouterModelEndpoint = z.infer<typeof openRouterModelEndpointSchema>

/**
 * OpenRouterModelsResponse
 */

const openRouterModelsResponseSchema = z.object({
	data: z.array(openRouterModelSchema),
})

type OpenRouterModelsResponse = z.infer<typeof openRouterModelsResponseSchema>

/**
 * OpenRouterModelEndpointsResponse
 */

const openRouterModelEndpointsResponseSchema = z.object({
	data: z.object({
		id: z.string(),
		name: z.string(),
		description: z.string().optional(),
		architecture: openRouterArchitectureSchema.optional(),
		supported_parameters: z.array(z.string()).optional(),
		endpoints: z.array(openRouterModelEndpointSchema),
	}),
})

type OpenRouterModelEndpointsResponse = z.infer<typeof openRouterModelEndpointsResponseSchema>

/**
 * getOpenRouterModels
 */

export async function getOpenRouterModels(
	options?: ApiHandlerOptions & { headers?: Record<string, string> }, // kilocode_change: added headers
): Promise<Record<string, ModelInfo>> {
	// Return static models instead of making API calls
	const models: Record<string, ModelInfo> = {}

	// Import the static models from the shared file
	const { KILO_CODE_MODELS } = await import("../kilocode-models")

	for (const [id, model] of Object.entries(KILO_CODE_MODELS)) {
		models[id] = parseOpenRouterModel({
			id,
			model: {
				name: model.name,
				description: model.description,
				context_length: model.context_length,
				max_completion_tokens: model.max_output_length,
				pricing: {
					prompt: model.pricing.prompt,
					completion: model.pricing.completion,
					input_cache_write: model.pricing.input_cache_writes,
					input_cache_read: model.pricing.input_cache_reads,
				},
			},
			displayName: model.name,
			inputModality: model.input_modalities,
			outputModality: model.output_modalities,
			maxTokens: model.max_output_length,
			supportedParameters: model.supported_sampling_parameters,
		})
	}

	return models
}

/**
 * getOpenRouterModelEndpoints
 */

export async function getOpenRouterModelEndpoints(
	modelId: string,
	options?: ApiHandlerOptions,
): Promise<Record<string, ModelInfo>> {
	// Return static models instead of making API calls
	const models: Record<string, ModelInfo> = {}

	// Import the static models from the shared file
	const { KILO_CODE_MODELS } = await import("../kilocode-models")

	const model = KILO_CODE_MODELS[modelId]
	if (!model) {
		return models
	}

	models["KiloCode"] = parseOpenRouterModel({
		id: model.id,
		model: {
			name: model.name,
			description: model.description,
			context_length: model.context_length,
			max_completion_tokens: model.max_output_length,
			pricing: {
				prompt: model.pricing.prompt,
				completion: model.pricing.completion,
				input_cache_write: model.pricing.input_cache_writes,
				input_cache_read: model.pricing.input_cache_reads,
			},
		},
		displayName: model.name,
		inputModality: model.input_modalities,
		outputModality: model.output_modalities,
		maxTokens: model.max_output_length,
		supportedParameters: model.supported_sampling_parameters,
	})

	return models
}

/**
 * parseOpenRouterModel
 */

export const parseOpenRouterModel = ({
	id,
	model,
	displayName, // kilocode_change
	inputModality,
	outputModality,
	maxTokens,
	supportedParameters,
}: {
	id: string
	model: OpenRouterBaseModel
	displayName?: string // kilocode_change
	inputModality: string[] | null | undefined
	outputModality: string[] | null | undefined
	maxTokens: number | null | undefined
	supportedParameters?: string[]
}): ModelInfo => {
	const cacheWritesPrice = model.pricing?.input_cache_write
		? parseApiPrice(model.pricing?.input_cache_write)
		: undefined

	const cacheReadsPrice = model.pricing?.input_cache_read ? parseApiPrice(model.pricing?.input_cache_read) : undefined

	const supportsPromptCache = typeof cacheReadsPrice !== "undefined" // some models support caching but don't charge a cacheWritesPrice, e.g. GPT-5

	const modelInfo: ModelInfo = {
		maxTokens: maxTokens || Math.ceil(model.context_length * 0.2),
		contextWindow: model.context_length,
		supportsImages: inputModality?.includes("image") ?? false,
		supportsPromptCache,
		inputPrice: parseApiPrice(model.pricing?.prompt),
		outputPrice: parseApiPrice(model.pricing?.completion),
		cacheWritesPrice,
		cacheReadsPrice,
		description: model.description,
		supportsReasoningEffort: supportedParameters ? supportedParameters.includes("reasoning") : undefined,
		supportedParameters: supportedParameters ? supportedParameters.filter(isModelParameter) : undefined,
		// kilocode_change start
		displayName,
		preferredIndex: model.preferredIndex,
		// kilocode_change end
	}

	// The OpenRouter model definition doesn't give us any hints about
	// computer use, so we need to set that manually.
	if (OPEN_ROUTER_COMPUTER_USE_MODELS.has(id)) {
		modelInfo.supportsComputerUse = true
	}

	if (OPEN_ROUTER_REASONING_BUDGET_MODELS.has(id)) {
		modelInfo.supportsReasoningBudget = true
	}

	if (OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS.has(id)) {
		modelInfo.requiredReasoningBudget = true
	}

	// For backwards compatibility with the old model definitions we will
	// continue to disable extending thinking for anthropic/claude-3.7-sonnet
	// and force it for anthropic/claude-3.7-sonnet:thinking.

	if (id === "anthropic/claude-3.7-sonnet") {
		modelInfo.maxTokens = anthropicModels["claude-3-7-sonnet-20250219"].maxTokens
		modelInfo.supportsReasoningBudget = false
		modelInfo.supportsReasoningEffort = false
	}

	if (id === "anthropic/claude-3.7-sonnet:thinking") {
		modelInfo.maxTokens = anthropicModels["claude-3-7-sonnet-20250219:thinking"].maxTokens
	}

	// Set claude-opus-4.1 model to use the correct configuration
	if (id === "anthropic/claude-opus-4.1") {
		modelInfo.maxTokens = anthropicModels["claude-opus-4-1-20250805"].maxTokens
	}

	// Ensure correct reasoning handling for Claude Haiku 4.5 on OpenRouter
	// Use budget control and disable effort-based reasoning fallback
	if (id === "anthropic/claude-haiku-4.5") {
		modelInfo.supportsReasoningBudget = true
		modelInfo.supportsReasoningEffort = false
	}

	// Set horizon-alpha model to 32k max tokens
	if (id === "openrouter/horizon-alpha") {
		modelInfo.maxTokens = 32768
	}

	// Set horizon-beta model to 32k max tokens
	if (id === "openrouter/horizon-beta") {
		modelInfo.maxTokens = 32768
	}

	return modelInfo
}
