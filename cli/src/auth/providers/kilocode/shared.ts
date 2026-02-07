import { getApiUrl } from "@roo-code/types"
import { openRouterDefaultModelId } from "@roo-code/types"
import { z } from "zod"
import { select } from "@inquirer/prompts"
import { logs } from "../../../services/logs.js"
import type { KilocodeOrganization, KilocodeProfileData } from "../../types.js"
import { withRawMode } from "../../utils/terminal.js"

const API_TIMEOUT_MS = 5000

const defaultsSchema = z.object({
	defaultModel: z.string().nullish(),
})

const DEFAULT_HEADERS = {
	"Content-Type": "application/json",
}

export const INVALID_TOKEN_ERROR = "INVALID_TOKEN"

/**
 * Fetch with timeout wrapper
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController()
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		})
		clearTimeout(timeoutId)
		return response
	} catch (error) {
		clearTimeout(timeoutId)
		throw error
	}
}

/**
 * Fetch user profile data from Kilocode API
 * @param kilocodeToken - The Kilocode API token
 * @returns Profile data including user info and organizations
 * @throws Error with "INVALID_TOKEN" message if token is invalid (401/403)
 * @throws Error with details for other failures
 */
export async function getKilocodeProfile(kilocodeToken: string): Promise<KilocodeProfileData> {
	try {
		const url = getApiUrl("/api/profile")

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

/**
 * Fetch the default model from Kilocode API
 * @param kilocodeToken - The Kilocode API token
 * @param organizationId - Optional organization ID for org-specific defaults
 * @returns The default model ID, or falls back to openRouterDefaultModelId on error
 */
export async function getKilocodeDefaultModel(kilocodeToken: string, organizationId?: string): Promise<string> {
	try {
		const path = organizationId ? `/api/organizations/${organizationId}/defaults` : `/api/defaults`
		const url = getApiUrl(path)

		const headers: Record<string, string> = {
			...DEFAULT_HEADERS,
			Authorization: `Bearer ${kilocodeToken}`,
		}

		const response = await fetchWithTimeout(url, { headers }, API_TIMEOUT_MS)

		if (!response.ok) {
			throw new Error(`Fetching default model from ${url} failed: ${response.status}`)
		}

		const defaultModel = (await defaultsSchema.parseAsync(await response.json())).defaultModel

		if (!defaultModel) {
			throw new Error(`Default model from ${url} was empty`)
		}

		logs.info(`Fetched default model from Kilocode API: ${defaultModel}`, "getKilocodeDefaultModel")
		return defaultModel
	} catch (err) {
		logs.error("Failed to get default model from Kilocode API, using fallback", "getKilocodeDefaultModel", {
			error: err,
		})
		return openRouterDefaultModelId
	}
}

/**
 * Prompt user to select an organization or personal account
 * @param organizations List of organizations the user belongs to
 * @returns Organization ID or undefined for personal account
 */
export async function promptOrganizationSelection(organizations: KilocodeOrganization[]): Promise<string | undefined> {
	if (!organizations || organizations.length === 0) {
		return undefined
	}

	// Build choices for account selection
	const accountChoices = [
		{ name: "Personal Account", value: "personal" },
		...organizations.map((org) => ({
			name: `${org.name} (${org.role})`,
			value: org.id,
		})),
	]

	// Use withRawMode to ensure arrow key navigation works in list prompts
	const accountType = await withRawMode(() =>
		select({
			message: "Select account type:",
			choices: accountChoices,
			loop: false,
		}),
	)

	// Return organization ID if not personal
	return accountType !== "personal" ? accountType : undefined
}
