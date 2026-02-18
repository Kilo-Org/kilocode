import axios from "axios"
import { z } from "zod"

import {
	type ModelInfo,
	isModelParameter,
	OPEN_ROUTER_REASONING_BUDGET_MODELS,
	OPEN_ROUTER_REQUIRED_REASONING_BUDGET_MODELS,
	anthropicModels,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../../shared/api"
import { parseApiPrice } from "../../../shared/cost"
import { DEFAULT_HEADERS } from "../constants" // kilocode_change
import {
	ModelSettings,
	ModelSettingsSchema,
	parseModelSettings,
	VersionedModelSettingsSchema,
} from "../kilocode/model-settings"
import { resolveVersionedSettings } from "./versionedSettings" // kilocode_change

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
	pricing: openRouterPricingSchema.optional(),

	// kilocode_change start
	preferredIndex: z.number().nullish(),
	settings: ModelSettingsSchema.nullish(),
	versioned_settings: VersionedModelSettingsSchema.nullish(),
	// kilocode_change end
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
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || "https://openrouter.ai/api/v1"

	try {
		// kilocode_change: use fetch, added headers
		const response = await fetch(`${baseURL}/models`, {
			headers: { ...DEFAULT_HEADERS, ...(options?.headers ?? {}) },
		})
		const json = await response.json()
		const result = openRouterModelsResponseSchema.safeParse(json)
		const data = result.success ? result.data.data : json.data
		// kilocode_change end

		if (!result.success) {
			// kilocode_change start
			throw new Error(
				"OpenRouter models response is invalid: " + JSON.stringify(result.error.format(), undefined, 2),
			)
			// kilocode_change end
		}

		for (const model of data) {
			const { id, architecture, top_provider, supported_parameters = [] } = model

			// Skip image generation models (models that output images)
			if (architecture?.output_modalities?.includes("image")) {
				continue
			}

			const parsedModel = parseOpenRouterModel({
				id,
				model,
				displayName: model.name, // kilocode_change
				inputModality: architecture?.input_modalities,
				outputModality: architecture?.output_modalities,
				maxTokens: top_provider?.max_completion_tokens,
				supportedParameters: supported_parameters,
			})

			models[id] = parsedModel
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter models: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
		throw error // kilocode_change
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
	const models: Record<string, ModelInfo> = {}
	const baseURL = options?.openRouterBaseUrl || "https://openrouter.ai/api/v1"

	try {
		const response = await axios.get<OpenRouterModelEndpointsResponse>(`${baseURL}/models/${modelId}/endpoints`)
		const result = openRouterModelEndpointsResponseSchema.safeParse(response.data)
		const data = result.success ? result.data.data : response.data.data

		if (!result.success) {
			console.error("OpenRouter model endpoints response is invalid", result.error.format())
		}

		const { id, architecture, endpoints } = data

		// Skip image generation models (models that output images)
		if (architecture?.output_modalities?.includes("image")) {
			return models
		}

		for (const endpoint of endpoints) {
			models[endpoint.tag ?? endpoint.provider_name] = parseOpenRouterModel({
				id,
				model: endpoint,
				displayName: endpoint.model_name, // kilocode_change
				inputModality: architecture?.input_modalities,
				outputModality: architecture?.output_modalities,
				maxTokens: endpoint.max_completion_tokens,
			})
		}
	} catch (error) {
		console.error(
			`Error fetching OpenRouter model endpoints: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
		)
	}

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

	const supportsNativeTools = supportedParameters ? supportedParameters.includes("tools") : undefined

	// kilocode_change start
	const resolvedVersionedSettings = model.versioned_settings
		? resolveVersionedSettings<ModelSettings>(model.versioned_settings)
		: {}
	// kilocode_change end

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
		supportsNativeTools,
		supportedParameters: supportedParameters ? supportedParameters.filter(isModelParameter) : undefined,
		// kilocode_change start
		displayName,
		preferredIndex: model.preferredIndex,
		supportsVerbosity: !!supportedParameters?.includes("verbosity") || undefined,
		...parseModelSettings(
			Object.keys(resolvedVersionedSettings).length > 0 ? resolvedVersionedSettings : (model.settings ?? {}),
		),
		// kilocode_change end
		// Default to native tool protocol when native tools are supported
		defaultToolProtocol: supportsNativeTools ? ("native" as const) : undefined,
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

	// Set claude-sonnet-4.6 model to use the correct configuration
	if (id === "anthropic/claude-sonnet-4.6") {
		modelInfo.maxTokens = anthropicModels["claude-sonnet-4-6"].maxTokens
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
