import axios from "axios"

import { DEFAULT_HEADERS } from "../constants"
import { getOcaClientInfo } from "../utils/getOcaClientInfo"
import type { ModelRecord } from "../../../shared/api"
import type { ModelInfo } from "@roo-code/types"

export function getAxiosSettings(): { adapter?: any } {
	return { adapter: "fetch" as any }
}

export interface HttpClient {
	get: (url: string, config?: any) => Promise<{ status: number; data: any }>
}

const defaultHttpClient: HttpClient = {
	get: (url, config) => axios.get(url, config),
}

export function resolveOcaModelInfoUrl(baseUrl: string): string {
	const normalized = new URL(baseUrl)
	const basePath = normalized.pathname.replace(/\/+$/, "").replace(/\/+/g, "/")
	const urlModelInfo = new URL(normalized.href)
	urlModelInfo.pathname = `${basePath}/v1/model/info`
	return urlModelInfo.href
}

export function buildOcaHeaders(apiKey?: string, openAiHeaders?: Record<string, string>): Record<string, string> {
	const { client, clientVersion, clientIde, clientIdeVersion } = getOcaClientInfo()

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		client: client,
		"client-version": clientVersion,
		"client-ide": clientIde,
		"client-ide-version": clientIdeVersion,
		...DEFAULT_HEADERS,
		...(openAiHeaders || {}),
	}
	if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
	return headers
}

const DEFAULT_TIMEOUT_MS = 5000

function parsePrice(price: any): number | undefined {
	if (price) {
		return parseFloat(price) * 1_000_000
	}
	return undefined
}

export async function getOCAModels(
	baseUrl: string,
	apiKey?: string,
	openAiHeaders?: Record<string, string>,
	httpClient: HttpClient = defaultHttpClient,
): Promise<ModelRecord> {
	if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
		return {}
	}

	const url = resolveOcaModelInfoUrl(baseUrl)
	const headers = buildOcaHeaders(apiKey, openAiHeaders)

	try {
		const response = await httpClient.get(url, {
			headers,
			timeout: DEFAULT_TIMEOUT_MS,
			...getAxiosSettings(),
		})

		const dataArray: any[] = Array.isArray(response?.data?.data) ? response.data.data : []

		const models: ModelRecord = {}

		for (const model of dataArray) {
			const modelId = model?.litellm_params?.model
			if (typeof modelId !== "string" || !modelId) continue

			const info = model?.model_info || {}

			const maxTokens =
				typeof model?.litellm_params?.max_tokens === "number" ? model.litellm_params.max_tokens : -1
			const contextWindow =
				typeof info?.context_window === "number" && info.context_window > 0 ? info.context_window : 0

			const baseInfo: ModelInfo = {
				maxTokens,
				contextWindow,
				supportsImages: !!info?.supports_vision,
				supportsPromptCache: !!info?.supports_caching,
				inputPrice: parsePrice(info?.input_price),
				outputPrice: parsePrice(info?.output_price),
				cacheWritesPrice: parsePrice(info?.caching_price),
				cacheReadsPrice: parsePrice(info?.cached_price),
				description: info?.description,
				banner: info?.banner,
			}

			models[modelId] = baseInfo
		}

		return models
	} catch (error) {
		console.error("Failed to fetch models", error)
		throw error
	}
}
