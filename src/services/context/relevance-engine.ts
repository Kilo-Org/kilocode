// kilocode_change - new file
// Task 4.3.1: Relevance Scoring Engine

/**
 * Relevance factors used in scoring
 */
export interface RelevanceFactors {
	semanticSimilarity: number
	recency: number
	frequency: number
	userPreference: number
	contextualMatch: number
	typeBoost: number
}

/**
 * Scored item with detailed breakdown
 */
export interface ScoredItem<T = any> {
	item: T
	id: string
	finalScore: number
	factors: RelevanceFactors
	explanation?: string
}

/**
 * Scoring weights configuration
 */
export interface ScoringWeights {
	semanticSimilarity: number
	recency: number
	frequency: number
	userPreference: number
	contextualMatch: number
	typeBoost: number
}

/**
 * User feedback for learning
 */
export interface UserFeedback {
	itemId: string
	wasUseful: boolean
	context: string
	timestamp: number
}

/**
 * Configuration for relevance engine
 */
export interface RelevanceEngineConfig {
	/** Default scoring weights */
	defaultWeights: ScoringWeights
	/** Enable learning from feedback */
	enableLearning: boolean
	/** Learning rate for weight adjustments */
	learningRate: number
	/** Decay factor for old feedback */
	feedbackDecay: number
	/** Maximum feedback entries to keep */
	maxFeedbackEntries: number
}

const DEFAULT_CONFIG: RelevanceEngineConfig = {
	defaultWeights: {
		semanticSimilarity: 0.35,
		recency: 0.2,
		frequency: 0.15,
		userPreference: 0.1,
		contextualMatch: 0.15,
		typeBoost: 0.05,
	},
	enableLearning: true,
	learningRate: 0.01,
	feedbackDecay: 0.95,
	maxFeedbackEntries: 1000,
}

/**
 * Type-specific boost values
 */
const TYPE_BOOSTS: Record<string, number> = {
	"active-file": 1.5,
	"recently-edited": 1.3,
	"imported-module": 1.2,
	"same-directory": 1.1,
	documentation: 1.0,
	"test-file": 0.9,
	dependency: 0.8,
	external: 0.7,
}

/**
 * Relevance scoring engine with learning capabilities.
 * Calculates relevance scores based on multiple factors and
 * learns from user feedback to improve over time.
 */
export class RelevanceEngine {
	private config: RelevanceEngineConfig
	private weights: ScoringWeights
	private feedbackHistory: UserFeedback[] = []
	private itemScoreHistory: Map<string, number[]> = new Map()
	private contextWeightAdjustments: Map<string, Partial<ScoringWeights>> = new Map()

	constructor(config: Partial<RelevanceEngineConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.weights = { ...this.config.defaultWeights }
	}

	/**
	 * Score a single item
	 */
	scoreItem<T>(item: T, itemId: string, factors: Partial<RelevanceFactors>, context?: string): ScoredItem<T> {
		const fullFactors = this.normalizeFactors(factors)
		const weights = this.getContextualWeights(context)

		const finalScore = this.calculateScore(fullFactors, weights)

		// Track for learning
		this.trackScore(itemId, finalScore)

		return {
			item,
			id: itemId,
			finalScore,
			factors: fullFactors,
			explanation: this.generateExplanation(fullFactors, weights),
		}
	}

	/**
	 * Score multiple items and return sorted
	 */
	scoreItems<T>(
		items: Array<{
			item: T
			id: string
			factors: Partial<RelevanceFactors>
		}>,
		context?: string,
		limit?: number,
	): ScoredItem<T>[] {
		const scored = items.map(({ item, id, factors }) => this.scoreItem(item, id, factors, context))

		scored.sort((a, b) => b.finalScore - a.finalScore)

		return limit ? scored.slice(0, limit) : scored
	}

	/**
	 * Calculate semantic similarity score
	 */
	calculateSemanticSimilarity(queryEmbedding: number[], itemEmbedding: number[]): number {
		if (queryEmbedding.length !== itemEmbedding.length) {
			return 0
		}

		// Cosine similarity
		let dotProduct = 0
		let queryNorm = 0
		let itemNorm = 0

		for (let i = 0; i < queryEmbedding.length; i++) {
			dotProduct += queryEmbedding[i] * itemEmbedding[i]
			queryNorm += queryEmbedding[i] ** 2
			itemNorm += itemEmbedding[i] ** 2
		}

		const magnitude = Math.sqrt(queryNorm) * Math.sqrt(itemNorm)
		return magnitude === 0 ? 0 : (dotProduct / magnitude + 1) / 2 // Normalize to 0-1
	}

