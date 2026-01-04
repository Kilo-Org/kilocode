import { EventEmitter } from "events"
import { TerminalBufferEntry } from "./PTYManager"

export interface SearchOptions {
	query: string
	useRegex?: boolean
	caseSensitive?: boolean
	maxResults?: number
	timeRange?: {
		start: number
		end: number
	}
}

export interface SearchResult {
	entry: TerminalBufferEntry
	score: number
	matches: string[]
}

export interface BufferStats {
	totalEntries: number
	stdoutCount: number
	stderrCount: number
	oldestEntry: number
	newestEntry: number
	averageEntrySize: number
}

/**
 * Terminal Buffer - Searchable storage for terminal output
 * Provides efficient search and retrieval capabilities for AI context
 */
export class TerminalBuffer extends EventEmitter {
	private buffer: TerminalBufferEntry[] = []
	private maxEntries = 5000
	private maxSizeBytes = 50 * 1024 * 1024 // 50MB
	private currentSizeBytes = 0

	constructor(maxEntries = 5000, maxSizeBytes = 50 * 1024 * 1024) {
		super()
		this.maxEntries = maxEntries
		this.maxSizeBytes = maxSizeBytes
	}

	/**
	 * Add entries to the buffer
	 */
	public addEntries(entries: TerminalBufferEntry[]): void {
		for (const entry of entries) {
			this.addEntry(entry)
		}
	}

	/**
	 * Add a single entry to the buffer
	 */
	public addEntry(entry: TerminalBufferEntry): void {
		// Check size limits before adding
		this.enforceSizeLimits()

		this.buffer.push(entry)
		this.currentSizeBytes += this.calculateEntrySize(entry)

		this.emit("entryAdded", entry)
	}

	/**
	 * Get recent entries by count
	 */
	public getRecentEntries(count = 50): TerminalBufferEntry[] {
		return this.buffer.slice(-count)
	}

	/**
	 * Get entries in a time range
	 */
	public getEntriesByTimeRange(start: number, end: number): TerminalBufferEntry[] {
		return this.buffer.filter((entry) => entry.timestamp >= start && entry.timestamp <= end)
	}

	/**
	 * Search the buffer with various options
	 */
	public search(options: SearchOptions): SearchResult[] {
		const { query, useRegex = false, caseSensitive = false, maxResults = 100, timeRange } = options

		let searchPattern: RegExp

		try {
			if (useRegex) {
				searchPattern = new RegExp(query, caseSensitive ? "g" : "gi")
			} else {
				const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
				searchPattern = new RegExp(escapedQuery, caseSensitive ? "g" : "gi")
			}
		} catch (error) {
			throw new Error(`Invalid search pattern: ${error}`)
		}

		const results: SearchResult[] = []

		for (const entry of this.buffer) {
			// Apply time range filter if specified
			if (timeRange && (entry.timestamp < timeRange.start || entry.timestamp > timeRange.end)) {
				continue
			}

			// Search in both raw content and clean content
			const contentMatches = entry.content.match(searchPattern)
			const cleanMatches = entry.cleanContent.match(searchPattern)
			const matches = [...(contentMatches || []), ...(cleanMatches || [])]

			if (matches.length > 0) {
				// Calculate relevance score
				const score = this.calculateRelevanceScore(entry, matches, query)

				results.push({
					entry,
					score,
					matches: [...new Set(matches)], // Remove duplicates
				})
			}

			// Limit results to prevent performance issues
			if (results.length >= maxResults) {
				break
			}
		}

		// Sort by relevance score (highest first)
		return results.sort((a, b) => b.score - a.score)
	}

	/**
	 * Get entries containing errors
	 */
	public getErrorEntries(limit = 50): TerminalBufferEntry[] {
		const errorPatterns = [
			/error/i,
			/exception/i,
			/failed/i,
			/failure/i,
			/crash/i,
			/panic/i,
			/fatal/i,
			/traceback/i,
			/integrityerror/i,
			/accesserror/i,
			/usererror/i,
		]

		const errorEntries: TerminalBufferEntry[] = []

		for (const entry of this.buffer) {
			for (const pattern of errorPatterns) {
				if (pattern.test(entry.cleanContent)) {
					errorEntries.push(entry)
					break
				}
			}

			if (errorEntries.length >= limit) {
				break
			}
		}

		return errorEntries.reverse().slice(0, limit) // Most recent first
	}

