import axios, { AxiosRequestConfig } from "axios"
import NodeCache from "node-cache"
import { z } from "zod"

import { type ModelInfo, openAiModelInfoSaneDefaults } from "@roo-code/types"

const MANIFEST_CACHE_TTL_SECONDS = 300
const MODELS_CACHE_TTL_SECONDS = 300
const MODELS_DEV_CACHE_TTL_SECONDS = 300

const manifestCache = new NodeCache({ stdTTL: MANIFEST_CACHE_TTL_SECONDS, checkperiod: MANIFEST_CACHE_TTL_SECONDS })
const modelsCache = new NodeCache({ stdTTL: MODELS_CACHE_TTL_SECONDS, checkperiod: MODELS_CACHE_TTL_SECONDS })
const modelsDevCache = new NodeCache({
	stdTTL: MODELS_DEV_CACHE_TTL_SECONDS,
	checkperiod: MODELS_DEV_CACHE_TTL_SECONDS,
})

const MODELS_DEV_ENDPOINT = "https://models.dev/api.json"

const urlStringSchema = z
	.string()
	.trim()
	.min(1)
	.refine((value) => {
		try {
			new URL(value)
			return true
		} catch {
			return false
		}
	}, "Invalid URL")

const providerManifestSchema = z
	.object({
		name: z.string().min(1, "Provider name is required"),
		website: urlStringSchema,
		baseUrl: urlStringSchema,
		models_data_source: z.enum(["endpoint", "models_dev", "embedded"]),
		models_dev_provider_id: z.string().optional(),
		models_endpoint: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
	})
	.passthrough()

type ProviderManifest = z.infer<typeof providerManifestSchema>

const costSchema = z
	.object({
		input: z.number().optional(),
		output: z.number().optional(),
		cache_read: z.number().optional(),
		cache_write: z.number().optional(),
	})
	.optional()

const limitSchema = z
	.object({
		context: z.number().optional(),
		output: z.number().optional(),
	})
	.optional()

const modalitiesSchema = z
	.object({
		input: z.array(z.string()).optional(),
		output: z.array(z.string()).optional(),
	})
	.optional()

const providerModelSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		reasoning: z.boolean().optional(),
		temperature: z.boolean().optional(),
		attachment: z.boolean().optional(),
		tool_call: z.boolean().optional(),
		modalities: modalitiesSchema,
		open_weights: z.boolean().optional(),
		cost: costSchema,
		limit: limitSchema,
		description: z.string().optional(),
		display_name: z.string().optional(),
	})
	.passthrough()

const providerModelsResponseSchema = z
	.object({
		models: z.record(providerModelSchema).default({}),
	})
	.passthrough()

type ProviderModelsMap = Record<string, ModelInfo>

const modelsDevProviderSchema = z
	.object({
		id: z.string().optional(),
		api: z.string().optional(),
		name: z.string().optional(),
		models: z.record(providerModelSchema).default({}),
	})
	.passthrough()

const modelsDevResponseSchema = z.record(modelsDevProviderSchema)

export interface ProviderModelFetchOptions {
	manifestUrl: string
	apiKey?: string
	headers?: Record<string, string>
	forceRefresh?: boolean
}

export interface EmbeddedProviderData {
	manifest: ProviderManifest
	models: ProviderModelsMap
}

export interface ProviderManifestFetchOptions {
	forceRefresh?: boolean
	headers?: Record<string, string>
}

const getManifestCacheKey = (manifestUrl: string): string => manifestUrl
const getModelsCacheKey = (manifestUrl: string): string => manifestUrl
const MODELS_DEV_CACHE_KEY = "models.dev"

const normalizeHeaders = (
	manifestHeaders?: Record<string, string>,
	userHeaders?: Record<string, string>,
	apiKey?: string,
): Record<string, string> => {
	const headers: Record<string, string> = {}

	if (manifestHeaders) {
		for (const [key, value] of Object.entries(manifestHeaders)) {
			headers[key.toLowerCase()] = value
		}
	}

	if (userHeaders) {
		for (const [key, value] of Object.entries(userHeaders)) {
			headers[key.toLowerCase()] = value
		}
	}

	if (apiKey && !headers["authorization"]) {
		headers["authorization"] = `Bearer ${apiKey}`
	}

	return headers
}

const sanitizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "")

const buildModelsEndpointUrl = (manifest: ProviderManifest): string => {
	if (manifest.models_endpoint) {
		try {
			const endpointUrl = new URL(manifest.models_endpoint, manifest.baseUrl)
			if (!endpointUrl.searchParams.has("extended")) {
				endpointUrl.searchParams.set("extended", "true")
			}
			return endpointUrl.toString()
		} catch {
			throw new Error("Invalid models_endpoint in provider manifest")
		}
	}

	const baseUrl = sanitizeBaseUrl(manifest.baseUrl)
	const url = new URL(baseUrl)
	url.pathname = `${url.pathname.replace(/\/$/, "")}/models`
	if (!url.searchParams.has("extended")) {
		url.searchParams.set("extended", "true")
	}
	return url.toString()
}

const toModelInfo = (modelId: string, raw: z.infer<typeof providerModelSchema>): ModelInfo => {
	const baseInfo: ModelInfo = {
		...openAiModelInfoSaneDefaults,
		// Always override values that might be inaccurate in defaults
		supportsImages: false,
		supportsPromptCache: false,
	}

	const modalities = raw.modalities
	const supportsImages =
		!!modalities?.input?.some((value) => value.toLowerCase() === "image") ||
		!!modalities?.output?.some((value) => value.toLowerCase() === "image")

	const contextWindow = raw.limit?.context ?? baseInfo.contextWindow
	const maxTokens = raw.limit?.output ?? raw.limit?.context ?? baseInfo.maxTokens ?? undefined

	const supportsPromptCache =
		(raw as any).supports_prompt_cache === true ||
		(raw.cost?.cache_write ?? raw.cost?.cache_read) !== undefined ||
		raw.attachment === true

	const modelInfo: ModelInfo = {
		...baseInfo,
		contextWindow,
		maxTokens: maxTokens ?? null,
		supportsImages,
		supportsPromptCache,
		supportsTemperature: raw.temperature ?? baseInfo.supportsTemperature,
		supportsReasoningBudget: raw.reasoning,
		requiredReasoningBudget: raw.reasoning ? raw.attachment === true : baseInfo.requiredReasoningBudget,
		inputPrice: raw.cost?.input ?? baseInfo.inputPrice,
		outputPrice: raw.cost?.output ?? baseInfo.outputPrice,
		cacheReadsPrice: raw.cost?.cache_read ?? baseInfo.cacheReadsPrice,
		cacheWritesPrice: raw.cost?.cache_write ?? baseInfo.cacheWritesPrice,
		description: raw.description ?? raw.name ?? baseInfo.description,
		displayName: raw.name ?? raw.display_name ?? raw.id ?? modelId,
	}

	return modelInfo
}

export const parseEmbeddedProviderData = (rawData: string): EmbeddedProviderData => {
	let parsed: unknown
	try {
		parsed = JSON.parse(rawData)
	} catch (error) {
		throw new Error("Embedded provider JSON is not valid JSON")
	}

	if (!Array.isArray(parsed) || parsed.length < 2) {
		throw new Error("Embedded provider JSON must be an array with [manifest, models]")
	}

	const [manifestRaw, modelsRaw] = parsed as [unknown, unknown]
	const manifest = providerManifestSchema.parse(manifestRaw)
	if (manifest.models_data_source !== "embedded") {
		throw new Error("Embedded provider manifest must set models_data_source to 'embedded'")
	}

	const modelsParsed = providerModelsResponseSchema.parse(modelsRaw)
	const modelEntries: ProviderModelsMap = {}

	for (const [modelId, modelData] of Object.entries(modelsParsed.models)) {
		modelEntries[modelId] = toModelInfo(modelId, modelData)
	}

	return { manifest, models: modelEntries }
}

