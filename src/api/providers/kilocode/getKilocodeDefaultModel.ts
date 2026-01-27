import { openRouterDefaultModelId, type ProviderSettings } from "@roo-code/types"
import { getKiloUrlFromToken } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { z } from "zod"
import { DEFAULT_HEADERS } from "../constants"

type KilocodeToken = string

type OrganizationId = string

const defaultsSchema = z.object({
	defaultModel: z.string(),
	defaultFreeModel: z.string().optional(),
})

type Defaults = z.infer<typeof defaultsSchema>

const cache = new Map<string, Promise<Defaults>>()

async function fetchKilocodeDefaultModel(
	kilocodeToken?: KilocodeToken,
	organizationId?: OrganizationId,
): Promise<Defaults> {
	try {
		const path = organizationId ? `/organizations/${organizationId}/defaults` : `/defaults`
		const url = getKiloUrlFromToken(`https://api.kilo.ai/api${path}`, kilocodeToken)

		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
		}

		if (kilocodeToken) {
			headers["Authorization"] = `Bearer ${kilocodeToken}`
		}

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 5000)
		const response = await fetch(url, { headers, signal: controller.signal })
		clearTimeout(timeout)
		if (!response.ok) {
			throw new Error(`Fetching default model from ${url} failed: ${response.status}`)
		}
		const defaultModel = await defaultsSchema.safeParseAsync(await response.json())
		if (!defaultModel.data) {
			throw new Error(
				`Default model from ${url} was invalid: ${JSON.stringify(defaultModel.error.format(), undefined, 2)}`,
			)
		}
		console.info(`Fetched default model from ${url}: ${defaultModel.data.defaultModel}`)
		return defaultModel.data
	} catch (err) {
		console.error("Failed to get default model", err)
		TelemetryService.instance.captureException(err, { context: "getKilocodeDefaultModel" })
		return { defaultModel: openRouterDefaultModelId, defaultFreeModel: undefined }
	}
}

export async function getKilocodeDefaultModel(
	kilocodeToken?: KilocodeToken,
	organizationId?: OrganizationId,
): Promise<Defaults> {
	const key = JSON.stringify({
		kilocodeToken,
		organizationId,
	})
	let defaultModelPromise = cache.get(key)
	if (!defaultModelPromise) {
		defaultModelPromise = fetchKilocodeDefaultModel(kilocodeToken, organizationId)
		cache.set(key, defaultModelPromise)
	}
	return await defaultModelPromise
}
