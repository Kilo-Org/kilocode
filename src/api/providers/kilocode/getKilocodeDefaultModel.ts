import { openRouterDefaultModelId, type ProviderSettings } from "@roo-code/types"
import { getKiloUrlFromToken } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { z } from "zod"
import { DEFAULT_HEADERS } from "../constants"

type KilocodeToken = string

type OrganizationId = string

const cache = new Map<string, Promise<string>>()

const defaultsSchema = z.object({
	defaultModel: z.string().nullish(),
})

async function fetchKilocodeDefaultModel(
	kilocodeToken: KilocodeToken,
	organizationId?: OrganizationId,
	providerSettings?: ProviderSettings,
): Promise<string> {
	try {
		const path = organizationId ? `/organizations/${organizationId}/defaults` : `/defaults`
		const url = getKiloUrlFromToken(`https://api.kilo.ai/api${path}`, kilocodeToken)

		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			Authorization: `Bearer ${kilocodeToken}`,
		}

		// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
		if (
			providerSettings?.kilocodeTesterWarningsDisabledUntil &&
			providerSettings.kilocodeTesterWarningsDisabledUntil > Date.now()
		) {
			headers["X-KILOCODE-TESTER"] = "SUPPRESS"
		}

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 5000)
		const response = await fetch(url, { headers, signal: controller.signal })
		clearTimeout(timeout)
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

export async function getKilocodeDefaultModel(
	kilocodeToken?: KilocodeToken,
	organizationId?: OrganizationId,
	providerSettings?: ProviderSettings,
): Promise<string> {
	if (!kilocodeToken) {
		return openRouterDefaultModelId
	}
	const key = JSON.stringify({
		kilocodeToken,
		organizationId,
		testerSuppressed: providerSettings?.kilocodeTesterWarningsDisabledUntil,
	})
	let defaultModelPromise = cache.get(key)
	if (!defaultModelPromise) {
		defaultModelPromise = fetchKilocodeDefaultModel(kilocodeToken, organizationId, providerSettings)
		cache.set(key, defaultModelPromise)
	}
	return await defaultModelPromise
}
