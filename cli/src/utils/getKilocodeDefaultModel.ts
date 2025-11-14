import { openRouterDefaultModelId } from "@roo-code/types"
import { getKiloUrlFromToken } from "@roo-code/types"
import { z } from "zod"
import { logs } from "../services/logs.js"

type KilocodeToken = string
type OrganizationId = string

const API_TIMEOUT_MS = 5000

const defaultsSchema = z.object({
	defaultModel: z.string().nullish(),
})

const DEFAULT_HEADERS = {
	"Content-Type": "application/json",
}

/**
 * Fetch with timeout wrapper
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		})
		clearTimeout(timeoutId)
		return response
	} catch (error) {
		clearTimeout(timeoutId)
		throw error
	}
}

/**
 * Fetch the default model from Kilocode API
 * @param kilocodeToken - The Kilocode API token
 * @param organizationId - Optional organization ID for org-specific defaults
 * @returns The default model ID, or falls back to openRouterDefaultModelId on error
 */
export async function getKilocodeDefaultModel(
	kilocodeToken: KilocodeToken,
	organizationId?: OrganizationId,
): Promise<string> {
	try {
		const path = organizationId ? `/organizations/${organizationId}/defaults` : `/defaults`
		const url = getKiloUrlFromToken(`https://api.kilocode.ai/api${path}`, kilocodeToken)

		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			Authorization: `Bearer ${kilocodeToken}`,
		}

		const response = await fetchWithTimeout(url, { headers }, API_TIMEOUT_MS)

		if (!response.ok) {
			throw new Error(`Fetching default model from ${url} failed: ${response.status}`)
		}

		const defaultModel = (await defaultsSchema.parseAsync(await response.json())).defaultModel

		if (!defaultModel) {
			throw new Error(`Default model from ${url} was empty`)
		}

		logs.info(`Fetched default model from Kilocode API: ${defaultModel}`, "getKilocodeDefaultModel")
		return defaultModel
	} catch (err) {
		logs.error("Failed to get default model from Kilocode API, using fallback", "getKilocodeDefaultModel", {
			error: err,
		})
		return openRouterDefaultModelId
	}
}
