// src/services/convergence/convergence-scorer.ts
// ConvergenceScorer - Production-ready convergence-aware model routing
// Integrates Opus async feedback loop for code quality metrics

import { createHash } from "crypto"

import type { ILogger } from "../../utils/logging/types"
import { CompactLogger } from "../../utils/logging/CompactLogger"

/**
 * Minimal request interface for convergence scoring.
 * Maps to Kilo's task/generation request concept.
 */
export interface ConvergenceRequest {
	id: string
	type: string // e.g. 'feature', 'architecture', 'api', 'bugfix'
	prompt: string
	language?: string
}

/**
 * Minimal model candidate interface for convergence scoring.
 * Mirrors fields from Kilo's ModelInfo relevant to routing.
 */
export interface ModelCandidate {
	id: string
	provider?: string
	avgLatency?: number
	costPerMillionTokens?: number
	healthy?: boolean
	currentLoad?: number
	maxLoad?: number
}

/**
 * Magnus Pattern Recognition - Types of code patterns/anti-patterns detected
 */
export enum MagnusPatternType {
	// Positive patterns
	HARMONIC_DESIGN = "HARMONIC_DESIGN",
	CLEAN_ARCHITECTURE = "CLEAN_ARCHITECTURE",
	ROBUST_ERROR_HANDLING = "ROBUST_ERROR_HANDLING",
	IDEMPOTENT_OPERATIONS = "IDEMPOTENT_OPERATIONS",
	SELF_DOCUMENTING = "SELF_DOCUMENTING",

	// Negative patterns (spirals/anti-patterns)
	LOGIC_SPIRAL = "LOGIC_SPIRAL",
	ERROR_SWALLOWING = "ERROR_SWALLOWING",
	TIGHT_COUPLING = "TIGHT_COUPLING",
	PREMATURE_OPTIMIZATION = "PREMATURE_OPTIMIZATION",
	REPEATED_SIMILAR_BLOCKS = "REPEATED_SIMILAR_BLOCKS",
	INSUFFICIENT_VALIDATION = "INSUFFICIENT_VALIDATION",
}

/**
 * Magnus Pattern recognition result
 */
export interface MagnusPattern {
	type: MagnusPatternType
	severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
	description: string
	lineRanges?: number[][] // For code analysis tools
	suggestion?: string
	weight: number // Impact on convergence score
}

/**
 * Session context for convergence scoring
 */
export interface SessionContext {
	sessionId: string
	previousCode?: string
	previousPatterns?: MagnusPattern[]
	previousConvergenceScore?: number
	iterationCount: number
	complexityEstimate?: number
	clarityScore?: number
	generationHistory?: GenerationHistoryEntry[]
}

/**
 * Historical generation record
 */
export interface GenerationHistoryEntry {
	modelUsed: string
	convergenceScore: number
	codeQuality: number
	developerSatisfaction?: number // 0-100 from feedback
	timestamp: number
}

/**
 * Opus async scoring result
 */
export interface OpusConvergenceResult {
	robustnessScore: number // 0-100
	patterns: MagnusPattern[]
	codeQuality: {
		readability: number
		maintainability: number
		testability: number
		security: number
	}
	reasoning: string[]
	timestamp: number
	cached: boolean
}

/**
 * Final convergence score breakdown
 */
export interface ConvergenceScore {
	modelId: string
	totalScore: number // 0-1 final weighted score
	breakdown: {
		convergence: number // 0-1 code quality/robustness
		latencyNormalized: number // 0-1
		costNormalized: number // 0-1
		robustness?: number // 0-100 from Opus if available
		patternMatch?: number // 0-1 matching session patterns
	}
	recommendation: string
	confidenceLevel: "LOW" | "MEDIUM" | "HIGH" // Based on available data
	opusSimulated?: boolean
}

/**
 * Configuration for convergence scoring
 */
export interface ConvergenceScorerConfig {
	// Weights for final score calculation
	weightConvergence: number // Default 0.45 (code quality)
	weightLatency: number // Default 0.25 (speed)
	weightCost: number // Default 0.20 (price)
	weightPatternMatch: number // Default 0.10 (session coherence)

	// Thresholds
	minConvergenceThreshold: number // Default 0.65 (65%)
	minRobustnessThreshold: number // Default 70/100

