// kilocode_change - new file
// Task 2.2.1: Context Prioritizer

/**
 * Priority levels for context items
 */
export type ContextPriorityLevel = "critical" | "high" | "medium" | "low" | "minimal"

/**
 * A prioritized context item
 */
export interface PrioritizedContextItem {
	id: string
	content: string
	type: "file" | "symbol" | "memory" | "documentation" | "conversation"
	source: string
	priority: ContextPriorityLevel
	relevanceScore: number
	recencyScore: number
	frequencyScore: number
	combinedScore: number
	tokenCount: number
	metadata?: Record<string, any>
}

/**
 * Prioritization configuration
 */
export interface PrioritizationConfig {
	/** Weight for relevance score (0-1) */
	relevanceWeight: number
	/** Weight for recency score (0-1) */
	recencyWeight: number
	/** Weight for frequency score (0-1) */
	frequencyWeight: number
	/** Maximum age in hours for recency calculation */
	maxAgeHours: number
	/** Boost factor for user-mentioned items */
	mentionBoost: number
	/** Boost factor for items from active file */
	activeFileBoost: number
	/** Boost factor for recently edited files */
	recentEditBoost: number
}

const DEFAULT_CONFIG: PrioritizationConfig = {
	relevanceWeight: 0.5,
	recencyWeight: 0.3,
	frequencyWeight: 0.2,
	maxAgeHours: 24,
	mentionBoost: 1.5,
	activeFileBoost: 1.3,
	recentEditBoost: 1.2,
}

/**
 * Context for prioritization decisions
 */
export interface PrioritizationContext {
	/** Currently active file path */
	activeFilePath?: string
	/** Files recently edited by user */
	recentlyEditedFiles?: string[]
	/** Items explicitly mentioned in the current query */
	mentionedItems?: string[]
	/** Current task/conversation topic */
	currentTopic?: string
	/** Token budget available */
	tokenBudget: number
}

/**
 * Result of prioritization
 */
export interface PrioritizationResult {
	/** Items that fit within the token budget, in priority order */
	includedItems: PrioritizedContextItem[]
	/** Items that didn't fit within budget */
	excludedItems: PrioritizedContextItem[]
	/** Total tokens used by included items */
	totalTokens: number
	/** Remaining token budget */
	remainingBudget: number
	/** Statistics about the prioritization */
	stats: {
		totalItems: number
		includedCount: number
		excludedCount: number
		avgScore: number
		priorityDistribution: Record<ContextPriorityLevel, number>
	}
}

/**
 * Smart context prioritizer that ranks context items based on
 * relevance, recency, frequency, and other factors.
 */
export class ContextPrioritizer {
	private config: PrioritizationConfig

	// Tracking for frequency scoring
	private accessCounts: Map<string, number> = new Map()
	private lastAccessTimes: Map<string, number> = new Map()

