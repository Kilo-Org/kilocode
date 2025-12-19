import { useQuery, UseQueryOptions } from "@tanstack/react-query"

import type { ModelInfo, ModelParameter } from "@roo-code/types"
import { isModelParameter } from "@roo-code/types"

//TODO: import { parseApiPrice } from "@roo/cost"

export const OPENROUTER_DEFAULT_PROVIDER_NAME = "[default]"

type OpenRouterModelProvider = ModelInfo & {
	label: string
}

type KiloCodeModel = {
	id: string
	name: string
	description: string
	input_modalities: string[]
	context_length: number
	max_output_length: number
	output_modalities: string[]
	supported_sampling_parameters: string[]
	supported_features: string[]
	openrouter: {
		slug: string
	}
	datacenters: Array<{ country_code: string }>
	created: number
	owned_by: string
	pricing: {
		prompt?: string
		completion?: string
		image?: string
		request?: string
		input_cache_reads?: string
		input_cache_writes?: string
	}
}

const KILO_CODE_MODELS: Record<string, KiloCodeModel> = {
	"axon-code": {
		id: "axon-code",
		name: "Axon Code",
		description: "Axon Code is super intelligent LLM model for coding tasks",
		input_modalities: ["text"],
		context_length: 256000,
		max_output_length: 32768,
		output_modalities: ["text"],
		supported_sampling_parameters: [
			"temperature",
			"top_p",
			"top_k",
			"repetition_penalty",
			"frequency_penalty",
			"presence_penalty",
			"seed",
			"stop",
		],
		supported_features: ["tools", "structured_outputs", "web_search"],
		openrouter: {
			slug: "matterai/axon",
		},
		datacenters: [{ country_code: "US" }],
		created: 1750426201,
		owned_by: "matterai",
		pricing: {
			prompt: "0.000001",
			completion: "0.000004",
			image: "0",
			request: "0",
			input_cache_reads: "0",
			input_cache_writes: "0",
		},
	},
	"axon-code-exp": {
		id: "axon-code-exp",
		name: "Axon Code Exp",
		description: "Axon Code is super intelligent LLM model for coding tasks",
		input_modalities: ["text"],
		context_length: 256000,
		max_output_length: 32768,
		output_modalities: ["text"],
		supported_sampling_parameters: [
			"temperature",
			"top_p",
			"top_k",
			"repetition_penalty",
			"frequency_penalty",
			"presence_penalty",
			"seed",
			"stop",
		],
		supported_features: ["tools", "structured_outputs", "web_search"],
		openrouter: {
			slug: "matterai/axon",
		},
		datacenters: [{ country_code: "US" }],
		created: 1750426201,
		owned_by: "matterai",
		pricing: {
			prompt: "0.000001",
			completion: "0.000004",
			image: "0",
			request: "0",
			input_cache_reads: "0",
			input_cache_writes: "0",
		},
	},
	"axon-mini": {
		id: "axon-mini",
		name: "Axon Mini",
		description:
			"Axon Mini is an general purpose super intelligent LLM coding model for low-effort day-to-day tasks",
		input_modalities: ["text"],
		context_length: 256000,
		max_output_length: 16384,
		output_modalities: ["text"],
		supported_sampling_parameters: [
			"temperature",
			"top_p",
			"top_k",
			"repetition_penalty",
			"frequency_penalty",
			"presence_penalty",
			"seed",
			"stop",
		],
		supported_features: ["tools", "structured_outputs", "web_search"],
		openrouter: {
			slug: "matterai/axon",
		},
		datacenters: [{ country_code: "US" }],
		created: 1750426201,
		owned_by: "matterai",
		pricing: {
			prompt: "2.5e-7",
			completion: "0.000001",
			image: "0",
			request: "0",
			input_cache_reads: "0",
			input_cache_writes: "0",
		},
	},
	// "gemini-3-flash-preview": {
	// 	id: "gemini-3-flash-preview",
	// 	name: "Gemini 3 Flash Preview",
	// 	description:
	// 		"Gemini 3 Flash Preview model is built for speed, combining frontier intelligence with superior search and grounding.",
	// 	input_modalities: ["text"],
	// 	context_length: 256000,
	// 	max_output_length: 32768,
	// 	output_modalities: ["text"],
	// 	supported_sampling_parameters: [
	// 		"temperature",
	// 		"top_p",
	// 		"top_k",
	// 		"repetition_penalty",
	// 		"frequency_penalty",
	// 		"presence_penalty",
	// 		"seed",
	// 		"stop",
	// 	],
	// 	supported_features: ["tools", "structured_outputs", "web_search"],
	// 	openrouter: {
	// 		slug: "google/gemini-3-flash-preview",
	// 	},
	// 	datacenters: [{ country_code: "US" }],
	// 	created: 1750426201,
	// 	owned_by: "google",
	// 	pricing: {
	// 		prompt: "0.000001",
	// 		completion: "0.000004",
	// 		image: "0",
	// 		request: "0",
	// 		input_cache_reads: "0",
	// 		input_cache_writes: "0",
	// 	},
	// },
	// "gemini-3-pro-preview": {
	// 	id: "gemini-3-pro-preview",
	// 	name: "Gemini 3 Pro Preview",
	// 	description: "Gemini 3 Pro Preview model is an agentic and vibe-coding model by Google",
	// 	input_modalities: ["text"],
	// 	context_length: 256000,
	// 	max_output_length: 32768,
	// 	output_modalities: ["text"],
	// 	supported_sampling_parameters: [
	// 		"temperature",
	// 		"top_p",
	// 		"top_k",
	// 		"repetition_penalty",
	// 		"frequency_penalty",
	// 		"presence_penalty",
	// 		"seed",
	// 		"stop",
	// 	],
	// 	supported_features: ["tools", "structured_outputs", "web_search"],
	// 	openrouter: {
	// 		slug: "google/gemini-3-pro-preview",
	// 	},
	// 	datacenters: [{ country_code: "US" }],
	// 	created: 1750426201,
	// 	owned_by: "google",
	// 	pricing: {
	// 		prompt: "0.000001",
	// 		completion: "0.000004",
	// 		image: "0",
	// 		request: "0",
	// 		input_cache_reads: "0",
	// 		input_cache_writes: "0",
	// 	},
	// },
}