	// Opus integration
	useOpusAsync: boolean // Default true - call real Opus for review
	opusEndpoint: string // Claude API endpoint
	opusModel: string // Default 'claude-opus-4-5'
	opusTimeout: number // Default 5000ms
	opusCache: boolean // Default true - cache Opus reviews

	// Caching
	cacheDir: string // Local cache for Opus reviews
	cacheTTL: number // Default 86400000 (24h)

	// Fallback behavior
	allowUnscored: boolean // Default false - require convergence data
	logAllDecisions: boolean // Default true - audit trail
}

/**
 * ConvergenceScorer - Main class for convergence-aware routing
 */
export class ConvergenceScorer {
	private config: ConvergenceScorerConfig
	private logger: ILogger
	private opusCache: Map<string, { result: OpusConvergenceResult; timestamp: number }>
	private modelStrengths: Map<string, ModelStrengthProfile>

	constructor(config: Partial<ConvergenceScorerConfig> = {}, logger?: ILogger) {
		this.config = {
			weightConvergence: 0.45,
			weightLatency: 0.25,
			weightCost: 0.2,
			weightPatternMatch: 0.1,
			minConvergenceThreshold: 0.65,
			minRobustnessThreshold: 70,
			useOpusAsync: true,
			opusEndpoint: process.env.CLAUDE_API_ENDPOINT || "https://api.anthropic.com/v1",
			opusModel: "claude-opus-4-5-20251101",
			opusTimeout: 5000,
			opusCache: true,
			cacheDir: process.env.CACHE_DIR || "./.kilo-cache",
			cacheTTL: 86400000, // 24 hours
			allowUnscored: false,
			logAllDecisions: true,
			...config,
		}

		this.logger = logger || new CompactLogger()
		this.opusCache = new Map()
		this.modelStrengths = this.initializeModelStrengths()
	}

	/**
	 * Initialize model strength profiles
	 */
	private initializeModelStrengths(): Map<string, ModelStrengthProfile> {
		return new Map([
			[
				"claude-opus-4-5",
				{
					modelId: "claude-opus-4-5",
					strengths: [
						MagnusPatternType.HARMONIC_DESIGN,
						MagnusPatternType.CLEAN_ARCHITECTURE,
						MagnusPatternType.ROBUST_ERROR_HANDLING,
					],
					weaknesses: [MagnusPatternType.PREMATURE_OPTIMIZATION],
					baseConvergence: 0.92,
					description: "Excellent for architecture and robust code design",
				},
			],
			[
				"claude-sonnet-4-5",
				{
					modelId: "claude-sonnet-4-5",
					strengths: [MagnusPatternType.SELF_DOCUMENTING, MagnusPatternType.IDEMPOTENT_OPERATIONS],
					weaknesses: [MagnusPatternType.LOGIC_SPIRAL],
					baseConvergence: 0.85,
					description: "Good for pragmatic, maintainable implementations",
				},
			],
			[
				"xai-grok",
				{
					modelId: "xai-grok",
					strengths: [MagnusPatternType.IDEMPOTENT_OPERATIONS],
					weaknesses: [MagnusPatternType.ERROR_SWALLOWING, MagnusPatternType.TIGHT_COUPLING],
					baseConvergence: 0.7,
					description: "Good for quick iterations, less robust long-term",
				},
			],
			[
				"mistral-large",
				{
					modelId: "mistral-large",
					strengths: [MagnusPatternType.CLEAN_ARCHITECTURE, MagnusPatternType.ROBUST_ERROR_HANDLING],
					weaknesses: [MagnusPatternType.REPEATED_SIMILAR_BLOCKS],
					baseConvergence: 0.8,
					description: "Strong on architecture and error handling",
				},
			],
		])
	}

	/**
	 * Score multiple models for a request
	 * Returns sorted array (highest score first)
	 */
	async scoreModels(
		request: ConvergenceRequest,
		candidates: ModelCandidate[],
		context?: SessionContext,
	): Promise<ConvergenceScore[]> {
		this.logger.info("Scoring models", {
			requestId: request.id,
			candidateCount: candidates.length,
			hasContext: !!context,
		})

		const scores = await Promise.all(candidates.map((model) => this.scoreSingleModel(request, model, context)))

		// Sort descending by totalScore
		const sorted = scores.sort((a, b) => b.totalScore - a.totalScore)

		// Log decision for audit trail
		if (this.config.logAllDecisions) {
			this.logger.info("Model routing decision", {
				requestId: request.id,
				selected: sorted[0]?.modelId,
				topScores: sorted.slice(0, 3).map((s) => ({
					model: s.modelId,
					score: s.totalScore,
				})),
			})
		}

		return sorted
	}