	/**
	 * Get entries around a specific timestamp
	 */
	public getContextAroundTimestamp(timestamp: number, beforeMs = 5000, afterMs = 5000): TerminalBufferEntry[] {
		const start = timestamp - beforeMs
		const end = timestamp + afterMs

		return this.getEntriesByTimeRange(start, end)
	}

	/**
	 * Get buffer statistics
	 */
	public getStats(): BufferStats {
		if (this.buffer.length === 0) {
			return {
				totalEntries: 0,
				stdoutCount: 0,
				stderrCount: 0,
				oldestEntry: 0,
				newestEntry: 0,
				averageEntrySize: 0,
			}
		}

		const stdoutCount = this.buffer.filter((entry) => entry.type === "stdout").length
		const stderrCount = this.buffer.filter((entry) => entry.type === "stderr").length
		const oldestEntry = this.buffer[0].timestamp
		const newestEntry = this.buffer[this.buffer.length - 1].timestamp
		const averageEntrySize = this.currentSizeBytes / this.buffer.length

		return {
			totalEntries: this.buffer.length,
			stdoutCount,
			stderrCount,
			oldestEntry,
			newestEntry,
			averageEntrySize,
		}
	}

	/**
	 * Clear the buffer
	 */
	public clear(): void {
		this.buffer = []
		this.currentSizeBytes = 0
		this.emit("bufferCleared")
	}

	/**
	 * Clear entries older than a timestamp
	 */
	public clearOlderThan(timestamp: number): number {
		const originalLength = this.buffer.length
		this.buffer = this.buffer.filter((entry) => entry.timestamp >= timestamp)

		// Recalculate size
		this.currentSizeBytes = this.buffer.reduce((size, entry) => size + this.calculateEntrySize(entry), 0)

		const clearedCount = originalLength - this.buffer.length
		if (clearedCount > 0) {
			this.emit("entriesCleared", clearedCount)
		}

		return clearedCount
	}

	/**
	 * Export buffer to JSON
	 */
	public export(): TerminalBufferEntry[] {
		return [...this.buffer]
	}

	/**
	 * Import buffer from JSON
	 */
	public import(entries: TerminalBufferEntry[]): void {
		this.clear()
		this.addEntries(entries)
		this.emit("bufferImported", entries.length)
	}

	/**
	 * Set buffer limits
	 */
	public setLimits(maxEntries: number, maxSizeBytes: number): void {
		this.maxEntries = maxEntries
		this.maxSizeBytes = maxSizeBytes
		this.enforceSizeLimits()
	}

	/**
	 * Calculate relevance score for search results
	 */
	private calculateRelevanceScore(entry: TerminalBufferEntry, matches: string[], query: string): number {
		let score = 0

		// Base score for having matches
		score += matches.length * 10

		// Higher score for more recent entries
		const ageMs = Date.now() - entry.timestamp
		const recencyScore = Math.max(0, 100 - ageMs / (1000 * 60)) // Decay over minutes
		score += recencyScore

		// Higher score for stderr (likely errors)
		if (entry.type === "stderr") {
			score += 50
		}

		// Higher score for exact matches
		if (entry.cleanContent.toLowerCase().includes(query.toLowerCase())) {
			score += 30
		}

		// Higher score for entries with more content (likely more context)
		const contentLengthScore = Math.min(20, entry.cleanContent.length / 100)
		score += contentLengthScore

		return score
	}

	/**
	 * Calculate the size of an entry in bytes
	 */
	private calculateEntrySize(entry: TerminalBufferEntry): number {
		return JSON.stringify(entry).length
	}

	/**
	 * Enforce size limits by removing old entries
	 */
	private enforceSizeLimits(): void {
		let needsTrimming = false

		// Check entry count limit
		if (this.buffer.length > this.maxEntries) {
			needsTrimming = true
		}

		// Check size limit
		if (this.currentSizeBytes > this.maxSizeBytes) {
			needsTrimming = true
		}

		if (needsTrimming) {
			// Remove oldest entries until limits are satisfied
			while (
				(this.buffer.length > this.maxEntries || this.currentSizeBytes > this.maxSizeBytes) &&
				this.buffer.length > 0
			) {
				const removedEntry = this.buffer.shift()
				if (removedEntry) {
					this.currentSizeBytes -= this.calculateEntrySize(removedEntry)
				}
			}

			this.emit("bufferTrimmed")
		}
	}

	/**
	 * Get the current buffer size in bytes
	 */
	public getBufferSize(): number {
		return this.currentSizeBytes
	}

	/**
	 * Get the number of entries
	 */
	public getEntryCount(): number {
		return this.buffer.length
	}
}
