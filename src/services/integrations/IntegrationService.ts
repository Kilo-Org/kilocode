// kilocode_change - new file
import { BaseConnector } from "./connectors/BaseConnector"
import { GitHubConnector } from "./connectors/GitHubConnector"
import { JiraConnector } from "./connectors/JiraConnector"
import { SlackConnector } from "./connectors/SlackConnector"
import { EncryptionService } from "./encryption"
import type {
	IntegrationConfig,
	ExternalContextSource,
	ExternalDiscussion,
	ExternalRelationship,
	SyncResult,
	IntegrationType,
} from "./types"

/**
 * Main integration service that manages all external context connectors
 * Handles syncing, storage, and retrieval of external discussions
 */
export class IntegrationService {
	private connectors: Map<IntegrationType, BaseConnector> = new Map()
	private syncIntervals: Map<IntegrationType, NodeJS.Timeout> = new Map()
	private isInitialized = false

	/**
	 * Initialize the integration service
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		await EncryptionService.initialize()
		this.isInitialized = true
	}

	/**
	 * Register a new integration
	 */
	async registerIntegration(config: IntegrationConfig): Promise<void> {
		if (!this.isInitialized) {
			await this.initialize()
		}

		let connector: BaseConnector

		switch (config.type) {
			case "github":
				connector = new GitHubConnector(config)
				break
			case "jira":
				connector = new JiraConnector(config)
				break
			case "slack":
				connector = new SlackConnector(config)
				break
			default:
				throw new Error(`Unsupported integration type: ${config.type}`)
		}

		// Initialize and test connection
		await connector.initialize()
		const connected = await connector.testConnection()

		if (!connected) {
			throw new Error(`Failed to connect to ${config.type}`)
		}

		this.connectors.set(config.type, connector)

		// Start periodic sync if enabled
		if (config.syncConfig.enabled) {
			this.startPeriodicSync(config.type, config.syncConfig.intervalMinutes)
		}
	}

	/**
	 * Unregister an integration
	 */
	async unregisterIntegration(type: IntegrationType): Promise<void> {
		// Stop periodic sync
		const interval = this.syncIntervals.get(type)
		if (interval) {
			clearInterval(interval)
			this.syncIntervals.delete(type)
		}

		// Remove connector
		this.connectors.delete(type)
	}

	/**
	 * Perform a manual sync for a specific integration
	 */
	async syncIntegration(type: IntegrationType, incremental = true): Promise<SyncResult> {
		const connector = this.connectors.get(type)
		if (!connector) {
			throw new Error(`No connector registered for ${type}`)
		}

		const config = connector.getConfig()
		const since = incremental ? config.syncConfig.lastSync : undefined

		const result = await connector.sync(since)

		// Store results in database
		if (result.success) {
			await this.storeSyncResults(type, result)
		}

		return result
	}

	/**
	 * Sync all registered integrations
	 */
	async syncAll(incremental = true): Promise<SyncResult[]> {
		const results: SyncResult[] = []

		for (const [type] of this.connectors) {
			try {
				const result = await this.syncIntegration(type, incremental)
				results.push(result)
			} catch (error) {
				results.push({
					sourceType: type,
					success: false,
					itemsSynced: 0,
					itemsFailed: 0,
					itemsSkipped: 0,
					duration: 0,
					error: error instanceof Error ? error.message : String(error),
					lastSyncTimestamp: Date.now(),
				})
			}
		}

		return results
	}

	/**
	 * Start periodic sync for an integration
	 */
	private startPeriodicSync(type: IntegrationType, intervalMinutes: number): void {
		const intervalMs = intervalMinutes * 60 * 1000

		const interval = setInterval(async () => {
			try {
				await this.syncIntegration(type, true)
			} catch (error) {
				console.error(`Periodic sync failed for ${type}:`, error)
			}
		}, intervalMs)

		this.syncIntervals.set(type, interval)
	}

	/**
	 * Get external context related to specific files or symbols
	 */
	async getRelatedExternalContext(filePaths?: string[], symbolIds?: string[]): Promise<ExternalDiscussion[]> {
		// This will query the database for related external discussions
		// Implementation will be added when database schema is extended
		return []
	}

