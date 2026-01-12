// kilocode_change - new file
import crypto from "crypto"
import { getKiloUrlFromToken } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"
import { fetchWithRetries } from "../../shared/http"
import { getCurrentBranch } from "../code-index/managed/git-utils"
import { getProjectId } from "../../utils/kilo-config-file"
import { getGitRepositoryInfo } from "../../utils/git"
import {
	type ContributionPayload,
	type LineChange,
	type TokenProvisionResponse,
	TokenProvisionResponse as TokenProvisionResponseSchema,
	type TrackContributionParams,
} from "./contribution-tracking-types"

/**
 * Service for tracking AI contributions to the attributions worker
 *
 * This service handles:
 * - Short-lived JWT token management with caching
 * - Line-level change tracking with SHA-1 hashing
 * - Unified diff parsing
 * - Fire-and-forget API calls to the attributions worker
 */
export class ContributionTrackingService {
	private static instance: ContributionTrackingService
	private cachedToken: TokenProvisionResponse | null = null
	private tokenFetchPromise: Promise<TokenProvisionResponse> | null = null

	// AI Attribution service URL
	private static readonly CONTRIBUTION_SERVICE_URL = "https://ai-attribution.kiloapps.io/attributions/track"

	// Refresh token 1 minute before expiry
	private static readonly TOKEN_REFRESH_BUFFER_MS = 60 * 1000

	private constructor() {}

	/**
	 * Get the singleton instance
	 */
	static getInstance(): ContributionTrackingService {
		if (!ContributionTrackingService.instance) {
			ContributionTrackingService.instance = new ContributionTrackingService()
		}
		return ContributionTrackingService.instance
	}

	/**
	 * Clear cached token (useful for testing and logout scenarios)
	 */
	clearCachedToken(): void {
		this.cachedToken = null
		this.tokenFetchPromise = null
	}

	/**
	 * Check if the cached token is still valid
	 * Returns false if token doesn't exist or is expired/about to expire
	 */
	private isTokenValid(organizationId: string): boolean {
		if (!this.cachedToken) {
			return false
		}

		// Token must be for the same organization
		if (this.cachedToken.organizationId !== organizationId) {
			return false
		}

		// Check if token is expired or about to expire (within refresh buffer)
		// Derive the numeric timestamp from the ISO 8601 string at comparison time
		const now = Date.now()
		const expiresAtMs = new Date(this.cachedToken.expiresAt).getTime()
		const expiresWithBuffer = expiresAtMs - ContributionTrackingService.TOKEN_REFRESH_BUFFER_MS

		return now < expiresWithBuffer
	}

