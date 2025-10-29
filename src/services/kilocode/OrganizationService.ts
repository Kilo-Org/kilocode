import axios from "axios"
import { getKiloUrlFromToken } from "@roo-code/types"
import { X_KILOCODE_ORGANIZATIONID, X_KILOCODE_TESTER } from "../../shared/kilocode/headers"
import { KiloOrganization, KiloOrganizationSchema } from "../../shared/kilocode/organization"
import { logger } from "../../utils/logging"

/**
 * Service for fetching and managing Kilo Code organization settings
 */
export class OrganizationService {
	/**
	 * Fetches organization details from the Kilo Code API
	 * @param kilocodeToken - The authentication token
	 * @param organizationId - The organization ID
	 * @param kilocodeTesterWarningsDisabledUntil - Timestamp for suppressing tester warnings
	 * @returns The organization object with settings
	 */
	public static async fetchOrganization(
		kilocodeToken: string,
		organizationId: string,
		kilocodeTesterWarningsDisabledUntil?: number,
	): Promise<KiloOrganization | null> {
		try {
			if (!organizationId || !kilocodeToken) {
				logger.warn("[OrganizationService] Missing required parameters for fetching organization")
				return null
			}

			const headers: Record<string, string> = {
				Authorization: `Bearer ${kilocodeToken}`,
				"Content-Type": "application/json",
			}

			headers[X_KILOCODE_ORGANIZATIONID] = organizationId

			// Add X-KILOCODE-TESTER: SUPPRESS header if the setting is enabled
			if (kilocodeTesterWarningsDisabledUntil && kilocodeTesterWarningsDisabledUntil > Date.now()) {
				headers[X_KILOCODE_TESTER] = "SUPPRESS"
			}

			const url = getKiloUrlFromToken(
				`https://api.kilocode.ai/api/organizations/${organizationId}`,
				kilocodeToken,
			)

			const response = await axios.get(url, { headers })

			// Validate the response against the schema
			const validationResult = KiloOrganizationSchema.safeParse(response.data)

			if (!validationResult.success) {
				logger.error("[OrganizationService] Invalid organization response format", {
					organizationId,
					errors: validationResult.error.errors,
				})
				return null
			}

			logger.info("[OrganizationService] Successfully fetched organization", {
				organizationId,
				codeIndexingEnabled: validationResult.data.settings.code_indexing_enabled,
			})

			return validationResult.data
		} catch (error) {
			// Log error but don't throw - gracefully degrade
			logger.error("[OrganizationService] Failed to fetch organization", {
				organizationId,
				error: error instanceof Error ? error.message : String(error),
			})
			return null
		}
	}

	/**
	 * Checks if code indexing is enabled for an organization
	 * @param organization - The organization object
	 * @returns true if code indexing is enabled (defaults to true if not specified)
	 */
	public static isCodeIndexingEnabled(organization: KiloOrganization | null): boolean {
		// Default to true if organization is null or setting is not specified
		return organization?.settings?.code_indexing_enabled ?? true
	}
}
