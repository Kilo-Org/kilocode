import { z } from "zod"
import { ProviderSettings, ProviderSettingsEntry } from "../provider-settings.js"

export const ghostServiceSettingsSchema = z
	.object({
		enableAutoTrigger: z.boolean().optional(),
		autoTriggerDelay: z.number().min(1).max(5000).default(3000).optional(),
		enableQuickInlineTaskKeybinding: z.boolean().optional(),
		enableSmartInlineTaskKeybinding: z.boolean().optional(),
		showGutterAnimation: z.boolean().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
	})
	.optional()

export type GhostServiceSettings = z.infer<typeof ghostServiceSettingsSchema>

export const commitRangeSchema = z.object({
	from: z.string(),
	fromTimeStamp: z.number().optional(),
	to: z.string(),
})

export type CommitRange = z.infer<typeof commitRangeSchema>

export const kiloCodeMetaDataSchema = z.object({
	commitRange: commitRangeSchema.optional(),
})

export type KiloCodeMetaData = z.infer<typeof kiloCodeMetaDataSchema>

export const fastApplyModelSchema = z.enum([
	"auto",
	"morph/morph-v3-fast",
	"morph/morph-v3-large",
	"relace/relace-apply-3",
])

export type FastApplyModel = z.infer<typeof fastApplyModelSchema>

export const DEFAULT_KILOCODE_BACKEND_URL = "https://kilocode.ai"

export function getKiloBaseUriFromToken(kilocodeToken?: string) {
	if (kilocodeToken) {
		try {
			const payload_string = kilocodeToken.split(".")[1]
			if (!payload_string) return "https://api.kilocode.ai"

			const payload_json =
				typeof atob !== "undefined" ? atob(payload_string) : Buffer.from(payload_string, "base64").toString()
			const payload = JSON.parse(payload_json)
			//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
			if (payload.env === "development") return "http://localhost:3000"
		} catch (_error) {
			console.warn("Failed to get base URL from Kilo Code token")
		}
	}
	return "https://api.kilocode.ai"
}

/**
 * Helper function that combines token-based base URL resolution with URL construction.
 * Takes a token and a full URL, uses the token to get the appropriate base URL,
 * then constructs the final URL by replacing the domain in the target URL.
 *
 * @param targetUrl The target URL to transform
 * @param kilocodeToken The KiloCode authentication token
 * @returns Fully constructed KiloCode URL with proper backend mapping based on token
 */
export function getKiloUrlFromToken(targetUrl: string, kilocodeToken?: string): string {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)
	const target = new URL(targetUrl)

	const { protocol, hostname, port } = new URL(baseUrl)
	Object.assign(target, { protocol, hostname, port })
	return target.toString()
}

function getGlobalKilocodeBackendUrl(): string {
	return (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(typeof window !== "undefined" ? (window as any).KILOCODE_BACKEND_BASE_URL : undefined) ||
		process.env.KILOCODE_BACKEND_BASE_URL ||
		DEFAULT_KILOCODE_BACKEND_URL
	)
}

function removeTrailingSlash(url: string, pathname: string): string {
	return url.endsWith("/") && (pathname === "/" || pathname === "") ? url.slice(0, -1) : url
}

function ensureLeadingSlash(path: string): string {
	return path.startsWith("/") ? path : `/${path}`
}

/**
 * Gets the API base URL for the current environment.
 * In development: http://localhost:3000/api
 * In production: uses /api path structure
 */
export function getApiUrl(path: string = ""): string {
	try {
		const backend = new URL(getGlobalKilocodeBackendUrl())
		const result = new URL(backend)
		result.pathname = `/api${path ? ensureLeadingSlash(path) : ""}`

		return removeTrailingSlash(result.toString(), result.pathname)
	} catch (error) {
		console.warn("Failed to build API URL:", path, error)
		return `https://kilocode.ai/api${path ? ensureLeadingSlash(path) : ""}`
	}
}

/**
 * Gets the app/web URL for the current environment.
 * In development: http://localhost:3000
 * In production: https://kilocode.ai
 */
export function getAppUrl(path: string = ""): string {
	try {
		const backend = new URL(getGlobalKilocodeBackendUrl())
		const result = new URL(backend)
		result.pathname = path ? ensureLeadingSlash(path) : ""

		return removeTrailingSlash(result.toString(), result.pathname)
	} catch (error) {
		console.warn("Failed to build app URL:", path, error)
		return `https://kilocode.ai${path ? ensureLeadingSlash(path) : ""}`
	}
}

/**
 * Check if the Kilocode account has a positive balance
 * @param kilocodeToken - The Kilocode JWT token
 * @param kilocodeOrganizationId - Optional organization ID to include in headers
 * @returns Promise<boolean> - True if balance > 0, false otherwise
 */
export async function checkKilocodeBalance(kilocodeToken: string, kilocodeOrganizationId?: string): Promise<boolean> {
	try {
		const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

		const headers: Record<string, string> = {
			Authorization: `Bearer ${kilocodeToken}`,
		}

		if (kilocodeOrganizationId) {
			headers["X-KiloCode-OrganizationId"] = kilocodeOrganizationId
		}

		const response = await fetch(`${baseUrl}/api/profile/balance`, {
			headers,
		})

		if (!response.ok) {
			return false
		}

		const data = await response.json()
		const balance = data.balance ?? 0
		return balance > 0
	} catch (error) {
		console.error("Error checking kilocode balance:", error)
		return false
	}
}

export const AUTOCOMPLETE_PROVIDER_MODELS = {
	mistral: "codestral-latest",
	kilocode: "mistralai/codestral-2508",
	openrouter: "mistralai/codestral-2508",
	bedrock: "mistral.codestral-2508-v1:0",
} as const
export type AutocompleteProviderKey = keyof typeof AUTOCOMPLETE_PROVIDER_MODELS

interface ProviderSettingsManager {
	listConfig(): Promise<ProviderSettingsEntry[]>
	getProfile(params: { id: string }): Promise<ProviderSettings>
}

export type ProviderUsabilityChecker = (
	provider: AutocompleteProviderKey,
	providerSettingsManager: ProviderSettingsManager,
) => Promise<boolean>

export const defaultProviderUsabilityChecker: ProviderUsabilityChecker = async (provider, providerSettingsManager) => {
	if (provider === "kilocode") {
		try {
			const profiles = await providerSettingsManager.listConfig()
			const kilocodeProfile = profiles.find((p) => p.apiProvider === "kilocode")

			if (!kilocodeProfile) {
				return false
			}

			const profile = await providerSettingsManager.getProfile({ id: kilocodeProfile.id })
			const kilocodeToken = profile.kilocodeToken
			const kilocodeOrgId = profile.kilocodeOrganizationId

			if (!kilocodeToken) {
				return false
			}

			return await checkKilocodeBalance(kilocodeToken, kilocodeOrgId)
		} catch (error) {
			console.error("Error checking kilocode balance:", error)
			return false
		}
	}

	// For all other providers, assume they are usable
	return true
}