const fetchModelsFromEndpoint = async (
	manifest: ProviderManifest,
	options: ProviderModelFetchOptions,
): Promise<ProviderModelsMap> => {
	const endpointUrl = buildModelsEndpointUrl(manifest)

	const headers = normalizeHeaders(manifest.headers, options.headers, options.apiKey)

	const axiosConfig: AxiosRequestConfig = {
		headers,
	}

	const response = await axios.get(endpointUrl, axiosConfig)

	const parsed = providerModelsResponseSchema.parse(response.data)

	const result: ProviderModelsMap = {}

	for (const [modelId, rawModel] of Object.entries(parsed.models)) {
		result[modelId] = toModelInfo(modelId, rawModel)
	}

	return result
}

const fetchModelsFromModelsDev = async (
	manifest: ProviderManifest,
	options: ProviderModelFetchOptions,
): Promise<ProviderModelsMap> => {
	if (!manifest.models_dev_provider_id) {
		throw new Error("models_dev_provider_id is required when models_data_source is 'models_dev'")
	}

	const cached = modelsDevCache.get(MODELS_DEV_CACHE_KEY)
	let data: Record<string, z.infer<typeof modelsDevProviderSchema>>

	if (cached) {
		data = cached as Record<string, z.infer<typeof modelsDevProviderSchema>>
	} else {
		const response = await axios.get(MODELS_DEV_ENDPOINT, { headers: options.headers })
		data = modelsDevResponseSchema.parse(response.data)
		modelsDevCache.set(MODELS_DEV_CACHE_KEY, data)
	}

	const providerEntry = data[manifest.models_dev_provider_id]

	if (!providerEntry) {
		throw new Error(
			`models.dev response did not include provider '${manifest.models_dev_provider_id}'. Ensure the manifest is up to date.`,
		)
	}

	const result: ProviderModelsMap = {}

	for (const [modelId, rawModel] of Object.entries(providerEntry.models ?? {})) {
		result[modelId] = toModelInfo(modelId, rawModel)
	}

	return result
}

export const getProviderManifest = async (
	manifestUrl: string,
	options: ProviderManifestFetchOptions = {},
): Promise<ProviderManifest> => {
	const cacheKey = getManifestCacheKey(manifestUrl)

	if (!options.forceRefresh) {
		const cached = manifestCache.get(cacheKey)
		if (cached) {
			return cached as ProviderManifest
		}
	}

	const response = await axios.get(manifestUrl, { headers: options.headers })
	const manifest = providerManifestSchema.parse(response.data)
	manifestCache.set(cacheKey, manifest)
	return manifest
}

export const getProviderModels = async (opts: ProviderModelFetchOptions): Promise<ProviderModelsMap> => {
	const { manifestUrl, forceRefresh } = opts
	const cacheKey = getModelsCacheKey(manifestUrl)

	if (!forceRefresh) {
		const cached = modelsCache.get(cacheKey)
		if (cached) {
			return cached as ProviderModelsMap
		}
	}

	const manifest = await getProviderManifest(manifestUrl, {
		forceRefresh,
		headers: opts.headers,
	})

	let models: ProviderModelsMap

	if (manifest.models_data_source === "endpoint") {
		models = await fetchModelsFromEndpoint(manifest, opts)
	} else if (manifest.models_data_source === "models_dev") {
		models = await fetchModelsFromModelsDev(manifest, opts)
	} else {
		throw new Error("Embedded models must be supplied via embedded data, not fetched by URL")
	}

	modelsCache.set(cacheKey, models)
	return models
}

export const getProviderModelsFromCache = (manifestUrl: string): ProviderModelsMap | undefined => {
	const cacheKey = getModelsCacheKey(manifestUrl)
	return modelsCache.get(cacheKey) as ProviderModelsMap | undefined
}

export const clearProviderCache = (manifestUrl: string) => {
	const cacheKey = getModelsCacheKey(manifestUrl)
	modelsCache.del(cacheKey)
}

export const clearAllProviderDefinedCaches = () => {
	manifestCache.flushAll()
	modelsCache.flushAll()
	modelsDevCache.flushAll()
}

export type { ProviderManifest }