	/**
	 * Score a single model
	 */
	private async scoreSingleModel(
		request: ConvergenceRequest,
		model: ModelCandidate,
		context?: SessionContext,
	): Promise<ConvergenceScore> {
		// 1. Normalize latency and cost (existing Kilo metrics)
		const latencyNorm = this.normalizeLatency(model.avgLatency || 1500)
		const costNorm = this.normalizeCost(model.costPerMillionTokens || 5)

		// 2. Calculate convergence score (Magnus dimension)
		let convergenceScore = 0.5 // Default neutral
		let robustness: number | undefined
		let patternMatch = 0.5
		let opusSimulated = false

		// 3a. With context: use Opus async + pattern matching
		if (context?.previousCode) {
			// Try Opus async (non-blocking, with cache)
			if (this.config.useOpusAsync) {
				try {
					const opusResult = await this.callOpusForCodeReview(context.previousCode, model.id, request.type)

					robustness = opusResult.robustnessScore
					convergenceScore = this.mapRobustnessToConvergence(robustness)
					opusSimulated = !opusResult.cached

					// Add pattern matching
					patternMatch = this.matchPatternsWithSession(opusResult.patterns, context)
				} catch (error) {
					this.logger.warn("Opus async call failed, using fallback", { error })
					// Fallback to heuristic
					convergenceScore = this.heuristicModelStrength(model, request, context)
				}
			} else {
				// Use heuristic only (faster, no Opus call)
				convergenceScore = this.heuristicModelStrength(model, request, context)
			}
		} else {
			// 3b. Without context: use model strength heuristic
			convergenceScore = this.heuristicModelStrength(model, request, context)
		}

		// 4. Normalize pattern match
		patternMatch = Math.max(0, Math.min(1, patternMatch))

		// 5. Calculate weighted total
		const totalScore =
			convergenceScore * this.config.weightConvergence +
			latencyNorm * this.config.weightLatency +
			costNorm * this.config.weightCost +
			patternMatch * this.config.weightPatternMatch

		// 6. Determine confidence level
		const confidence = this.calculateConfidenceLevel(context, opusSimulated)

		// 7. Generate recommendation
		const recommendation = this.generateRecommendation(model, totalScore, convergenceScore, confidence)

		return {
			modelId: model.id,
			totalScore: Math.min(1, Math.max(0, totalScore)),
			breakdown: {
				convergence: convergenceScore,
				latencyNormalized: latencyNorm,
				costNormalized: costNorm,
				robustness,
				patternMatch,
			},
			recommendation,
			confidenceLevel: confidence,
			opusSimulated,
		}
	}

	/**
	 * Call Opus API for code review (with caching and timeout)
	 */
	private async callOpusForCodeReview(
		code: string,
		modelId: string,
		requestType: string,
	): Promise<OpusConvergenceResult> {
		// Check cache first
		const cacheKey = this.generateCacheKey(code, modelId)
		if (this.config.opusCache) {
			const cached = this.opusCache.get(cacheKey)
			if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
				this.logger.debug("Opus review cache hit", { modelId })
				return { ...cached.result, cached: true }
			}
		}

