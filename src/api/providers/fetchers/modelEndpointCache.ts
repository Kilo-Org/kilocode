import * as path from "path"
import fs from "fs/promises"

import NodeCache from "node-cache"
import { safeWriteJson } from "../../../utils/safeWriteJson"
import sanitize from "sanitize-filename"

import { ContextProxy } from "../../../core/config/ContextProxy"
import { getCacheDirectoryPath } from "../../../utils/storage"
import { RouterName, ModelRecord } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getOpenRouterModelEndpoints } from "./openrouter"
import { getModels } from "./modelCache"

const memoryCache = new NodeCache({ stdTTL: 5 * 60, checkperiod: 5 * 60 })

const getCacheKey = (router: RouterName, modelId: string) => sanitize(`${router}_${modelId}`)

async function writeModelEndpoints(key: string, data: ModelRecord) {
	const filename = `${key}_endpoints.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

async function readModelEndpoints(key: string): Promise<ModelRecord | undefined> {
	const filename = `${key}_endpoints.json`
	const cacheDir = await getCacheDirectoryPath(ContextProxy.instance.globalStorageUri.fsPath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	return exists ? JSON.parse(await fs.readFile(filePath, "utf8")) : undefined
}

export const getModelEndpoints = async ({
	router,
	modelId,
	endpoint,
}: {
	router: RouterName
	modelId?: string
	endpoint?: string
}): Promise<ModelRecord> => {
	// OpenRouter is the only provider that supports model endpoints, but you
	// can see how we'd extend this to other providers in the future.
	if (router !== "openrouter" || !modelId || !endpoint) {
		return {}
	}

	const key = getCacheKey(router, modelId)
	let modelProviders = memoryCache.get<ModelRecord>(key)

	if (modelProviders) {
		// console.log(`[getModelProviders] NodeCache hit for ${key} -> ${Object.keys(modelProviders).length}`)
		return modelProviders
	}

	modelProviders = await getOpenRouterModelEndpoints(modelId)

	// Copy model-level capabilities from the parent model to each endpoint
	// These are capabilities that don't vary by provider (tools, reasoning, etc.)
	if (Object.keys(modelProviders).length > 0) {
		const parentModels = await getModels({ provider: "openrouter" })
		const parentModel = parentModels[modelId]

		if (parentModel) {
			// Copy model-level capabilities to all endpoints
			// Clone arrays to avoid shared mutable references
			for (const endpointKey of Object.keys(modelProviders)) {
				modelProviders[endpointKey].supportsNativeTools = parentModel.supportsNativeTools
				modelProviders[endpointKey].supportsReasoningEffort = parentModel.supportsReasoningEffort
				modelProviders[endpointKey].supportedParameters = parentModel.supportedParameters
					? [...parentModel.supportedParameters]
					: undefined
			}
		}
	}

	if (Object.keys(modelProviders).length > 0) {
		// console.log(`[getModelProviders] API fetch for ${key} -> ${Object.keys(modelProviders).length}`)
		memoryCache.set(key, modelProviders)

		try {
			await writeModelEndpoints(key, modelProviders)
			// console.log(`[getModelProviders] wrote ${key} endpoints to file cache`)
		} catch (error) {
			console.error(`[getModelProviders] error writing ${key} endpoints to file cache`, error)
		}

		return modelProviders
	}

	try {
		modelProviders = await readModelEndpoints(router)
		// console.log(`[getModelProviders] read ${key} endpoints from file cache`)
	} catch (error) {
		console.error(`[getModelProviders] error reading ${key} endpoints from file cache`, error)
	}

	return modelProviders ?? {}
}

export const flushModelProviders = async (router: RouterName, modelId: string) =>
	memoryCache.del(getCacheKey(router, modelId))