	/**
	 * Calculate recency score
	 */
	calculateRecencyScore(timestamp: number, maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
		const age = Date.now() - timestamp
		if (age <= 0) return 1
		if (age >= maxAgeMs) return 0.1

		// Exponential decay
		return Math.exp((-3 * age) / maxAgeMs)
	}

	/**
	 * Calculate frequency score based on access history
	 */
	calculateFrequencyScore(accessCount: number, maxAccess = 100): number {
		// Logarithmic scaling
		return Math.min(1, Math.log(accessCount + 1) / Math.log(maxAccess + 1))
	}

	/**
	 * Get type boost value
	 */
	getTypeBoost(type: string): number {
		return TYPE_BOOSTS[type] ?? 1.0
	}

	/**
	 * Record user feedback
	 */
	recordFeedback(feedback: UserFeedback): void {
		this.feedbackHistory.push(feedback)

		// Limit history size
		if (this.feedbackHistory.length > this.config.maxFeedbackEntries) {
			this.feedbackHistory = this.feedbackHistory.slice(-this.config.maxFeedbackEntries)
		}

		// Learn from feedback
		if (this.config.enableLearning) {
			this.learnFromFeedback(feedback)
		}
	}

	/**
	 * Batch record feedback
	 */
	recordBatchFeedback(feedbacks: UserFeedback[]): void {
		for (const feedback of feedbacks) {
			this.recordFeedback(feedback)
		}
	}

	/**
	 * Get current weights
	 */
	getWeights(): ScoringWeights {
		return { ...this.weights }
	}

	/**
	 * Set custom weights
	 */
	setWeights(weights: Partial<ScoringWeights>): void {
		this.weights = { ...this.weights, ...weights }
		this.normalizeWeights()
	}

	/**
	 * Reset weights to default
	 */
	resetWeights(): void {
		this.weights = { ...this.config.defaultWeights }
	}

	/**
	 * Get learning statistics
	 */
	getStats(): {
		totalFeedback: number
		positiveFeedback: number
		negativeFeedback: number
		trackedItems: number
		weightHistory: ScoringWeights
	} {
		const positive = this.feedbackHistory.filter((f) => f.wasUseful).length
		const negative = this.feedbackHistory.filter((f) => !f.wasUseful).length

		return {
			totalFeedback: this.feedbackHistory.length,
			positiveFeedback: positive,
			negativeFeedback: negative,
			trackedItems: this.itemScoreHistory.size,
			weightHistory: this.weights,
		}
	}

	/**
	 * Clear all learning data
	 */
	clearLearningData(): void {
		this.feedbackHistory = []
		this.itemScoreHistory.clear()
		this.contextWeightAdjustments.clear()
		this.resetWeights()
	}

	/**
	 * Export model for persistence
	 */
	exportModel(): {
		weights: ScoringWeights
		contextAdjustments: Record<string, Partial<ScoringWeights>>
	} {
		return {
			weights: this.weights,
			contextAdjustments: Object.fromEntries(this.contextWeightAdjustments),
		}
	}

	/**
	 * Import model from persistence
	 */
	importModel(model: {
		weights: ScoringWeights
		contextAdjustments?: Record<string, Partial<ScoringWeights>>
	}): void {
		this.weights = { ...model.weights }
		this.normalizeWeights()

		if (model.contextAdjustments) {
			this.contextWeightAdjustments = new Map(Object.entries(model.contextAdjustments))
		}
	}

	// Private methods

	private normalizeFactors(factors: Partial<RelevanceFactors>): RelevanceFactors {
		return {
			semanticSimilarity: this.clamp(factors.semanticSimilarity ?? 0.5),
			recency: this.clamp(factors.recency ?? 0.5),
			frequency: this.clamp(factors.frequency ?? 0),
			userPreference: this.clamp(factors.userPreference ?? 0.5),
			contextualMatch: this.clamp(factors.contextualMatch ?? 0.5),
			typeBoost: factors.typeBoost ?? 1.0,
		}
	}

	private clamp(value: number, min = 0, max = 1): number {
		return Math.max(min, Math.min(max, value))
	}