	/**
	 * Map external discussions to codebase files and symbols
	 */
	async mapDiscussionsToCodebase(
		discussions: ExternalDiscussion[],
		projectFiles: string[],
		projectSymbols: Array<{ id: string; name: string; file: string }>,
	): Promise<ExternalRelationship[]> {
		const relationships: ExternalRelationship[] = []

		for (const discussion of discussions) {
			// Map to files based on text matching
			const fileMatches = this.matchDiscussionsToFiles(discussion, projectFiles)
			for (const match of fileMatches) {
				relationships.push({
					id: `rel-${discussion.sourceId}-${match.filePath}`,
					sourceId: discussion.sourceId,
					targetType: "file",
					targetId: match.filePath,
					relationshipType: match.type,
					confidence: match.confidence,
					createdAt: Date.now(),
					metadata: {
						matchedText: match.text,
						similarityScore: match.similarity,
					},
				})
			}

			// Map to symbols based on name matching
			const symbolMatches = this.matchDiscussionsToSymbols(discussion, projectSymbols)
			for (const match of symbolMatches) {
				relationships.push({
					id: `rel-${discussion.sourceId}-${match.symbolId}`,
					sourceId: discussion.sourceId,
					targetType: "symbol",
					targetId: match.symbolId,
					relationshipType: match.type,
					confidence: match.confidence,
					createdAt: Date.now(),
					metadata: {
						matchedText: match.text,
						similarityScore: match.similarity,
					},
				})
			}
		}

		return relationships
	}

	/**
	 * Store sync results in the database
	 */
	private async storeSyncResults(type: IntegrationType, result: SyncResult): Promise<void> {
		// This will be implemented when database schema is extended
		console.log(`Storing sync results for ${type}:`, result)
	}

	/**
	 * Match discussions to files based on text content
	 */
	private matchDiscussionsToFiles(
		discussion: ExternalDiscussion,
		files: string[],
	): Array<{
		filePath: string
		type: string
		confidence: number
		text: string
		similarity: number
	}> {
		const matches: Array<{
			filePath: string
			type: string
			confidence: number
			text: string
			similarity: number
		}> = []

		// Combine all comment text
		const discussionText = discussion.comments
			.map((c) => c.content)
			.join(" ")
			.toLowerCase()

		for (const filePath of files) {
			const fileName = filePath.split("/").pop()?.toLowerCase() || ""
			const filePathLower = filePath.toLowerCase()

			// Check for file path mentions
			if (discussionText.includes(filePathLower)) {
				matches.push({
					filePath,
					type: "references",
					confidence: 0.9,
					text: filePath,
					similarity: 0.9,
				})
			}

			// Check for file name mentions
			if (discussionText.includes(fileName)) {
				matches.push({
					filePath,
					type: "references",
					confidence: 0.7,
					text: fileName,
					similarity: 0.7,
				})
			}
		}

		return matches
	}

	/**
	 * Match discussions to symbols based on name matching
	 */
	private matchDiscussionsToSymbols(
		discussion: ExternalDiscussion,
		symbols: Array<{ id: string; name: string; file: string }>,
	): Array<{
		symbolId: string
		type: string
		confidence: number
		text: string
		similarity: number
	}> {
		const matches: Array<{
			symbolId: string
			type: string
			confidence: number
			text: string
			similarity: number
		}> = []

		// Combine all comment text
		const discussionText = discussion.comments
			.map((c) => c.content)
			.join(" ")
			.toLowerCase()

		for (const symbol of symbols) {
			const symbolName = symbol.name.toLowerCase()

			// Check for symbol name mentions
			if (discussionText.includes(symbolName)) {
				matches.push({
					symbolId: symbol.id,
					type: "mentions",
					confidence: 0.8,
					text: symbol.name,
					similarity: 0.8,
				})
			}
		}

		return matches
	}

	/**
	 * Get status of all integrations
	 */
	getIntegrationStatuses(): Map<IntegrationType, IntegrationConfig> {
		const statuses = new Map<IntegrationType, IntegrationConfig>()

		for (const [type, connector] of this.connectors) {
			statuses.set(type, connector.getConfig())
		}

		return statuses
	}

	/**
	 * Cleanup and stop all syncs
	 */
	async dispose(): Promise<void> {
		// Clear all periodic sync intervals
		for (const interval of this.syncIntervals.values()) {
			clearInterval(interval)
		}
		this.syncIntervals.clear()

		// Clear all connectors
		this.connectors.clear()
	}
}
