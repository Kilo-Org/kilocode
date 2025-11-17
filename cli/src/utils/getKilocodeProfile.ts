import { getKiloUrlFromToken } from "@roo-code/types"

/**
 * Organization data from Kilocode API
 */
export interface KilocodeOrganization {
	id: string
	name: string
	role: string
}

/**
 * Profile data structure from Kilocode API
 */
export interface KilocodeProfileData {
	user?: {
		name?: string
		email?: string
		image?: string
	}
	organizations?: KilocodeOrganization[]
}

export const INVALID_TOKEN_ERROR = "INVALID_TOKEN"

/**
 * Fetch user profile data from Kilocode API
 * @param kilocodeToken - The Kilocode API token
 * @returns Profile data including user info and organizations
 * @throws Error with "INVALID_TOKEN" message if token is invalid (401/403)
 * @throws Error with details for other failures
 */
export async function getKilocodeProfile(kilocodeToken: string): Promise<KilocodeProfileData> {
	try {
		const url = getKiloUrlFromToken("https://api.kilocode.ai/api/profile", kilocodeToken)

		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			},
		})

		if (!response.ok) {
			// Invalid token - authentication failed
			if (response.status === 401 || response.status === 403) {
				throw new Error(INVALID_TOKEN_ERROR)
			}
			throw new Error(`Failed to fetch profile: ${response.status}`)
		}

		const data = await response.json()
		return data as KilocodeProfileData
	} catch (error) {
		// Re-throw our custom errors
		if (error instanceof Error && error.message === INVALID_TOKEN_ERROR) {
			throw error
		}
		// Wrap other errors
		throw new Error(`Failed to fetch profile: ${error instanceof Error ? error.message : String(error)}`)
	}
}
