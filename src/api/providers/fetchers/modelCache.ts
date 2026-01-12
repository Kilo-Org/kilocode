import * as path from "path"
import fs from "fs/promises"
import * as fsSync from "fs"

import NodeCache from "node-cache"
import { z } from "zod"

import type { ProviderName } from "@roo-code/types"
import { modelInfoSchema, TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { safeWriteJson } from "../../../utils/safeWriteJson"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import type { RouterName, ModelRecord } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModels } from "./openrouter"
import { getVercelAiGatewayModels } from "./vercel-ai-gateway"
import { getRequestyModels } from "./requesty"
import { getGlamaModels } from "./glama" // kilocode_change
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"
import { GetModelsOptions } from "../../../shared/api"
import { getKiloUrlFromToken } from "@roo-code/types"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"
import { getIOIntelligenceModels } from "./io-intelligence"
// kilocode_change start
import { getOvhCloudAiEndpointsModels } from "./ovhcloud"
import { getGeminiModels } from "./gemini"
import { getInceptionModels } from "./inception"
import { getSyntheticModels } from "./synthetic"
import { getSapAiCoreModels } from "./sap-ai-core"
// kilocode_change end

import { getDeepInfraModels } from "./deepinfra"
import { getHuggingFaceModels } from "./huggingface"
import { getRooModels } from "./roo"
import { getChutesModels } from "./chutes"
import { getNanoGptModels } from "./nano-gpt" //kilocode_change

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

// Zod schema for validating ModelRecord structure from disk cache
const modelRecordSchema = z.record(z.string(), modelInfoSchema)

// Track in-flight refresh requests to prevent concurrent API calls for the same provider
// This prevents race conditions where multiple calls might overwrite each other's results
const inFlightRefresh = new Map<RouterName, Promise<ModelRecord>>()