	private getContextualWeights(context?: string): ScoringWeights {
		if (!context) return this.weights

		const adjustments = this.contextWeightAdjustments.get(context)
		if (!adjustments) return this.weights

		const adjusted = { ...this.weights }
		for (const [key, value] of Object.entries(adjustments)) {
			if (value !== undefined) {
				adjusted[key as keyof ScoringWeights] = value
			}
		}

		return adjusted
	}

	private calculateScore(factors: RelevanceFactors, weights: ScoringWeights): number {
		let score = 0

		score += factors.semanticSimilarity * weights.semanticSimilarity
		score += factors.recency * weights.recency
		score += factors.frequency * weights.frequency
		score += factors.userPreference * weights.userPreference
		score += factors.contextualMatch * weights.contextualMatch

		// Apply type boost as a multiplier
		score *= factors.typeBoost

		// Apply final type boost weight
		const typeWeight = weights.typeBoost
		score = score * (1 - typeWeight) + score * factors.typeBoost * typeWeight

		return this.clamp(score)
	}

	private generateExplanation(factors: RelevanceFactors, weights: ScoringWeights): string {
		const contributions: string[] = []

		if (factors.semanticSimilarity > 0.7) {
			contributions.push("high semantic match")
		}
		if (factors.recency > 0.8) {
			contributions.push("recently accessed")
		}
		if (factors.frequency > 0.5) {
			contributions.push("frequently used")
		}
		if (factors.contextualMatch > 0.7) {
			contributions.push("contextually relevant")
		}
		if (factors.typeBoost > 1.2) {
			contributions.push("type priority")
		}

		if (contributions.length === 0) {
			return "baseline relevance"
		}

		return contributions.join(", ")
	}

	private trackScore(itemId: string, score: number): void {
		const history = this.itemScoreHistory.get(itemId) || []
		history.push(score)

		// Keep last 10 scores
		if (history.length > 10) {
			history.shift()
		}

		this.itemScoreHistory.set(itemId, history)
	}

	private learnFromFeedback(feedback: UserFeedback): void {
		const scoreHistory = this.itemScoreHistory.get(feedback.itemId)
		if (!scoreHistory || scoreHistory.length === 0) return

		const avgScore = scoreHistory.reduce((a, b) => a + b, 0) / scoreHistory.length
		const adjustment = feedback.wasUseful ? 1 : -1
		const learningRate = this.config.learningRate

		// Adjust weights based on feedback
		// If useful but low score, increase relevant weights
		// If not useful but high score, decrease relevant weights
		if ((feedback.wasUseful && avgScore < 0.5) || (!feedback.wasUseful && avgScore > 0.5)) {
			// Adjust semantic similarity weight
			this.weights.semanticSimilarity += adjustment * learningRate * 0.5
			// Adjust contextual match weight
			this.weights.contextualMatch += adjustment * learningRate * 0.3
		}

		this.normalizeWeights()

		// Store context-specific adjustments
		if (feedback.context) {
			const contextAdj = this.contextWeightAdjustments.get(feedback.context) || {}
			contextAdj.semanticSimilarity =
				(contextAdj.semanticSimilarity ?? this.weights.semanticSimilarity) + adjustment * learningRate * 0.2
			this.contextWeightAdjustments.set(feedback.context, contextAdj)
		}
	}

	private normalizeWeights(): void {
		// Ensure weights sum to 1 (excluding typeBoost which is a multiplier)
		const keys: (keyof ScoringWeights)[] = [
			"semanticSimilarity",
			"recency",
			"frequency",
			"userPreference",
			"contextualMatch",
		]

		const sum = keys.reduce((s, k) => s + this.weights[k], 0)

		if (sum > 0) {
			for (const key of keys) {
				this.weights[key] = this.clamp(this.weights[key] / sum)
			}
		}

		// Clamp typeBoost
		this.weights.typeBoost = this.clamp(this.weights.typeBoost, 0, 0.2)
	}
}

// Singleton instance
let engineInstance: RelevanceEngine | null = null

export function getRelevanceEngine(config?: Partial<RelevanceEngineConfig>): RelevanceEngine {
	if (!engineInstance) {
		engineInstance = new RelevanceEngine(config)
	}
	return engineInstance
}

export function resetRelevanceEngine(): void {
	engineInstance = null
}