	/**
	 * Fetch a new short-lived token from the Kilo backend
	 * @param organizationId - The organization ID to get a token for
	 * @param kilocodeToken - The main Kilocode authentication token
	 * @returns The token provision response
	 */
	private async fetchToken(organizationId: string, kilocodeToken: string): Promise<TokenProvisionResponse> {
		try {
			const url = getKiloUrlFromToken(
				`https://api.kilo.ai/api/organizations/${organizationId}/user-tokens`,
				kilocodeToken,
			)

			const response = await fetchWithRetries({
				url,
				method: "POST",
				headers: {
					Authorization: `Bearer ${kilocodeToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}), // Empty body as per spec
			})

			if (!response.ok) {
				throw new Error(`Failed to fetch token: ${response.statusText}`)
			}

			// Store the canonical response directly without transformation
			this.cachedToken = TokenProvisionResponseSchema.parse(await response.json())

			return this.cachedToken
		} catch (error) {
			console.error("[ContributionTracking] Failed to fetch token:", error)
			throw error
		}
	}

	/**
	 * Get a valid token, fetching a new one if necessary
	 * Handles caching and concurrent requests
	 */
	private async getValidToken(organizationId: string, kilocodeToken: string): Promise<TokenProvisionResponse> {
		// If we have a valid cached token, return it
		if (this.isTokenValid(organizationId)) {
			return this.cachedToken!
		}

		// If a fetch is already in progress, wait for it
		if (this.tokenFetchPromise) {
			return this.tokenFetchPromise
		}

		// Start a new fetch
		this.tokenFetchPromise = this.fetchToken(organizationId, kilocodeToken)

		try {
			const token = await this.tokenFetchPromise
			return token
		} finally {
			// Clear the promise so future calls can fetch again if needed
			this.tokenFetchPromise = null
		}
	}

	/**
	 * Compute SHA-1 hash of line content
	 * Normalizes line endings for consistent hashing
	 */
	private computeLineHash(lineContent: string): string {
		// Remove line endings for consistent hashing across platforms
		const normalized = lineContent.replace(/\r?\n$/, "")
		return crypto.createHash("sha1").update(normalized, "utf8").digest("hex")
	}

	/**
	 * Extract line changes from unified diff
	 * Returns arrays of added and removed lines with their hashes
	 *
	 * @param unifiedDiff - The unified diff string
	 * @returns Object containing arrays of added and removed line changes
	 */
	private extractLineChanges(unifiedDiff: string): {
		linesAdded: LineChange[]
		linesRemoved: LineChange[]
	} {
		const linesAdded: LineChange[] = []
		const linesRemoved: LineChange[] = []

		const lines = unifiedDiff.split("\n")
		let currentLine = 0

		for (const line of lines) {
			if (line.startsWith("@@")) {
				// Parse hunk header to get line numbers
				// Format: @@ -oldStart,oldCount +newStart,newCount @@
				const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/)
				if (match) {
					currentLine = parseInt(match[2], 10) // New file line number
				}
			} else if (line.startsWith("+") && !line.startsWith("+++")) {
				// Added line (skip +++ file markers)
				const content = line.substring(1)
				linesAdded.push({
					line_number: currentLine++,
					line_hash: this.computeLineHash(content),
				})
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				// Removed line (skip --- file markers)
				const content = line.substring(1)
				linesRemoved.push({
					line_number: currentLine,
					line_hash: this.computeLineHash(content),
				})
			} else if (!line.startsWith("\\")) {
				// Context line (unchanged) - increment line counter
				// Skip lines starting with \ (e.g., "\ No newline at end of file")
				currentLine++
			}
		}

		return { linesAdded, linesRemoved }
	}

	/**
	 * Track a file edit contribution
	 * This is the main public method that should be called when a user accepts or rejects a file edit
	 *
	 * @param params - Parameters for tracking the contribution
	 *
	 * @example
	 * ```typescript
	 * const service = ContributionTrackingService.getInstance()
	 * await service.trackContribution({
	 *   cwd: '/path/to/repo',
	 *   filePath: 'src/file.ts',
	 *   unifiedDiff: '...',
	 *   status: 'accepted',
	 *   taskId: 'task_123',
	 *   organizationId: 'org_456',
	 *   kilocodeToken: 'token_789'
	 * })
	 * ```
	 */
	async trackContribution(params: TrackContributionParams): Promise<void> {
		try {
			// Skip tracking if telemetry is disabled (respects user's privacy preferences)
			if (TelemetryService.hasInstance() && !TelemetryService.instance.isTelemetryEnabled()) {
				return
			}

			// Skip tracking if no organization ID
			if (!params.organizationId) {
				return
			}

			// Get git context (branch, repository URL, and project ID)
			const [branch, gitInfo] = await Promise.all([
				getCurrentBranch(params.cwd),
				getGitRepositoryInfo(params.cwd),
			])

			// Get project ID with git repository URL as fallback
			const projectId = await getProjectId(params.cwd, gitInfo.repositoryUrl)

			if (!projectId) {
				return
			}

			// Extract line changes from the unified diff
			const { linesAdded, linesRemoved } = this.extractLineChanges(params.unifiedDiff)

			// Get a valid token for the attributions service
			const cachedToken = await this.getValidToken(params.organizationId, params.kilocodeToken)

			// Build the payload with snake_case field names
			const payload: ContributionPayload = {
				project_id: projectId || "unknown",
				branch: branch || "unknown",
				file_path: params.filePath,
				lines_added: linesAdded,
				lines_removed: linesRemoved,
				status: params.status,
				task_id: params.taskId,
			}

			// Send to the attributions worker
			// Fire-and-forget: don't block user workflow if this fails
			await this.sendToAttributionsWorker(payload, cachedToken.token)
		} catch (error) {
			// Log error but don't throw - tracking should never block user workflow
			console.error("[ContributionTracking] Failed to track contribution:", error)
		}
	}

	/**
	 * Send contribution data to the attributions worker
	 * @param payload - The contribution payload
	 * @param token - The short-lived JWT token
	 */
	private async sendToAttributionsWorker(payload: ContributionPayload, token: string): Promise<void> {
		try {
			const response = await fetchWithRetries({
				url: ContributionTrackingService.CONTRIBUTION_SERVICE_URL,
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			})

			if (!response.ok) {
				throw new Error(`Failed to track contribution: ${response.statusText}`)
			}
		} catch (error) {
			console.error("[ContributionTracking] Failed to send to attributions worker:", error)
			throw error
		}
	}
}

/**
 * Track a contribution (fire-and-forget)
 *
 * This is a convenience function that handles getting the service instance
 * and catching/logging any errors. Callsites can simply fire and forget
 * without needing to handle errors themselves.
 *
 * @param params - Parameters for tracking the contribution
 *
 * @example
 * ```typescript
 * // Simple fire-and-forget usage
 * trackContribution({
 *   cwd: task.cwd,
 *   filePath: relPath,
 *   unifiedDiff: unifiedPatch,
 *   status: didApprove ? "accepted" : "rejected",
 *   taskId: task.taskId,
 *   organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
 *   kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
 * })
 * ```
 */
export function trackContribution(params: TrackContributionParams): void {
	const service = ContributionTrackingService.getInstance()
	service.trackContribution(params).catch((error: unknown) => {
		// Errors are already logged in the service, this just prevents unhandled rejection
		console.debug("[trackContribution] Contribution tracking failed:", error)
	})
}
