import { MetadataDatabase } from "./metadata-database"
import type { MemoryEntry, MemoryType } from "../types"
import { v4 as uuidv4 } from "uuid"

/**
 * Memory Manager for short-term, long-term, and ephemeral memory
 */
export class MemoryManager {
	private metadataDb: MetadataDatabase
	private cleanupInterval: NodeJS.Timeout | null

	constructor(metadataDb: MetadataDatabase) {
		this.metadataDb = metadataDb
		this.cleanupInterval = null
	}

	/**
	 * Start the memory manager (begins cleanup cycle)
	 */
	async start(): Promise<void> {
		// Run cleanup every 5 minutes
		this.cleanupInterval = setInterval(
			() => {
				this.cleanup()
			},
			5 * 60 * 1000,
		)
	}

	/**
	 * Stop the memory manager
	 */
	async stop(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval)
			this.cleanupInterval = null
		}
	}

	/**
	 * Store a short-term memory (current session)
	 */
	async setShortTerm(key: string, value: any, ttl: number = 3600000): Promise<void> {
		// Default TTL: 1 hour
		const entry: MemoryEntry = {
			id: uuidv4(),
			key,
			value,
			type: "short-term",
			timestamp: Date.now(),
			ttl,
		}

		await this.metadataDb.setMemory(entry)
	}

	/**
	 * Store a long-term memory (persistent)
	 */
	async setLongTerm(key: string, value: any, metadata?: Record<string, any>): Promise<void> {
		const entry: MemoryEntry = {
			id: uuidv4(),
			key,
			value,
			type: "long-term",
			timestamp: Date.now(),
			metadata,
		}

		await this.metadataDb.setMemory(entry)
	}

	/**
	 * Store ephemeral memory (very short-lived)
	 */
	async setEphemeral(key: string, value: any, ttl: number = 60000): Promise<void> {
		// Default TTL: 1 minute
		const entry: MemoryEntry = {
			id: uuidv4(),
			key,
			value,
			type: "ephemeral",
			timestamp: Date.now(),
			ttl,
		}

		await this.metadataDb.setMemory(entry)
	}

	/**
	 * Get memory by key (searches all types)
	 */
	async get(key: string): Promise<any | null> {
		// Try long-term first
		let entry = await this.metadataDb.getMemory(key, "long-term")
		if (entry) {
			return entry.value
		}

		// Try short-term
		entry = await this.metadataDb.getMemory(key, "short-term")
		if (entry) {
			return entry.value
		}

		// Try ephemeral
		entry = await this.metadataDb.getMemory(key, "ephemeral")
		if (entry) {
			return entry.value
		}

		return null
	}

	/**
	 * Get memory by key and type
	 */
	async getByType(key: string, type: MemoryType): Promise<any | null> {
		const entry = await this.metadataDb.getMemory(key, type)
		return entry ? entry.value : null
	}

	/**
	 * Get all memories of a specific type
	 */
	async getAllByType(type: MemoryType): Promise<MemoryEntry[]> {
		return await this.metadataDb.getMemoriesByType(type)
	}

	/**
	 * Store recently opened files
	 */
	async recordOpenedFile(filePath: string): Promise<void> {
		const recentFiles = (await this.get("recent_files")) || []
		recentFiles.unshift(filePath)

		// Keep only last 50
		const uniqueRecent = [...new Set(recentFiles)].slice(0, 50)

		await this.setShortTerm("recent_files", uniqueRecent, 24 * 3600000) // 24 hours
	}

	/**
	 * Get recently opened files
	 */
	async getRecentFiles(): Promise<string[]> {
		return (await this.get("recent_files")) || []
	}

	/**
	 * Store user preference
	 */
	async setPreference(key: string, value: any): Promise<void> {
		await this.setLongTerm(`pref:${key}`, value)
	}

	/**
	 * Get user preference
	 */
	async getPreference(key: string, defaultValue?: any): Promise<any> {
		const value = await this.getByType(`pref:${key}`, "long-term")
		return value !== null ? value : defaultValue
	}

	/**
	 * Store architectural decision
	 */
	async recordDecision(decision: string, context: any): Promise<void> {
		const decisions = (await this.getByType("architectural_decisions", "long-term")) || []
		decisions.push({
			decision,
			context,
			timestamp: Date.now(),
		})

		await this.setLongTerm("architectural_decisions", decisions)
	}

	/**
	 * Clear all short-term memory
	 */
	async clearShortTerm(): Promise<void> {
		await this.metadataDb.clearMemoryByType("short-term")
	}

	/**
	 * Clear all ephemeral memory
	 */
	async clearEphemeral(): Promise<void> {
		await this.metadataDb.clearMemoryByType("ephemeral")
	}

	/**
	 * Clear all memory (use with caution)
	 */
	async clearAll(): Promise<void> {
		await this.metadataDb.clearMemoryByType("short-term")
		await this.metadataDb.clearMemoryByType("long-term")
		await this.metadataDb.clearMemoryByType("ephemeral")
	}

	/**
	 * Clean up expired memory entries
	 */
	private async cleanup(): Promise<void> {
		try {
			const deleted = await this.metadataDb.cleanupExpiredMemory()
			if (deleted > 0) {
				console.log(`Cleaned up ${deleted} expired memory entries`)
			}
		} catch (error) {
			console.error("Memory cleanup failed:", error)
		}
	}

	/**
	 * Get memory statistics
	 */
	async getStats(): Promise<{
		shortTerm: number
		longTerm: number
		ephemeral: number
	}> {
		const shortTerm = await this.metadataDb.getMemoriesByType("short-term")
		const longTerm = await this.metadataDb.getMemoriesByType("long-term")
		const ephemeral = await this.metadataDb.getMemoriesByType("ephemeral")

		return {
			shortTerm: shortTerm.length,
			longTerm: longTerm.length,
			ephemeral: ephemeral.length,
		}
	}
}
