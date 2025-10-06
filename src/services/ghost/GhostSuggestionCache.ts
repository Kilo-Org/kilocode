import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostDocument, GhostPosition } from "./types/platform-independent"

/**
 * Cached suggestion entry with metadata
 */
interface CachedSuggestion {
	suggestions: GhostSuggestionsState
	timestamp: number
	acceptCount: number
	cursorPosition: GhostPosition
}

/**
 * Cache performance metrics
 */
export interface CacheMetrics {
	exactHits: number
	prefixHits: number
	misses: number
	hitRate: number
	totalLookups: number
}

/**
 * Pragmatic caching system for Ghost suggestions using two simple caches:
 * 1. Exact cache - for backspace/retype scenarios (same position)
 * 2. Prefix cache - for similar contexts using stable anchor points
 *
 * Key insight: Use stable prefixes that don't invalidate on every keystroke
 */
export class GhostSuggestionCache {
	// Two-level caching system
	private exactCache = new Map<string, GhostSuggestionsState>()
	private prefixCache = new Map<string, CachedSuggestion[]>()

	// Configuration
	private maxExactSize = 100
	private maxPrefixSize = 50
	private maxSuggestionsPerPrefix = 3

	// Metrics tracking
	private metrics: CacheMetrics = {
		exactHits: 0,
		prefixHits: 0,
		misses: 0,
		hitRate: 0,
		totalLookups: 0,
	}

	/**
	 * Generate exact cache key for same-position scenarios
	 * Key format: previousLine|currentLine|cursorPosition
	 */
	private getExactKey(document: GhostDocument, position: GhostPosition): string {
		const currentLine = document.lineAt(position.line).text
		const previousLine = position.line > 0 ? document.lineAt(position.line - 1).text : ""
		return `${previousLine}|${currentLine}|${position.character}`
	}

	/**
	 * Generate stable prefix cache key that doesn't invalidate on every keystroke
	 * Key format: fileType:stablePrefix
	 *
	 * Uses anchor points (., (, [, space, comma, =) to find stable prefixes
	 * This is the key insight from the pragmatic caching document
	 */
	private getPrefixKey(document: GhostDocument, position: GhostPosition): string {
		const line = document.lineAt(position.line).text
		const beforeCursor = line.substring(0, position.character)

		// Find the last "anchor" point - this remains stable while user types words
		const anchorMatch = beforeCursor.match(/.*[\.\(\[\s,=]/)
		const stablePrefix = anchorMatch ? anchorMatch[0] : ""

		// Add file type for basic context differentiation
		const fileExtension = document.fileName.split(".").pop() || "unknown"

		return `${fileExtension}:${stablePrefix}`
	}

	/**
	 * Retrieve cached suggestions for the given document position
	 * Tries exact cache first, then prefix cache
	 *
	 * TEMPORARILY DISABLED: Always returns null to test cache pollution issues
	 */
	public get(document: GhostDocument, position: GhostPosition): GhostSuggestionsState | null {
		this.metrics.totalLookups++
		this.metrics.misses++

		// TEMPORARY: Always return null to disable caching
		return null
	}

	/**
	 * Store successful suggestions in both caches
	 *
	 * TEMPORARILY DISABLED: No-op to test cache pollution issues
	 */
	public store(document: GhostDocument, position: GhostPosition, suggestions: GhostSuggestionsState): void {
		// TEMPORARY: Do nothing to disable caching
		return
	}

	/**
	 * Mark a suggestion as accepted by the user (for learning user preferences)
	 */
	public markAccepted(document: GhostDocument, position: GhostPosition): void {
		const prefixKey = this.getPrefixKey(document, position)
		const prefixMatches = this.prefixCache.get(prefixKey)

		if (prefixMatches && prefixMatches.length > 0) {
			// Increment acceptance count for the most recent suggestion
			// In a more sophisticated implementation, we'd match the exact suggestion
			prefixMatches[0].acceptCount++
		}
	}

	/**
	 * Get cache performance metrics
	 */
	public getMetrics(): CacheMetrics {
		const totalHits = this.metrics.exactHits + this.metrics.prefixHits
		const hitRate = this.metrics.totalLookups > 0 ? totalHits / this.metrics.totalLookups : 0

		return {
			...this.metrics,
			hitRate,
		}
	}

	/**
	 * Clear all cached entries
	 */
	public clear(): void {
		this.exactCache.clear()
		this.prefixCache.clear()
	}

	/**
	 * Simple FIFO eviction to prevent unbounded memory growth
	 */
	private evictOldEntries(): void {
		// Evict exact cache entries if over limit
		if (this.exactCache.size > this.maxExactSize) {
			const keysToRemove = Math.floor(this.maxExactSize * 0.1) // Remove 10%
			const keys = Array.from(this.exactCache.keys())

			for (let i = 0; i < keysToRemove; i++) {
				this.exactCache.delete(keys[i])
			}
		}

		// Evict prefix cache entries if over limit
		if (this.prefixCache.size > this.maxPrefixSize) {
			const keysToRemove = Math.floor(this.maxPrefixSize * 0.1) // Remove 10%
			const keys = Array.from(this.prefixCache.keys())

			for (let i = 0; i < keysToRemove; i++) {
				this.prefixCache.delete(keys[i])
			}
		}
	}

	/**
	 * Simple equality check for GhostSuggestionsState objects
	 * In a more sophisticated implementation, we'd do deep comparison
	 */
	private areSuggestionsEqual(a: GhostSuggestionsState, b: GhostSuggestionsState): boolean {
		// Quick checks first
		const aFiles = a.getFiles()
		const bFiles = b.getFiles()

		if (aFiles.length !== bFiles.length) {
			return false
		}

		// For now, just check if they have the same number of operations
		// This is a simple heuristic - could be made more sophisticated
		for (let i = 0; i < aFiles.length; i++) {
			const aOps = aFiles[i].getAllOperations().length
			const bOps = bFiles[i].getAllOperations().length

			if (aOps !== bOps) {
				return false
			}
		}

		return true
	}

	/**
	 * Get debug information about cache state
	 */
	public getDebugInfo(): object {
		return {
			exactCacheSize: this.exactCache.size,
			prefixCacheSize: this.prefixCache.size,
			metrics: this.getMetrics(),
			sampleKeys: {
				exactKeys: Array.from(this.exactCache.keys()).slice(0, 3),
				prefixKeys: Array.from(this.prefixCache.keys()).slice(0, 3),
			},
		}
	}
}
