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
