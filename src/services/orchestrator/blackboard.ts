// kilocode_change - new file

import { EventEmitter } from "events"
import { BlackboardEntry } from "../agents/types"

export interface BlackboardConfig {
	maxEntries: number
	defaultTTL: number // Time to live in milliseconds
	enablePersistence: boolean
	persistencePath?: string
	cleanupInterval: number // Cleanup interval in milliseconds
}

export class Blackboard extends EventEmitter {
	private _entries: Map<string, BlackboardEntry> = new Map()
	private _config: BlackboardConfig
	private _cleanupTimer?: NodeJS.Timeout

	constructor(config: BlackboardConfig) {
		super()
		this._config = config
		console.log("[Blackboard] Initialized with config:", config)

		// Start cleanup timer
		this._cleanupTimer = setInterval(() => {
			this.cleanup()
		}, this._config.cleanupInterval)
	}

	/**
	 * Write a value to the blackboard
	 */
	write(key: string, value: any, agentId?: string, ttl?: number): void {
		const expiresAt = ttl
			? new Date(Date.now() + ttl)
			: this._config.defaultTTL
				? new Date(Date.now() + this._config.defaultTTL)
				: undefined

		const entry: BlackboardEntry = {
			key,
			value,
			agentId,
			timestamp: new Date(),
			expiresAt,
			accessCount: 0,
			lastAccessed: new Date(),
		}

		this._entries.set(key, entry)
		this.emit("entryWritten", entry)

		console.log(`[Blackboard] Written entry: ${key} by agent ${agentId || "system"}`)

		// Persist if enabled
		if (this._config.enablePersistence) {
			this.persist()
		}
	}

	/**
	 * Read a value from the blackboard
	 */
	read(key: string): BlackboardEntry | undefined {
		const entry = this._entries.get(key)

		if (!entry) {
			return undefined
		}

		// Check if entry has expired
		if (entry.expiresAt && entry.expiresAt < new Date()) {
			this._entries.delete(key)
			this.emit("entryExpired", entry)
			return undefined
		}

		// Update access statistics
		entry.accessCount++
		entry.lastAccessed = new Date()

		this.emit("entryRead", entry)
		return entry
	}

	/**
	 * Read multiple entries by pattern
	 */
	readPattern(pattern: string): BlackboardEntry[] {
		const regex = new RegExp(pattern)
		const entries: BlackboardEntry[] = []

		for (const [key, entry] of this._entries) {
			if (regex.test(key)) {
				// Check if entry has expired
				if (entry.expiresAt && entry.expiresAt < new Date()) {
					this._entries.delete(key)
					this.emit("entryExpired", entry)
					continue
				}

				// Update access statistics
				entry.accessCount++
				entry.lastAccessed = new Date()
				entries.push(entry)
			}
		}

		return entries
	}

	/**
	 * Check if a key exists
	 */
	exists(key: string): boolean {
		const entry = this._entries.get(key)
		if (!entry) {
			return false
		}

		// Check if entry has expired
		if (entry.expiresAt && entry.expiresAt < new Date()) {
			this._entries.delete(key)
			this.emit("entryExpired", entry)
			return false
		}

		return true
	}

	/**
	 * Delete an entry
	 */
	delete(key: string): boolean {
		const entry = this._entries.get(key)
		if (!entry) {
			return false
		}

		this._entries.delete(key)
		this.emit("entryDeleted", entry)

		console.log(`[Blackboard] Deleted entry: ${key}`)

		// Persist if enabled
		if (this._config.enablePersistence) {
			this.persist()
		}

		return true
	}

	/**
	 * Clear all entries
	 */
	clear(): void {
		const keys = Array.from(this._entries.keys())
		for (const key of keys) {
			this.delete(key)
		}

		console.log("[Blackboard] Cleared all entries")
	}

	/**
	 * Get all entries
	 */
	getAllEntries(): BlackboardEntry[] {
		const entries: BlackboardEntry[] = []

		for (const [key, entry] of this._entries) {
			// Skip expired entries
			if (entry.expiresAt && entry.expiresAt < new Date()) {
				this._entries.delete(key)
				this.emit("entryExpired", entry)
				continue
			}

			entries.push(entry)
		}

		return entries
	}

	/**
	 * Get entries by agent
	 */
	getEntriesByAgent(agentId: string): BlackboardEntry[] {
		return this.getAllEntries().filter((entry) => entry.agentId === agentId)
	}

