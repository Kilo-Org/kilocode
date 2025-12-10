import axios from "axios"
import { KiloUser, EMPTY_KILO_USER, getKiloUrlFromToken, ProviderSettingsWithId } from "@roo-code/types"
import type { ClineProvider } from "../webview/ClineProvider"

/**
 * Result of resolving a Kilo user profile with token
 */
interface KiloUserProfile {
	token: string | undefined
	profileName: string | undefined
	source: "active-profile" | "other-profile" | "none"
	profile: ProviderSettingsWithId | undefined
}

/**
 * Resolves the Kilo user profile based on priority rules:
 * 1. Active profile if it's a kilocode provider with a valid token
 * 2. First kilocode provider found in profiles list
 * 3. Fallback to none
 *
 * This is the base resolution function used by other resolvers.
 */
export async function resolveKiloUserProfile(provider: ClineProvider): Promise<KiloUserProfile> {
	const { apiConfiguration, currentApiConfigName } = await provider.getState()

	// Priority 1: Active profile if it's a kilocode provider with a valid token
	if (apiConfiguration?.apiProvider === "kilocode" && apiConfiguration?.kilocodeToken) {
		return {
			token: apiConfiguration.kilocodeToken,
			profileName: currentApiConfigName,
			source: "active-profile",
			profile: apiConfiguration,
		}
	}

	// Priority 2: First kilocode provider found in profiles list
	const profiles = await provider.providerSettingsManager.listConfig()

	for (const profile of profiles) {
		// Skip if not a kilocode provider
		if (profile.apiProvider !== "kilocode") {
			continue
		}

		try {
			const fullProfile = await provider.providerSettingsManager.getProfile({ name: profile.name })
			if (fullProfile.apiProvider === "kilocode" && fullProfile.kilocodeToken) {
				return {
					token: fullProfile.kilocodeToken,
					profileName: profile.name,
					source: "other-profile",
					profile: fullProfile,
				}
			}
		} catch {
			continue
		}
	}

	// Fallback: No kilocode provider found
	return {
		token: undefined,
		profileName: undefined,
		source: "none",
		profile: undefined,
	}
}

/**
 * Resolves just the kilocode token based on priority rules.
 * This is a convenience function that extracts only the token from resolveKiloUserProfile.
 */
export async function resolveKiloUserToken(provider: ClineProvider): Promise<string | undefined> {
	const profile = await resolveKiloUserProfile(provider)
	return profile.token
}

/**
 * Resolves the global Kilo user based on priority rules:
 * 1. Active profile if it's a kilocode provider with a valid token
 * 2. First kilocode provider found in profiles list
 * 3. Fallback to empty/unauthenticated state
 *
 * This function also fetches the user's email for telemetry identity.
 */
export async function resolveKiloUser(provider: ClineProvider): Promise<KiloUser> {
	const profile = await resolveKiloUserProfile(provider)

	if (!profile.token) {
		return EMPTY_KILO_USER
	}

	const email = await fetchKiloUserEmail(profile.token)
	return {
		source: profile.source,
		profileName: profile.profileName,
		email,
		isAuthenticated: email !== undefined,
	}
}

/**
 * Fetches the user's email from the Kilo API using the provided token.
 * Returns undefined if the fetch fails or the user is not authenticated.
 */
async function fetchKiloUserEmail(kilocodeToken: string): Promise<string | undefined> {
	try {
		const url = getKiloUrlFromToken("https://api.kilo.ai/api/profile", kilocodeToken)
		const response = await axios.get<{ user?: { email?: string } }>(url, {
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
			timeout: 5000, // 5 second timeout
		})

		return response.data?.user?.email
	} catch (error) {
		console.warn("[resolveKiloUser] Failed to fetch user email:", error)
		return undefined
	}
}