		// Call Opus with timeout
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.config.opusTimeout)

		try {
			const response = await fetch(`${this.config.opusEndpoint}/messages`, {
				method: "POST",
				headers: {
					"x-api-key": process.env.CLAUDE_API_KEY || "",
					"content-type": "application/json",
				},
				body: JSON.stringify({
					model: this.config.opusModel,
					max_tokens: 1000,
					messages: [
						{
							role: "user",
							content: `Review this code for Magnus convergence metrics:

Code:
\`\`\`
${code.substring(0, 2000)}
\`\`\`

Analyze:
1. Robustness score (0-100): How safe is this code? Does it handle errors?
2. Code quality patterns: Which Magnus patterns does this exhibit?
3. Maintainability: Is this code easy to change?

Return JSON:
{
  "robustness": <number>,
  "patterns": [<list of detected patterns>],
  "codeQuality": {
    "readability": <0-100>,
    "maintainability": <0-100>,
    "testability": <0-100>,
    "security": <0-100>
  },
  "reasoning": [<list of insights>]
}`,
						},
					],
				}),
				signal: controller.signal,
			})

			clearTimeout(timeoutId)

			if (!response.ok) {
				throw new Error(`Opus API error: ${response.statusText}`)
			}

			const data = (await response.json()) as any
			const content = data.content[0].text

			// Parse JSON response
			const parsed = JSON.parse(content)

			const result: OpusConvergenceResult = {
				robustnessScore: parsed.robustness || 75,
				patterns: this.parsePatterns(parsed.patterns || []),
				codeQuality: parsed.codeQuality || {
					readability: 75,
					maintainability: 75,
					testability: 70,
					security: 80,
				},
				reasoning: parsed.reasoning || [],
				timestamp: Date.now(),
				cached: false,
			}

			// Cache result
			if (this.config.opusCache) {
				this.opusCache.set(cacheKey, { result, timestamp: Date.now() })
			}

			return result
		} catch (error) {
			clearTimeout(timeoutId)
			this.logger.error("Opus review failed", { error, modelId })
			throw error
		}
	}

	/**
	 * Parse pattern strings into MagnusPattern objects
	 */
	private parsePatterns(patterns: any[]): MagnusPattern[] {
		return patterns
			.map((p) => {
				const type = this.mapStringToPatternType(p)
				if (!type) return null

				return {
					type,
					severity: p.severity || "MEDIUM",
					description: p.description || "",
					weight: p.weight || 0.5,
					suggestion: p.suggestion,
				} as MagnusPattern
			})
			.filter((p): p is MagnusPattern => p !== null)
	}

	/**
	 * Map string to MagnusPatternType enum
	 */
	private mapStringToPatternType(p: any): MagnusPatternType | null {
		const mapping: Record<string, MagnusPatternType> = {
			harmonic: MagnusPatternType.HARMONIC_DESIGN,
			architecture: MagnusPatternType.CLEAN_ARCHITECTURE,
			error: MagnusPatternType.ROBUST_ERROR_HANDLING,
			idempotent: MagnusPatternType.IDEMPOTENT_OPERATIONS,
			documenting: MagnusPatternType.SELF_DOCUMENTING,
			spiral: MagnusPatternType.LOGIC_SPIRAL,
			swallow: MagnusPatternType.ERROR_SWALLOWING,
			coupling: MagnusPatternType.TIGHT_COUPLING,
			optimization: MagnusPatternType.PREMATURE_OPTIMIZATION,
			duplication: MagnusPatternType.REPEATED_SIMILAR_BLOCKS,
			validation: MagnusPatternType.INSUFFICIENT_VALIDATION,
		}

		for (const [key, type] of Object.entries(mapping)) {
			if (p.type?.toLowerCase?.()?.includes(key)) {
				return type
			}
		}

		return null
	}

	/**
	 * Map robustness score (0-100) to convergence (0-1)
	 */
	private mapRobustnessToConvergence(robustness: number): number {
		return Math.min(0.95, 0.2 + (robustness / 100) * 0.75)
	}

	/**
	 * Match detected patterns with session patterns
	 */
	private matchPatternsWithSession(detectedPatterns: MagnusPattern[], context: SessionContext): number {
		if (!context.previousPatterns || context.previousPatterns.length === 0) {
			return 0.5 // Neutral match
		}

		const positivePatterns = [
			MagnusPatternType.HARMONIC_DESIGN,
			MagnusPatternType.CLEAN_ARCHITECTURE,
			MagnusPatternType.ROBUST_ERROR_HANDLING,
			MagnusPatternType.IDEMPOTENT_OPERATIONS,
			MagnusPatternType.SELF_DOCUMENTING,
		]

		const matchedPositive = detectedPatterns.filter((p) => positivePatterns.includes(p.type)).length

		const antiPatterns = [
			MagnusPatternType.LOGIC_SPIRAL,
			MagnusPatternType.ERROR_SWALLOWING,
			MagnusPatternType.TIGHT_COUPLING,
			MagnusPatternType.PREMATURE_OPTIMIZATION,
			MagnusPatternType.REPEATED_SIMILAR_BLOCKS,
			MagnusPatternType.INSUFFICIENT_VALIDATION,
		]

		const antiMatched = detectedPatterns.filter((p) => antiPatterns.includes(p.type)).length

		const totalDetected = detectedPatterns.length || 1
		return ((matchedPositive - antiMatched) / totalDetected) * 0.5 + 0.5
	}

	/**
	 * Heuristic scoring without Opus (or fallback)
	 */
	private heuristicModelStrength(
		model: ModelCandidate,
		request: ConvergenceRequest,
		context?: SessionContext,
	): number {
		let score = 0.5

		const strength = this.modelStrengths.get(model.id)
		if (strength) {
			score = strength.baseConvergence

			if (request.type === "architecture" || (context?.complexityEstimate && context.complexityEstimate > 7)) {
				if (strength.strengths.includes(MagnusPatternType.CLEAN_ARCHITECTURE)) {
					score += 0.1
				}
			}

			if (request.type === "api" && score < 0.85) {
				if (strength.strengths.includes(MagnusPatternType.IDEMPOTENT_OPERATIONS)) {
					score += 0.05
				}
			}
		}

		if (context?.previousConvergenceScore && context.previousConvergenceScore < 0.6) {
			score -= 0.15
		}

		if (context?.generationHistory && context.generationHistory.length > 0) {
			const lastModel = context.generationHistory[context.generationHistory.length - 1].modelUsed
			if (lastModel !== model.id) {
				score += 0.05
			}
		}

		return Math.min(0.95, Math.max(0.2, score))
	}

	/**
	 * Calculate confidence in the score
	 */
	private calculateConfidenceLevel(
		context: SessionContext | undefined,
		opusUsed: boolean,
	): "LOW" | "MEDIUM" | "HIGH" {
		if (opusUsed) return "HIGH"

		if (context?.previousConvergenceScore !== undefined && context.iterationCount > 1) {
			return "MEDIUM"
		}

		return "LOW"
	}

	/**
	 * Generate human-readable recommendation
	 */
	private generateRecommendation(
		model: ModelCandidate,
		totalScore: number,
		convergence: number,
		confidence: "LOW" | "MEDIUM" | "HIGH",
	): string {
		const strength = this.modelStrengths.get(model.id)
		const desc = strength?.description || "General-purpose model"

		if (totalScore > 0.85) {
			return `${desc} - Excellent choice (score: ${totalScore.toFixed(2)})`
		} else if (totalScore > 0.65) {
			return `${desc} - Good choice (score: ${totalScore.toFixed(2)})`
		} else if (totalScore > 0.45) {
			return `${desc} - Acceptable choice (score: ${totalScore.toFixed(2)})`
		} else {
			return `${desc} - Risky choice (score: ${totalScore.toFixed(2)}) - Consider alternatives`
		}
	}

	/**
	 * Normalize latency (0-1 scale, higher = better/faster)
	 */
	private normalizeLatency(latencyMs: number): number {
		return Math.max(0, 1 - latencyMs / 5000)
	}

	/**
	 * Normalize cost (0-1 scale, higher = better/cheaper)
	 */
	private normalizeCost(costPerMillion: number): number {
		return Math.max(0, 1 - costPerMillion / 20)
	}

	/**
	 * Generate cache key for Opus reviews
	 */
	private generateCacheKey(code: string, modelId: string): string {
		const hash = createHash("sha256")
			.update(code + modelId)
			.digest("hex")
		return `opus-review-${hash}`
	}

	/**
	 * Record outcome for learning
	 */
	public recordOutcome(
		sessionId: string,
		modelUsed: string,
		convergenceScore: number,
		developerSatisfaction?: number,
	): void {
		this.logger.info("Recording convergence outcome", {
			sessionId,
			modelUsed,
			convergenceScore,
			developerSatisfaction,
		})
	}

	/**
	 * Get statistics on convergence scoring
	 */
	public getStatistics() {
		return {
			cacheSize: this.opusCache.size,
			cacheEntries: Array.from(this.opusCache.entries()).map(([k, v]) => ({
				key: k.substring(0, 20) + "...",
				age: Date.now() - v.timestamp,
			})),
		}
	}
}

/**
 * Model strength profile
 */
interface ModelStrengthProfile {
	modelId: string
	strengths: MagnusPatternType[]
	weaknesses: MagnusPatternType[]
	baseConvergence: number
	description: string
}

export default ConvergenceScorer