	/**
	 * Get statistics
	 */
	getStats(): {
		totalEntries: number
		entriesByAgent: Record<string, number>
		averageAccessCount: number
		oldestEntry: Date
		newestEntry: Date
		expiredEntries: number
	} {
		const entries = this.getAllEntries()
		const entriesByAgent: Record<string, number> = {}
		let totalAccessCount = 0
		let oldestTimestamp = new Date()
		let newestTimestamp = new Date(0)

		for (const entry of entries) {
			// Count by agent
			if (entry.agentId) {
				entriesByAgent[entry.agentId] = (entriesByAgent[entry.agentId] || 0) + 1
			}

			// Access statistics
			totalAccessCount += entry.accessCount

			// Timestamp statistics
			if (entry.timestamp < oldestTimestamp) {
				oldestTimestamp = entry.timestamp
			}
			if (entry.timestamp > newestTimestamp) {
				newestTimestamp = entry.timestamp
			}
		}

		return {
			totalEntries: entries.length,
			entriesByAgent,
			averageAccessCount: entries.length > 0 ? totalAccessCount / entries.length : 0,
			oldestEntry: oldestTimestamp,
			newestEntry: newestTimestamp,
			expiredEntries: this.countExpiredEntries(),
		}
	}

	/**
	 * Cleanup expired entries
	 */
	cleanup(): void {
		const now = new Date()
		const expiredKeys: string[] = []

		for (const [key, entry] of this._entries) {
			if (entry.expiresAt && entry.expiresAt < now) {
				expiredKeys.push(key)
			}
		}

		for (const key of expiredKeys) {
			const entry = this._entries.get(key)!
			this._entries.delete(key)
			this.emit("entryExpired", entry)
		}

		if (expiredKeys.length > 0) {
			console.log(`[Blackboard] Cleaned up ${expiredKeys.length} expired entries`)

			// Persist if enabled
			if (this._config.enablePersistence) {
				this.persist()
			}
		}

		// Enforce maximum entries
		if (this._entries.size > this._config.maxEntries) {
			const entriesToRemove = this._entries.size - this._config.maxEntries
			const sortedEntries = Array.from(this._entries.entries()).sort(
				([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime(),
			)

			for (let i = 0; i < entriesToRemove; i++) {
				const [key, entry] = sortedEntries[i]
				this._entries.delete(key)
				this.emit("entryEvicted", entry)
			}

			console.log(`[Blackboard] Evicted ${entriesToRemove} entries due to size limit`)
		}
	}

	/**
	 * Persist entries to disk
	 */
	private async persist(): Promise<void> {
		if (!this._config.persistencePath) {
			return
		}

		try {
			const fs = require("fs").promises
			const data = {
				entries: Array.from(this._entries.entries()),
				timestamp: new Date().toISOString(),
			}

			await fs.writeFile(this._config.persistencePath, JSON.stringify(data, null, 2))
		} catch (error) {
			console.error("[Blackboard] Error persisting entries:", error)
		}
	}

	/**
	 * Load entries from disk
	 */
	async load(): Promise<void> {
		if (!this._config.persistencePath) {
			return
		}

		try {
			const fs = require("fs").promises
			const data = await fs.readFile(this._config.persistencePath, "utf8")
			const parsed = JSON.parse(data)

			for (const [key, entry] of parsed.entries) {
				// Convert date strings back to Date objects
				const typedEntry = {
					...entry,
					timestamp: new Date(entry.timestamp),
					expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : undefined,
					lastAccessed: new Date(entry.lastAccessed),
				}

				this._entries.set(key, typedEntry)
			}

			console.log(`[Blackboard] Loaded ${this._entries.size} entries from disk`)
		} catch (error) {
			console.warn("[Blackboard] Could not load entries from disk:", error)
		}
	}

	/**
	 * Count expired entries
	 */
	private countExpiredEntries(): number {
		const now = new Date()
		let count = 0

		for (const entry of this._entries.values()) {
			if (entry.expiresAt && entry.expiresAt < now) {
				count++
			}
		}

		return count
	}

	/**
	 * Destroy the blackboard
	 */
	destroy(): void {
		if (this._cleanupTimer) {
			clearInterval(this._cleanupTimer)
		}

		this.clear()
		this.removeAllListeners()

		console.log("[Blackboard] Destroyed")
	}
}
