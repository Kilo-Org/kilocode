// kilocode_change - new file: Shared utility for OpenAI credential retrieval
import type { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"

/**
 * Get OpenAI API key from provider settings
 * Searches for any provider with type "openai", "openai-responses", or "openai-native"
 *
 * Both provider types can access the OpenAI API, but store keys in different fields:
 * - "openai" provider: uses openAiApiKey field
 * - "openai-responses" provider: uses openAiApiKey field
 * - "openai-native" provider: uses openAiNativeApiKey field
 */
export async function getOpenAiApiKey(providerSettingsManager: ProviderSettingsManager): Promise<string | null> {
	try {
		const allProfiles = await providerSettingsManager.listConfig()

		for (const profile of allProfiles) {
			if (
				profile.apiProvider === "openai" ||
				profile.apiProvider === "openai-responses" ||
				profile.apiProvider === "openai-native"
			) {
				const fullProfile = await providerSettingsManager.getProfile({ id: profile.id })

				if (
					(profile.apiProvider === "openai" || profile.apiProvider === "openai-responses") &&
					fullProfile.openAiApiKey
				) {
					return fullProfile.openAiApiKey
				}

				if (profile.apiProvider === "openai-native" && fullProfile.openAiNativeApiKey) {
					return fullProfile.openAiNativeApiKey
				}
			}
		}

		return null
	} catch (error) {
		console.error("[getOpenAiCredentials] Error getting API key:", error)
		return null
	}
}

/**
 * Get OpenAI base URL from provider settings
 * Returns the configured base URL or defaults to OpenAI's official API
 */
export async function getOpenAiBaseUrl(providerSettingsManager: ProviderSettingsManager): Promise<string> {
	try {
		const allProfiles = await providerSettingsManager.listConfig()

		for (const profile of allProfiles) {
			if (
				profile.apiProvider === "openai" ||
				profile.apiProvider === "openai-responses" ||
				profile.apiProvider === "openai-native"
			) {
				const fullProfile = await providerSettingsManager.getProfile({ id: profile.id })

				if (
					(profile.apiProvider === "openai" || profile.apiProvider === "openai-responses") &&
					fullProfile.openAiBaseUrl
				) {
					return fullProfile.openAiBaseUrl
				}

				if (profile.apiProvider === "openai-native" && fullProfile.openAiNativeBaseUrl) {
					return fullProfile.openAiNativeBaseUrl
				}
			}
		}

		return "https://api.openai.com/v1"
	} catch {
		return "https://api.openai.com/v1"
	}
}
