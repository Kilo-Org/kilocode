/**
 * Profile API command - Exposes Kilocode profile data as JSON for programmatic use
 *
 * Usage:
 *   kilocode profile
 *
 * Output format:
 *   {
 *     "authenticated": true,
 *     "provider": "kilocode",
 *     "user": {
 *       "name": "Jane Doe",
 *       "email": "jane@example.com"
 *     },
 *     "organization": {
 *       "id": "org_123",
 *       "name": "Example Org",
 *       "role": "admin"
 *     }
 *   }
 */

import { createStore } from "jotai"
import { loadConfigAtom } from "../state/atoms/config.js"
import { logs } from "../services/logs.js"
import { getKilocodeProfile, INVALID_TOKEN_ERROR } from "../auth/providers/kilocode/shared.js"
import type { CLIConfig, ProviderConfig } from "../config/types.js"
import type { KilocodeProfileData } from "../auth/types.js"

/**
 * Output format for the profile API command
 */
export interface ProfileApiOutput {
	authenticated: boolean
	provider: string | null
	user?: {
		name: string | null
		email: string | null
	}
	organization?: {
		id: string
		name: string
		role: string
	}
}

/**
 * Error output format
 */
export interface ProfileApiError {
	error: string
	code: string
}

function isNetworkErrorMessage(message: string): boolean {
	const lowerMessage = message.toLowerCase()
	return (
		lowerMessage.includes("fetch failed") ||
		lowerMessage.includes("network") ||
		lowerMessage.includes("timeout") ||
		lowerMessage.includes("timed out") ||
		lowerMessage.includes("abort") ||
		lowerMessage.includes("econn") ||
		lowerMessage.includes("enotfound") ||
		lowerMessage.includes("eai_again")
	)
}

export function classifyProfileFetchError(error: Error): { code: string; message: string } {
	if (error.message === INVALID_TOKEN_ERROR) {
		return {
			code: "NOT_AUTHENTICATED",
			message: "Not authenticated. Run 'kilocode auth' to configure.",
		}
	}

	// Check error.code for Node.js network errors (ETIMEDOUT, ECONNREFUSED, etc.)
	const errorCode = (error as Error & { code?: string }).code
	if (typeof errorCode === "string") {
		const networkErrorCodes = ["ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ABORT_ERR"]
		if (networkErrorCodes.includes(errorCode)) {
			return {
				code: "NETWORK_ERROR",
				message: "Network error while fetching profile. Check your network connection and try again.",
			}
		}
	}

	const prefix = "Failed to fetch profile:"
	if (error.message.startsWith(prefix)) {
		const detail = error.message.slice(prefix.length).trim()

		if (isNetworkErrorMessage(detail)) {
			return {
				code: "NETWORK_ERROR",
				message: "Network error while fetching profile. Check your network connection and try again.",
			}
		}

		if (/\b\d{3}\b/.test(detail)) {
			return {
				code: "API_ERROR",
				message: error.message,
			}
		}
	}

	if (isNetworkErrorMessage(error.message)) {
		return {
			code: "NETWORK_ERROR",
			message: "Network error while fetching profile. Check your network connection and try again.",
		}
	}

	return {
		code: "API_ERROR",
		message: error.message,
	}
}

export function buildProfileOutput(profile: KilocodeProfileData, provider: ProviderConfig): ProfileApiOutput {
	const output: ProfileApiOutput = {
		authenticated: true,
		provider: provider.provider,
	}

	if (profile.user) {
		output.user = {
			name: profile.user.name ?? null,
			email: profile.user.email ?? null,
		}
	}

	if (provider.kilocodeOrganizationId && profile.organizations) {
		const organization = profile.organizations.find((org) => org.id === provider.kilocodeOrganizationId)
		if (organization) {
			output.organization = {
				id: organization.id,
				name: organization.name,
				role: organization.role,
			}
		}
	}

	return output
}

/**
 * Output result as JSON to stdout
 */
function outputJson(data: ProfileApiOutput | ProfileApiError): void {
	console.log(JSON.stringify(data, null, 2))
}

/**
 * Output error and exit
 */
function outputError(message: string, code: string): never {
	outputJson({ error: message, code })
	process.exit(1)
}

function getCurrentProvider(config: CLIConfig): ProviderConfig | null {
	return config.providers.find((provider) => provider.id === config.provider) || null
}

/**
 * Main profile API command handler
 */
export async function profileApiCommand(): Promise<void> {
	try {
		logs.info("Starting profile API command", "ProfileAPI")

		const store = createStore()
		const config = await store.set(loadConfigAtom)

		const currentProvider = getCurrentProvider(config)
		if (!currentProvider) {
			outputError(`Provider "${config.provider}" not found. Check your CLI configuration.`, "PROVIDER_NOT_FOUND")
		}

		if (currentProvider.provider !== "kilocode") {
			outputError("Profile command requires Kilocode provider. Please switch providers.", "NOT_KILOCODE_PROVIDER")
		}

		const kilocodeToken = typeof currentProvider.kilocodeToken === "string" ? currentProvider.kilocodeToken : null
		if (!kilocodeToken) {
			outputError("Not authenticated. Run 'kilocode auth' to configure.", "NOT_AUTHENTICATED")
		}

		let profileData: KilocodeProfileData
		try {
			profileData = await getKilocodeProfile(kilocodeToken)
		} catch (error) {
			const errorInfo = classifyProfileFetchError(error as Error)
			outputError(errorInfo.message, errorInfo.code)
		}

		const output = buildProfileOutput(profileData, currentProvider)
		outputJson(output)

		logs.info("Profile API command completed successfully", "ProfileAPI")
	} catch (error) {
		logs.error("Profile API command failed", "ProfileAPI", { error })
		outputError(error instanceof Error ? error.message : "An unexpected error occurred", "INTERNAL_ERROR")
	}

	process.exit(0)
}