const parsePrice = (value?: string): number | undefined => {
	if (typeof value === "undefined") {
		return undefined
	}

	const trimmed = value.trim()
	if (trimmed.length === 0) {
		return undefined
	}

	const parsed = Number(trimmed)
	return Number.isFinite(parsed) ? parsed : undefined
}

const getSupportedParameters = (parameters: string[]): ModelParameter[] | undefined => {
	const supported = parameters.filter((parameter): parameter is ModelParameter => isModelParameter(parameter))

	return supported.length > 0 ? supported : undefined
}

const toOpenRouterModelProvider = (model: KiloCodeModel): OpenRouterModelProvider => {
	const cacheReadsPrice = parsePrice(model.pricing.input_cache_reads)
	const cacheWritesPrice = parsePrice(model.pricing.input_cache_writes)
	const supportedParameters = getSupportedParameters(model.supported_sampling_parameters)
	const supportsTemperature = supportedParameters?.includes("temperature")
	const datacenterLabel = model.datacenters
		.map(({ country_code }) => country_code)
		.filter(Boolean)
		.join(", ")

	return {
		maxTokens: model.max_output_length,
		contextWindow: model.context_length,
		maxThinkingTokens: undefined,
		supportsImages: model.output_modalities.includes("image"),
		supportsPromptCache: typeof cacheReadsPrice !== "undefined",
		supportsVerbosity: undefined,
		supportsReasoningBudget: undefined,
		requiredReasoningBudget: undefined,
		supportsReasoningEffort: undefined,
		supportedParameters,
		supportsTemperature,
		inputPrice: parsePrice(model.pricing.prompt),
		outputPrice: parsePrice(model.pricing.completion),
		cacheWritesPrice,
		cacheReadsPrice,
		description: model.description,
		reasoningEffort: undefined,
		minTokensPerCachePoint: undefined,
		maxCachePoints: undefined,
		cachableFields: undefined,
		displayName: model.name,
		preferredIndex: undefined,
		deprecated: undefined,
		label: datacenterLabel ? `KiloCode (${datacenterLabel})` : "KiloCode",
	}
}

// kilocode_change: baseUrl, apiKey
async function getOpenRouterProvidersForModel(modelId: string, _baseUrl?: string, _apiKey?: string) {
	const models: Record<string, OpenRouterModelProvider> = {}

	const model = KILO_CODE_MODELS[modelId]
	if (!model) {
		return models
	}

	models["KiloCode"] = toOpenRouterModelProvider(model)

	return models
}

type UseOpenRouterModelProvidersOptions = Omit<
	UseQueryOptions<Record<string, OpenRouterModelProvider>>,
	"queryKey" | "queryFn"
>

// kilocode_change start: baseUrl, apiKey, organizationId
export const useOpenRouterModelProviders = (
	modelId?: string,
	baseUrl?: string,
	apiKey?: string,
	organizationId?: string,
	options?: UseOpenRouterModelProvidersOptions,
) =>
	useQuery<Record<string, OpenRouterModelProvider>>({
		queryKey: ["openrouter-model-providers", modelId, baseUrl, apiKey, organizationId],
		queryFn: () => (modelId ? getOpenRouterProvidersForModel(modelId, baseUrl, apiKey) : {}),
		...options,
	})
// kilocode_change end
