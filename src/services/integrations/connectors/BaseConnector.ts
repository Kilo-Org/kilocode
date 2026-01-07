// kilocode_change - new file
import type {
	ExternalContextSource,
	ExternalDiscussion,
	ExternalComment,
	SyncResult,
	IntegrationConfig,
} from "../types"
import { RateLimiter } from "../rate-limiter"
import { EncryptionService } from "../encryption"

/**
 * Base interface for all external service connectors
 */
export abstract class BaseConnector {
	protected config: IntegrationConfig
	protected rateLimiter: RateLimiter
	protected isInitialized = false

	constructor(config: IntegrationConfig, rateLimiter: RateLimiter) {
		this.config = config
		this.rateLimiter = rateLimiter
	}

	/**
	 * Initialize the connector (set up authentication, etc.)
	 */
	abstract initialize(): Promise<void>

	/**
	 * Test the connection to the external service
	 */
	abstract testConnection(): Promise<boolean>

	/**
	 * Fetch discussions/issues from the external service
	 * Supports incremental sync via since parameter
	 */
	abstract fetchDiscussions(since?: number): Promise<ExternalContextSource[]>

	/**
	 * Fetch comments for a specific discussion
	 */
	abstract fetchComments(discussionId: string): Promise<ExternalComment[]>

	/**
	 * Perform a full sync of data from the external service
	 */
	async sync(since?: number): Promise<SyncResult> {
		const startTime = Date.now()

		try {
			if (!this.isInitialized) {
				await this.initialize()
			}

			// Update status to syncing
			this.config.status = "syncing"

			// Fetch discussions
			const discussions = await this.fetchDiscussions(since)

			// Fetch comments for each discussion
			const discussionsWithComments: ExternalDiscussion[] = []
			for (const discussion of discussions) {
				try {
					await this.rateLimiter.consume()
					const comments = await this.fetchComments(discussion.id)
					discussionsWithComments.push({
						sourceId: discussion.id,
						sourceType: discussion.type,
						comments,
						relatedFiles: [],
						relatedSymbols: [],
						relevanceScore: 0,
					})
				} catch (error) {
					console.error(`Failed to fetch comments for ${discussion.id}:`, error)
				}
			}

			// Store in database
			await this.storeDiscussions(discussions, discussionsWithComments)

			// Update sync timestamp
			this.config.syncConfig.lastSync = Date.now()
			this.config.status = "connected"

			return {
				sourceType: this.config.type,
				success: true,
				itemsSynced: discussions.length,
				itemsFailed: 0,
				itemsSkipped: 0,
				duration: Date.now() - startTime,
				lastSyncTimestamp: Date.now(),
			}
		} catch (error) {
			this.config.status = "error"
			return {
				sourceType: this.config.type,
				success: false,
				itemsSynced: 0,
				itemsFailed: 0,
				itemsSkipped: 0,
				duration: Date.now() - startTime,
				error: error instanceof Error ? error.message : String(error),
				lastSyncTimestamp: Date.now(),
			}
		}
	}

	/**
	 * Store discussions in the database
	 * This should be implemented by the database manager
	 */
	protected abstract storeDiscussions(
		sources: ExternalContextSource[],
		discussions: ExternalDiscussion[],
	): Promise<void>

	/**
	 * Encrypt sensitive content before storage
	 */
	protected encryptContent(content: string, isSensitive: boolean): string {
		if (!isSensitive) {
			return content
		}
		return EncryptionService.encrypt(content)
	}

	/**
	 * Decrypt sensitive content when needed
	 */
	protected decryptContent(content: string, isEncrypted: boolean): string {
		if (!isEncrypted) {
			return content
		}
		return EncryptionService.decrypt(content)
	}

	/**
	 * Update the connector configuration
	 */
	updateConfig(config: Partial<IntegrationConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Get current configuration
	 */
	getConfig(): IntegrationConfig {
		return { ...this.config }
	}
}