	constructor(config: Partial<PrioritizationConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Prioritize a list of context items
	 */
	prioritize(
		items: Array<{
			id: string
			content: string
			type: PrioritizedContextItem["type"]
			source: string
			relevanceScore?: number
			timestamp?: number
			tokenCount: number
			metadata?: Record<string, any>
		}>,
		context: PrioritizationContext,
	): PrioritizationResult {
		// Calculate scores for each item
		const scoredItems: PrioritizedContextItem[] = items.map((item) => {
			const relevanceScore = item.relevanceScore ?? 0.5
			const recencyScore = this.calculateRecencyScore(item.timestamp)
			const frequencyScore = this.calculateFrequencyScore(item.id)

			let combinedScore = this.calculateCombinedScore(relevanceScore, recencyScore, frequencyScore)

			// Apply boosts
			combinedScore = this.applyBoosts(item, combinedScore, context)

			// Determine priority level
			const priority = this.determinePriorityLevel(combinedScore)

			// Track access
			this.trackAccess(item.id)

			return {
				id: item.id,
				content: item.content,
				type: item.type,
				source: item.source,
				priority,
				relevanceScore,
				recencyScore,
				frequencyScore,
				combinedScore,
				tokenCount: item.tokenCount,
				metadata: item.metadata,
			}
		})

		// Sort by combined score (highest first)
		scoredItems.sort((a, b) => b.combinedScore - a.combinedScore)

		// Select items within token budget
		const includedItems: PrioritizedContextItem[] = []
		const excludedItems: PrioritizedContextItem[] = []
		let totalTokens = 0

		for (const item of scoredItems) {
			if (totalTokens + item.tokenCount <= context.tokenBudget) {
				includedItems.push(item)
				totalTokens += item.tokenCount
			} else {
				excludedItems.push(item)
			}
		}

		// Calculate statistics
		const priorityDistribution: Record<ContextPriorityLevel, number> = {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			minimal: 0,
		}

		for (const item of includedItems) {
			priorityDistribution[item.priority]++
		}

		const avgScore =
			includedItems.length > 0
				? includedItems.reduce((sum, item) => sum + item.combinedScore, 0) / includedItems.length
				: 0

		return {
			includedItems,
			excludedItems,
			totalTokens,
			remainingBudget: context.tokenBudget - totalTokens,
			stats: {
				totalItems: scoredItems.length,
				includedCount: includedItems.length,
				excludedCount: excludedItems.length,
				avgScore,
				priorityDistribution,
			},
		}
	}

	/**
	 * Reprioritize based on feedback
	 */
	applyFeedback(itemId: string, wasUseful: boolean): void {
		const currentCount = this.accessCounts.get(itemId) || 0
		if (wasUseful) {
			// Boost frequency score
			this.accessCounts.set(itemId, currentCount + 5)
		} else {
			// Reduce frequency score
			this.accessCounts.set(itemId, Math.max(0, currentCount - 2))
		}
	}

	/**
	 * Get priority statistics
	 */
	getStats(): {
		trackedItems: number
		avgAccessCount: number
		topItems: Array<{ id: string; accessCount: number }>
	} {
		const entries = Array.from(this.accessCounts.entries())
		const totalAccess = entries.reduce((sum, [, count]) => sum + count, 0)

		const topItems = entries
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([id, accessCount]) => ({ id, accessCount }))

		return {
			trackedItems: this.accessCounts.size,
			avgAccessCount: entries.length > 0 ? totalAccess / entries.length : 0,
			topItems,
		}
	}

	/**
	 * Clear tracking data
	 */
	clearTracking(): void {
		this.accessCounts.clear()
		this.lastAccessTimes.clear()
	}

	// Private methods

	private calculateRecencyScore(timestamp?: number): number {
		if (!timestamp) return 0.5

		const ageHours = (Date.now() - timestamp) / (60 * 60 * 1000)

		if (ageHours <= 1) return 1.0
		if (ageHours >= this.config.maxAgeHours) return 0.1

		// Exponential decay
		return Math.exp(-ageHours / (this.config.maxAgeHours / 3))
	}

	private calculateFrequencyScore(itemId: string): number {
		const accessCount = this.accessCounts.get(itemId) || 0

		// Logarithmic scaling
		return Math.min(1, Math.log(accessCount + 1) / Math.log(100))
	}

	private calculateCombinedScore(relevance: number, recency: number, frequency: number): number {
		return (
			relevance * this.config.relevanceWeight +
			recency * this.config.recencyWeight +
			frequency * this.config.frequencyWeight
		)
	}

	private applyBoosts(
		item: { id: string; source: string; metadata?: Record<string, any> },
		score: number,
		context: PrioritizationContext,
	): number {
		let boostedScore = score

		// Mention boost
		if (context.mentionedItems?.includes(item.id)) {
			boostedScore *= this.config.mentionBoost
		}

		// Active file boost
		if (context.activeFilePath && item.source === context.activeFilePath) {
			boostedScore *= this.config.activeFileBoost
		}

		// Recent edit boost
		if (context.recentlyEditedFiles?.includes(item.source)) {
			boostedScore *= this.config.recentEditBoost
		}

		return Math.min(1, boostedScore)
	}

	private determinePriorityLevel(score: number): ContextPriorityLevel {
		if (score >= 0.9) return "critical"
		if (score >= 0.7) return "high"
		if (score >= 0.5) return "medium"
		if (score >= 0.3) return "low"
		return "minimal"
	}

	private trackAccess(itemId: string): void {
		const currentCount = this.accessCounts.get(itemId) || 0
		this.accessCounts.set(itemId, currentCount + 1)
		this.lastAccessTimes.set(itemId, Date.now())
	}
}

// Singleton instance
let prioritizerInstance: ContextPrioritizer | null = null

export function getContextPrioritizer(config?: Partial<PrioritizationConfig>): ContextPrioritizer {
	if (!prioritizerInstance) {
		prioritizerInstance = new ContextPrioritizer(config)
	}
	return prioritizerInstance
}

export function resetContextPrioritizer(): void {
	prioritizerInstance = null
}