export /*kilocode_change*/ async function writeModels(router: RouterName, data: ModelRecord) {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

export /*kilocode_change*/ async function readModels(router: RouterName): Promise<ModelRecord | undefined> {
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	return exists ? JSON.parse(await fs.readFile(filePath, "utf8")) : undefined
}

/**
 * Fetch models from the provider API.
 * Extracted to avoid duplication between getModels() and refreshModels().
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from the provider API
 */
async function fetchModelsFromProvider(options: GetModelsOptions): Promise<ModelRecord> {
	const { provider } = options

	let models: ModelRecord

	switch (provider) {
		case "openrouter":
			// kilocode_change start: base url and bearer token
			models = await getOpenRouterModels({
				openRouterBaseUrl: options.baseUrl,
				headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : undefined,
			})
			// kilocode_change end
			break
		case "requesty":
			// Requesty models endpoint requires an API key for per-user custom policies.
			models = await getRequestyModels(options.baseUrl, options.apiKey)
			break
		// kilocode_change start
		case "glama":
			models = await getGlamaModels()
			break
		// kilocode_change end
		case "unbound":
			// Unbound models endpoint requires an API key to fetch application specific models.
			models = await getUnboundModels(options.apiKey)
			break
		case "litellm":
			// Type safety ensures apiKey and baseUrl are always provided for LiteLLM.
			models = await getLiteLLMModels(options.apiKey ?? "", options.baseUrl ?? "") // kilocode_change: null coalescing
			break
		// kilocode_change start
		case "kilocode": {
			const backendUrl = options.kilocodeOrganizationId
				? `https://api.kilo.ai/api/organizations/${options.kilocodeOrganizationId}`
				: "https://api.kilo.ai/api/openrouter"
			const openRouterBaseUrl = getKiloUrlFromToken(backendUrl, options.kilocodeToken ?? "")
			models = await getOpenRouterModels({
				openRouterBaseUrl,
				headers: options.kilocodeToken ? { Authorization: `Bearer ${options.kilocodeToken}` } : undefined,
			})
			break
		}
		case "synthetic":
			models = await getSyntheticModels(options.apiKey)
			break
		case "gemini":
			models = await getGeminiModels({
				apiKey: options.apiKey,
				baseUrl: options.baseUrl,
			})
			break
		// kilocode_change end
		case "ollama":
			models = await getOllamaModels(options.baseUrl, options.apiKey, options.numCtx /*kilocode_change*/)
			break
		case "lmstudio":
			models = await getLMStudioModels(options.baseUrl)
			break
		case "deepinfra":
			models = await getDeepInfraModels(options.apiKey, options.baseUrl)
			break
		case "io-intelligence":
			models = await getIOIntelligenceModels(options.apiKey)
			break
		case "vercel-ai-gateway":
			models = await getVercelAiGatewayModels()
			break
		case "huggingface":
			models = await getHuggingFaceModels()
			break
		// kilocode_change start
		case "sap-ai-core":
			models = await getSapAiCoreModels(
				options.sapAiCoreServiceKey,
				options.sapAiCoreResourceGroup,
				options.sapAiCoreUseOrchestration,
			)
			break
		case "inception":
			models = await getInceptionModels()
			break
		case "ovhcloud":
			models = await getOvhCloudAiEndpointsModels()
			break
		// kilocode_change end
		case "roo": {
			// Roo Code Cloud provider requires baseUrl and optional apiKey
			const rooBaseUrl = options.baseUrl ?? process.env.ROO_CODE_PROVIDER_URL ?? "https://api.roocode.com/proxy"
			models = await getRooModels(rooBaseUrl, options.apiKey)
			break
		}
		case "chutes":
			models = await getChutesModels(options.apiKey)
			break
		//kilocode_change start
		case "nano-gpt":
			models = await getNanoGptModels({
				nanoGptModelList: options.nanoGptModelList,
				apiKey: options.apiKey,
			})
			break
		//kilocode_change end
		default: {
			// Ensures router is exhaustively checked if RouterName is a strict union.
			const exhaustiveCheck: never = provider
			throw new Error(`Unknown provider: ${exhaustiveCheck}`)
		}
	}

	return models
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	let models = getModelsFromCache(provider)

	if (models) {
		return models
	}

	try {
		models = await fetchModelsFromProvider(options)
		const modelCount = Object.keys(models).length

		// Only cache non-empty results to prevent persisting failed API responses
		// Empty results could indicate API failure rather than "no models exist"
		if (modelCount > 0) {
			memoryCache.set(provider, models)

			// kilocode_change start: prevent eternal caching of kilocode models
			if (provider !== "kilocode") {
				await writeModels(provider, models).catch((err) =>
					console.error(`[MODEL_CACHE] Error writing ${provider} models to file cache:`, err),
				)
			}
			// kilocode_change end
		} else {
			TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
				provider,
				context: "getModels",
				hasExistingCache: false,
			})
		}

		return models
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		console.error(`[getModels] Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Force-refresh models from API, bypassing cache.
 * Uses atomic writes so cache remains available during refresh.
 * This function also prevents concurrent API calls for the same provider using
 * in-flight request tracking to avoid race conditions.
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from API, or existing cache if refresh yields worse data
 */
export const refreshModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	// Check if there's already an in-flight refresh for this provider
	// This prevents race conditions where multiple concurrent refreshes might
	// overwrite each other's results
	const existingRequest = inFlightRefresh.get(provider)
	if (existingRequest) {
		return existingRequest
	}

	// Create the refresh promise and track it
	const refreshPromise = (async (): Promise<ModelRecord> => {
		try {
			// Force fresh API fetch - skip getModelsFromCache() check
			const models = await fetchModelsFromProvider(options)
			const modelCount = Object.keys(models).length

			// Get existing cached data for comparison
			const existingCache = getModelsFromCache(provider)
			const existingCount = existingCache ? Object.keys(existingCache).length : 0

			if (modelCount === 0) {
				TelemetryService.instance.captureEvent(TelemetryEventName.MODEL_CACHE_EMPTY_RESPONSE, {
					provider,
					context: "refreshModels",
					hasExistingCache: existingCount > 0,
					existingCacheSize: existingCount,
				})
				if (existingCount > 0) {
					return existingCache!
				} else {
					return {}
				}
			}

			// Update memory cache first
			memoryCache.set(provider, models)

			// Atomically write to disk (safeWriteJson handles atomic writes)
			await writeModels(provider, models).catch((err) =>
				console.error(`[refreshModels] Error writing ${provider} models to disk:`, err),
			)

			return models
		} catch (error) {
			// Log the error for debugging, then return existing cache if available (graceful degradation)
			console.error(`[refreshModels] Failed to refresh ${provider} models:`, error)
			return getModelsFromCache(provider) || {}
		} finally {
			// Always clean up the in-flight tracking
			inFlightRefresh.delete(provider)
		}
	})()

	// Track the in-flight request
	inFlightRefresh.set(provider, refreshPromise)

	return refreshPromise
}

/**
 * Initialize background model cache refresh.
 * Refreshes public provider caches without blocking or requiring auth.
 * Should be called once during extension activation.
 */
export async function initializeModelCacheRefresh(): Promise<void> {
	// Wait for extension to fully activate before refreshing
	setTimeout(async () => {
		// Providers that work without API keys
		const publicProviders: Array<{ provider: RouterName; options: GetModelsOptions }> = [
			{ provider: "openrouter", options: { provider: "openrouter" } },
			{ provider: "glama", options: { provider: "glama" } }, // kilocode_change
			{ provider: "vercel-ai-gateway", options: { provider: "vercel-ai-gateway" } },
			{ provider: "chutes", options: { provider: "chutes" } },
			{ provider: "synthetic", options: { provider: "synthetic" } }, // kilocode_change: Add synthetic to background refresh
			{ provider: "nano-gpt", options: { provider: "nano-gpt" } }, // kilocode_change: Add nanogpt to background refresh
			{ provider: "huggingface", options: { provider: "huggingface" } }, // kilocode_change: Add huggingface to background refresh
			{ provider: "deepinfra", options: { provider: "deepinfra" } }, // kilocode_change: Add deepinfra to background refresh
			{ provider: "inception", options: { provider: "inception" } }, // kilocode_change: Add inception to background refresh
			{ provider: "lmstudio", options: { provider: "lmstudio" } }, // kilocode_change: Add lmstudio to background refresh
			{ provider: "requesty", options: { provider: "requesty" } }, // kilocode_change: Add requesty to background refresh
			{ provider: "sap-ai-core", options: { provider: "sap-ai-core" } }, // kilocode_change: Add sap-ai-core to background refresh
			{ provider: "unbound", options: { provider: "unbound" } }, // kilocode_change: Add unbound to background refresh
			{ provider: "ollama", options: { provider: "ollama" } }, // kilocode_change: Add ollama to background refresh
			{ provider: "io-intelligence", options: { provider: "io-intelligence" } }, // kilocode_change: Add io-intelligence to background refresh
			{ provider: "ovhcloud", options: { provider: "ovhcloud" } }, // kilocode_change: Add ovhcloud to background refresh
			{ provider: "litellm", options: { provider: "litellm" } }, // kilocode_change: Add litellm to background refresh
		]

		// Refresh each provider in background (fire and forget)
		for (const { options } of publicProviders) {
			refreshModels(options).catch(() => {
				// Silent fail - old cache remains available
			})

			// Small delay between refreshes to avoid API rate limits
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
	}, 2000)
}

/**
 * Flush models memory cache for a specific router.
 *
 * @param router - The router to flush models for.
 * @param refresh - If true, immediately fetch fresh data from API
 */
export const flushModels = async (router: RouterName, refresh: boolean = false): Promise<void> => {
	if (refresh) {
		// Don't delete memory cache - let refreshModels atomically replace it
		// This prevents a race condition where getModels() might be called
		// before refresh completes, avoiding a gap in cache availability
		refreshModels({ provider: router } as GetModelsOptions).catch((error) => {
			console.error(`[flushModels] Refresh failed for ${router}:`, error)
		})
	} else {
		// Only delete memory cache when not refreshing
		memoryCache.del(router)
	}
}

/**
 * Get models from cache, checking memory first, then disk.
 * This ensures providers always have access to last known good data,
 * preventing fallback to hardcoded defaults on startup.
 *
 * @param provider - The provider to get models for.
 * @returns Models from memory cache, disk cache, or undefined if not cached.
 */
export function getModelsFromCache(provider: ProviderName): ModelRecord | undefined {
	// Check memory cache first (fast)
	const memoryModels = memoryCache.get<ModelRecord>(provider)
	if (memoryModels) {
		return memoryModels
	}

	// kilocode_change start: prevent eternal caching of kilocode models
	if (provider === "kilocode") {
		return undefined
	}
	// kilocode_change end

	// Memory cache miss - try to load from disk synchronously
	// This is acceptable because it only happens on cold start or after cache expiry
	try {
		const filename = `${provider}_models.json`
		const cacheDir = getCacheDirectoryPathSync()
		if (!cacheDir) {
			return undefined
		}

		const filePath = path.join(cacheDir, filename)

		// Use synchronous fs to avoid async complexity in getModel() callers
		if (fsSync.existsSync(filePath)) {
			const data = fsSync.readFileSync(filePath, "utf8")
			const models = JSON.parse(data)

			// Validate the disk cache data structure using Zod schema
			// This ensures the data conforms to ModelRecord = Record<string, ModelInfo>
			const validation = modelRecordSchema.safeParse(models)
			if (!validation.success) {
				console.error(
					`[MODEL_CACHE] Invalid disk cache data structure for ${provider}:`,
					validation.error.format(),
				)
				return undefined
			}

			// Populate memory cache for future fast access
			memoryCache.set(provider, validation.data)

			return validation.data
		}
	} catch (error) {
		console.error(`[MODEL_CACHE] Error loading ${provider} models from disk:`, error)
	}

	return undefined
}

/**
 * Synchronous version of getCacheDirectoryPath for use in getModelsFromCache.
 * Returns the cache directory path without async operations.
 */
function getCacheDirectoryPathSync(): string | undefined {
	try {
		const globalStoragePath = ContextProxy.instance?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			return undefined
		}
		const cachePath = path.join(globalStoragePath, "cache")
		return cachePath
	} catch (error) {
		console.error(`[MODEL_CACHE] Error getting cache directory path:`, error)
		return undefined
	}
}
