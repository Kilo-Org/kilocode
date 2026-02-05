import axios from "axios"

import { getOcaClientInfo } from "../oca/utils/getOcaClientInfo"
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
	const url = new URL(baseUrl)
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/model/info`
	return url.toString()
}

export function buildOcaHeaders(accessToken?: string): Record<string, string> {
	const { client, clientVersion, clientIde, clientIdeVersion } = getOcaClientInfo()

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		client: client,
		"client-version": clientVersion,
		"client-ide": clientIde,
		"client-ide-version": clientIdeVersion,
	}
	if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`
	return headers
}

const DEFAULT_TIMEOUT_MS = 5000

function parsePrice(price: any): number | undefined {
	if (price !== undefined && price !== null) {
		return parseFloat(price) * 1_000_000
	}
	return undefined
}

export async function getOCAModels(
	baseUrl: string,
	accessToken?: string,
	httpClient: HttpClient = defaultHttpClient,
): Promise<ModelRecord> {
	if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
		return {}
	}

	const url = resolveOcaModelInfoUrl(baseUrl)
	const headers = buildOcaHeaders(accessToken)

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

			// Only include models that support chat completions
			const supportedApis: string[] = Array.isArray(model?.model_info?.supported_api_list) ? model.model_info?.supported_api_list : []
			if (!supportedApis.includes("CHAT_COMPLETIONS")) continue

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
	} catch (error: any) {
		console.error("Failed to fetch models", error)

		let userMsg: string
		const resp = error?.response
		const req = error?.request
		const status = resp?.status
		const statusText = resp?.statusText
		const headers = resp?.headers ?? {}

		if (resp) {
			userMsg = `Did you set up your OCA access through entitlements? OCA service returned ${status ?? "unknown"} ${statusText ?? "Unknown Status"}.`
		} else if (req) {
			userMsg =
				"Only environment variable based proxy settings is supported. PAC/WPAD files(Ex: http://wpad/wpad.dat) are not supported in kilocode. Remove if any WPAD/PAC reference from your IDE proxy settings, restart the IDE, and try again. (Refer OCA Kilo troubleshooting guide.)"
		} else {
			userMsg = error?.message || "Error occurred while fetching OCA models."
			console.error(userMsg, error)
		}

		const opcRequestId = headers?.["opc-request-id"]
		const suffix = opcRequestId ? ` opc-request-id: ${opcRequestId}` : ""
		throw new Error(`Error refreshing OCA models. ${userMsg}${suffix}`)
	}
}
