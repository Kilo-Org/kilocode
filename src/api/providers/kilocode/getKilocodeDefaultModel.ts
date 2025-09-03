import { openRouterDefaultModelId } from "@roo-code/types"
import { getKiloBaseUriFromToken } from "../../../shared/kilocode/token"
import { TelemetryService } from "@roo-code/telemetry"
import { z } from "zod"
import { fetchWithTimeout } from "./fetchWithTimeout"
import { DEFAULT_HEADERS } from "../constants"

type KilocodeToken = string

const cache = new Map<KilocodeToken, Promise<string>>()

const defaultsSchema = z.object({
	defaultModel: z.string().nullish(),
})

const fetcher = fetchWithTimeout(5000)

async function fetchKilocodeDefaultModel(kilocodeToken: KilocodeToken): Promise<string> {
	try {
		const url = `${getKiloBaseUriFromToken(kilocodeToken)}/api/defaults`
		const response = await fetcher(url, {
			headers: {
				...DEFAULT_HEADERS,
				Authorization: `Bearer ${kilocodeToken}`,
			},
		})
		if (!response.ok) {
			throw new Error(`Fetching default model from ${url} failed: ${response.status}`)
		}
		const defaultModel = (await defaultsSchema.parseAsync(await response.json())).defaultModel
		if (!defaultModel) {
			throw new Error(`Default model from ${url} was empty`)
		}
		console.info(`Fetched default model from ${url}: ${defaultModel}`)
		return defaultModel
	} catch (err) {
		console.error("Failed to get default model", err)
		TelemetryService.instance.captureException(err, { context: "getKilocodeDefaultModel" })
		return openRouterDefaultModelId
	}
}

export async function getKilocodeDefaultModel(kilocodeToken?: KilocodeToken): Promise<string> {
	if (!kilocodeToken) {
		return openRouterDefaultModelId
	}
	let defaultModelPromise = cache.get(kilocodeToken ?? "")
	if (!defaultModelPromise) {
		defaultModelPromise = fetchKilocodeDefaultModel(kilocodeToken)
		cache.set(kilocodeToken, defaultModelPromise)
	}
	return await defaultModelPromise
}
