// kilocode_change - new file for BMAD-METHOD knowledge base integration

import type { BmadAgent, BmadModule } from "./types"
import { BmadIntegrationService } from "./BmadIntegrationService"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * Knowledge base entry
 */
export interface KnowledgeEntry {
	id: string
	title: string
	content: string
	tags: string[]
	agentId?: string
	moduleId?: string
	createdAt: Date
	updatedAt: Date
	metadata?: Record<string, any>
}

/**
 * Knowledge base search result
 */
export interface KnowledgeSearchResult {
	entries: KnowledgeEntry[]
	totalCount: number
	query: string
}

/**
 * Knowledge base statistics
 */
export interface KnowledgeBaseStats {
	totalEntries: number
	entriesByAgent: Record<string, number>
	entriesByModule: Record<string, number>
	entriesByTag: Record<string, number>
}

/**
 * Knowledge base configuration
 */
export interface KnowledgeBaseConfig {
	enabled: boolean
	maxEntries: number
	autoSave: boolean
	saveInterval: number
}

/**
 * BMAD knowledge base
 * Manages knowledge base for BMAD agents and workflows
 */
export class BmadKnowledgeBase {
	private integrationService: BmadIntegrationService
	private entries: Map<string, KnowledgeEntry> = new Map()
	private config: KnowledgeBaseConfig
	private isInitialized = false
	private saveTimer?: NodeJS.Timeout

	constructor(integrationService: BmadIntegrationService, config?: Partial<KnowledgeBaseConfig>) {
		this.integrationService = integrationService
		this.config = {
			enabled: true,
			maxEntries: 10000,
			autoSave: true,
			saveInterval: 60000, // 1 minute
			...config,
		}
	}

	/**
	 * Initialize the knowledge base
	 */
	async initialize(): Promise<void> {
		try {
			if (this.isInitialized) {
				logger.warn("[BmadKnowledgeBase] Already initialized")
				return
			}

			// Wait for integration service to be ready
			await this.integrationService.initialize()

			// Load knowledge base from storage
			await this.loadFromStorage()

			// Setup auto-save if enabled
			if (this.config.autoSave) {
				this.setupAutoSave()
			}

			this.isInitialized = true
			logger.info("[BmadKnowledgeBase] Initialized successfully", {
				entryCount: this.entries.size,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadKnowledgeBase] Failed to initialize", { error: errorMessage })
			throw new Error(`Failed to initialize BMAD knowledge base: ${errorMessage}`)
		}
	}

	/**
	 * Add entry to knowledge base
	 */
	async addEntry(entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">): Promise<KnowledgeEntry> {
		try {
			if (!this.isInitialized) {
				throw new Error("Knowledge base not initialized")
			}

			// Check max entries limit
			if (this.entries.size >= this.config.maxEntries) {
				logger.warn("[BmadKnowledgeBase] Max entries reached, removing oldest entry")
				this.removeOldestEntry()
			}

			const newEntry: KnowledgeEntry = {
				...entry,
				id: this.generateEntryId(),
				createdAt: new Date(),
				updatedAt: new Date(),
			}

			this.entries.set(newEntry.id, newEntry)

			logger.info("[BmadKnowledgeBase] Entry added", {
				entryId: newEntry.id,
				title: newEntry.title,
			})

			// Auto-save if enabled
			if (this.config.autoSave) {
				await this.saveToStorage()
			}

			return newEntry
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadKnowledgeBase] Failed to add entry", { error: errorMessage })
			throw error
		}
	}

