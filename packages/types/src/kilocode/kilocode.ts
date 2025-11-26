import { z } from "zod"

declare global {
	interface Window {
		KILOCODE_BACKEND_BASE_URL: string | undefined
	}
}

export const ghostServiceSettingsSchema = z
	.object({
		enableAutoTrigger: z.boolean().optional(),
		enableQuickInlineTaskKeybinding: z.boolean().optional(),
		enableSmartInlineTaskKeybinding: z.boolean().optional(),
		useNewAutocomplete: z.boolean().optional(),
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

export const fastApplyApiProviderSchema = z.enum(["current", "morph", "kilocode", "openrouter"])

export type FastApplyApiProvider = z.infer<typeof fastApplyApiProviderSchema>

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

	const { protocol, host } = new URL(baseUrl)
	Object.assign(target, { protocol, host })

	return target.toString()
}

function getGlobalKilocodeBackendUrl(): string {
	return (
		(typeof window !== "undefined" ? window.KILOCODE_BACKEND_BASE_URL : undefined) ||
		process.env.KILOCODE_BACKEND_BASE_URL ||
		DEFAULT_KILOCODE_BACKEND_URL
	)
}

/**
 * Gets the app/web URL for the current environment.
 * In development: http://localhost:3000
 * In production: https://kilocode.ai
 */
export function getAppUrl(path: string = ""): string {
	return new URL(path, getGlobalKilocodeBackendUrl()).toString()
}

/**
 * Gets the extension config URL, which uses a legacy subdomain structure.
 * In development: http://localhost:3000/extension-config.json
 * In production: https://api.kilocode.ai/extension-config.json
 */
export function getExtensionConfigUrl(): string {
	try {
		const backend = getGlobalKilocodeBackendUrl()
		if (backend.includes("localhost")) {
			return getAppUrl("/extension-config.json")
		} else {
			return "https://api.kilocode.ai/extension-config.json"
		}
	} catch (error) {
		console.warn("Failed to build extension config URL:", error)
		return "https://api.kilocode.ai/extension-config.json"
	}
}
