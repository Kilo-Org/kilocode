import axios from "axios"

import { LITELLM_COMPUTER_USE_MODELS } from "@roo-code/types"

import type { ModelRecord } from "../../../shared/api"

import { DEFAULT_HEADERS } from "../constants"
/**
 * Fetches available models from a LiteLLM server
 *
 * @param apiKey The API key for the LiteLLM server
 * @param baseUrl The base URL of the LiteLLM server
 * @returns A promise that resolves to a record of model IDs to model info
 * @throws Will throw an error if the request fails or the response is not as expected.
 */
export async function getOCAModels(baseUrl: string, apiKey?: string, openAiHeaders?: Record<string, string>) {
	try {
		if (!baseUrl) return []

		// Construct robust URLs and normalize path (try /v1/models then /v1/model/info)
		const normalized = new URL(baseUrl)
		const basePath = normalized.pathname.replace(/\/+$/, "").replace(/\/+/g, "/")
		const urlModels = new URL(normalized.href)
		urlModels.pathname = basePath + "/v1/models"
		const urlModelInfo = new URL(normalized.href)
		urlModelInfo.pathname = basePath + "/v1/model/info"

		// Merge headers: global defaults + caller overrides + auth
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...DEFAULT_HEADERS,
			...(openAiHeaders || {}),
		}
		if (apiKey) {
			headers["Authorization"] = `Bearer ${apiKey}`
		}

		// Helper to try an endpoint and parse ids
		const tryFetchIds = async (endpoint: string): Promise<string[] | null> => {
			try {
				const resp = await axios.get(endpoint, { headers, timeout: 5000 })
				const arr = resp?.data?.data
				if (Array.isArray(arr)) {
					const ids = arr.map((m: any) => m?.id).filter((id: any) => typeof id === "string")
					return [...new Set<string>(ids)]
				}
				return null
			} catch {
				return null
			}
		}

		// Try /v1/models first, then fallback to /v1/model/info
		const idsFromModels = await tryFetchIds(urlModels.href)
		if (idsFromModels && idsFromModels.length > 0) {
			return idsFromModels
		}
		const idsFromModelInfo = await tryFetchIds(urlModelInfo.href)
		if (idsFromModelInfo && idsFromModelInfo.length > 0) {
			return idsFromModelInfo
		}

		throw new Error(
			"Failed to fetch OpenAI-compatible models: no supported models endpoint found (tried /v1/models and /v1/model/info)",
		)
	} catch (error: any) {
		if (axios.isAxiosError(error)) {
			if (error.response) {
				throw new Error(
					`Failed to fetch OpenAI-compatible models: ${error.response.status} ${error.response.statusText}. Check base URL and API key.`,
				)
			}
			if (error.request) {
				throw new Error(
					"Failed to fetch OpenAI-compatible models: No response from server. Check server status and base URL.",
				)
			}
		}
		throw new Error(`Failed to fetch OpenAI-compatible models: ${error?.message || String(error)}`)
	}
}