	/**
	 * Update entry in knowledge base
	 */
	async updateEntry(entryId: string, updates: Partial<KnowledgeEntry>): Promise<KnowledgeEntry | null> {
		try {
			const entry = this.entries.get(entryId)
			if (!entry) {
				logger.warn("[BmadKnowledgeBase] Entry not found", { entryId })
				return null
			}

			const updatedEntry: KnowledgeEntry = {
				...entry,
				...updates,
				id: entryId, // Ensure ID doesn't change
				createdAt: entry.createdAt, // Preserve creation time
				updatedAt: new Date(),
			}

			this.entries.set(entryId, updatedEntry)

			logger.info("[BmadKnowledgeBase] Entry updated", { entryId })

			// Auto-save if enabled
			if (this.config.autoSave) {
				await this.saveToStorage()
			}

			return updatedEntry
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadKnowledgeBase] Failed to update entry", { entryId, error: errorMessage })
			throw error
		}
	}

	/**
	 * Remove entry from knowledge base
	 */
	async removeEntry(entryId: string): Promise<boolean> {
		try {
			const deleted = this.entries.delete(entryId)

			if (deleted) {
				logger.info("[BmadKnowledgeBase] Entry removed", { entryId })

				// Auto-save if enabled
				if (this.config.autoSave) {
					await this.saveToStorage()
				}
			}

			return deleted
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadKnowledgeBase] Failed to remove entry", { entryId, error: errorMessage })
			return false
		}
	}

	/**
	 * Get entry by ID
	 */
	getEntry(entryId: string): KnowledgeEntry | undefined {
		return this.entries.get(entryId)
	}

	/**
	 * Get all entries
	 */
	getAllEntries(): KnowledgeEntry[] {
		return Array.from(this.entries.values())
	}

	/**
	 * Get entries by agent
	 */
	getEntriesByAgent(agentId: string): KnowledgeEntry[] {
		return Array.from(this.entries.values()).filter((entry) => entry.agentId === agentId)
	}

	/**
	 * Get entries by module
	 */
	getEntriesByModule(moduleId: string): KnowledgeEntry[] {
		return Array.from(this.entries.values()).filter((entry) => entry.moduleId === moduleId)
	}

	/**
	 * Get entries by tags
	 */
	getEntriesByTags(tags: string[]): KnowledgeEntry[] {
		return Array.from(this.entries.values()).filter((entry) => tags.some((tag) => entry.tags.includes(tag)))
	}

	/**
	 * Search knowledge base
	 */
	async search(query: string, limit: number = 10): Promise<KnowledgeSearchResult> {
		try {
			const lowerQuery = query.toLowerCase()

			// Simple search implementation
			const matchingEntries = Array.from(this.entries.values())
				.filter(
					(entry) =>
						entry.title.toLowerCase().includes(lowerQuery) ||
						entry.content.toLowerCase().includes(lowerQuery) ||
						entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
				)
				.slice(0, limit)

			const result: KnowledgeSearchResult = {
				entries: matchingEntries,
				totalCount: matchingEntries.length,
				query,
			}

			logger.debug("[BmadKnowledgeBase] Search completed", {
				query,
				resultCount: result.totalCount,
			})

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadKnowledgeBase] Failed to search", { query, error: errorMessage })

			return {
				entries: [],
				totalCount: 0,
				query,
			}
		}
	}

	/**
	 * Get knowledge base statistics
	 */
	getStats(): KnowledgeBaseStats {
		const entriesByAgent: Record<string, number> = {}
		const entriesByModule: Record<string, number> = {}
		const entriesByTag: Record<string, number> = {}

		for (const entry of Array.from(this.entries.values())) {
			// Count by agent
			if (entry.agentId) {
				entriesByAgent[entry.agentId] = (entriesByAgent[entry.agentId] || 0) + 1
			}

			// Count by module
			if (entry.moduleId) {
				entriesByModule[entry.moduleId] = (entriesByModule[entry.moduleId] || 0) + 1
			}

			// Count by tag
			for (const tag of entry.tags) {
				entriesByTag[tag] = (entriesByTag[tag] || 0) + 1
			}
		}

		return {
			totalEntries: this.entries.size,
			entriesByAgent,
			entriesByModule,
			entriesByTag,
		}
	}

	/**
	 * Clear all entries
	 */
	async clearAll(): Promise<void> {
		this.entries.clear()
		logger.info("[BmadKnowledgeBase] All entries cleared")

		// Auto-save if enabled
		if (this.config.autoSave) {
			await this.saveToStorage()
		}
	}

	/**
	 * Load knowledge base from storage
	 */
	private async loadFromStorage(): Promise<void> {
		// In a real implementation, this would load from a persistent storage
		// For now, just log
		logger.debug("[BmadKnowledgeBase] Loading from storage")
	}

	/**
	 * Save knowledge base to storage
	 */
	private async saveToStorage(): Promise<void> {
		// In a real implementation, this would save to a persistent storage
		// For now, just log
		logger.debug("[BmadKnowledgeBase] Saving to storage", { entryCount: this.entries.size })
	}

	/**
	 * Setup auto-save timer
	 */
	private setupAutoSave(): void {
		if (this.saveTimer) {
			clearInterval(this.saveTimer)
		}

		this.saveTimer = setInterval(async () => {
			try {
				await this.saveToStorage()
			} catch (error) {
				logger.error("[BmadKnowledgeBase] Auto-save failed", {
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}, this.config.saveInterval)

		logger.debug("[BmadKnowledgeBase] Auto-save configured", {
			interval: this.config.saveInterval,
		})
	}

	/**
	 * Remove oldest entry
	 */
	private removeOldestEntry(): void {
		let oldestEntry: KnowledgeEntry | null = null
		let oldestTime = Date.now()

		for (const entry of Array.from(this.entries.values())) {
			if (entry.createdAt.getTime() < oldestTime) {
				oldestTime = entry.createdAt.getTime()
				oldestEntry = entry
			}
		}

		if (oldestEntry) {
			this.entries.delete(oldestEntry.id)
			logger.info("[BmadKnowledgeBase] Removed oldest entry", {
				entryId: oldestEntry.id,
				title: oldestEntry.title,
			})
		}
	}

	/**
	 * Generate unique entry ID
	 */
	private generateEntryId(): string {
		return `kb_entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Check if initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		// Clear auto-save timer
		if (this.saveTimer) {
			clearInterval(this.saveTimer)
			this.saveTimer = undefined
		}

		// Save before disposing
		if (this.config.autoSave) {
			this.saveToStorage().catch((error) => {
				logger.error("[BmadKnowledgeBase] Failed to save on dispose", {
					error: error instanceof Error ? error.message : String(error),
				})
			})
		}

		this.entries.clear()
		this.isInitialized = false

		logger.info("[BmadKnowledgeBase] Disposed")
	}
}

/**
 * Create BMAD knowledge base instance
 */
export function createBmadKnowledgeBase(
	integrationService: BmadIntegrationService,
	config?: Partial<KnowledgeBaseConfig>,
): BmadKnowledgeBase {
	return new BmadKnowledgeBase(integrationService, config)
}
