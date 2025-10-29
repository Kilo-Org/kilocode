import axios from "axios"

import { DEFAULT_HEADERS } from "../constants"
import { getOcaClientInfo } from "../utils/getOcaClientInfo"
import type { ModelRecord } from "../../../shared/api"

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

export interface OcaModelEntry {
	id: string
	banner?: string
}

export function parseOcaModelInfoResponse(data: any): OcaModelEntry[] {
	const arr = data?.data
	if (!Array.isArray(arr)) return []

	const byId = new Map<string, OcaModelEntry>()
	for (const m of arr) {
		const id = typeof m?.id === "string" ? m.id : undefined
		if (!id) continue
		const banner = typeof m?.banner === "string" ? m.banner : undefined
		const existing = byId.get(id)
		if (!existing || (banner && !existing.banner)) {
			byId.set(id, { id, banner })
		}
	}
	return Array.from(byId.values())
}

export function toModelRecord(entries: OcaModelEntry[]): ModelRecord {
	const record: ModelRecord = {}
	for (const { id, banner } of entries) {
		const info: any = {
			maxTokens: 8192,
			contextWindow: 200000,
			supportsPromptCache: false,
			description: `${id} via OCA`,
		}
		if (banner) info.banner = banner
		record[id] = info
	}
	return record
}

export function normalizeOcaModelsError(error: unknown): Error {
	if (axios.isAxiosError(error)) {
		const status = error.response?.status
		const statusText = error.response?.statusText
		if (status) {
			return new Error(`Failed to fetch OCA models: ${status} ${statusText || ""}`.trim())
		}
		if (error.request) {
			return new Error("Failed to fetch OCA models: No response from server. Check server status and base URL.")
		}
		return new Error(`Failed to fetch OCA models: ${error.message}`)
	}
	return new Error(`Failed to fetch OCA models: ${error instanceof Error ? error.message : String(error)}`)
}

const DEFAULT_TIMEOUT_MS = 5000

export async function getOCAModels(
	baseUrl: string,
	apiKey?: string,
	openAiHeaders?: Record<string, string>,
	httpClient: HttpClient = defaultHttpClient,
): Promise<ModelRecord> {
	if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
		return {}
	}

	try {
		const url = resolveOcaModelInfoUrl(baseUrl)
		const headers = buildOcaHeaders(apiKey, openAiHeaders)

		const resp = await httpClient.get(url, {
			headers,
			timeout: DEFAULT_TIMEOUT_MS,
			...getAxiosSettings(),
		})

		const entries = parseOcaModelInfoResponse(resp?.data)
		if (entries.length === 0) {
			// Treat empty data as an error so callers can surface a useful message
			throw new Error("No models returned from /v1/model/info")
		}
		return toModelRecord(entries)
	} catch (error) {
		throw normalizeOcaModelsError(error)
	}
}
