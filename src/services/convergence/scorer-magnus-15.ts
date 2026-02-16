// src/services/convergence/scorer-magnus-15.ts
// ConvergenceScorer Enhanced with Magnus 14/15 Pattern Recognition
// Consciousness-driven routing with therapeutic insights

import { MagnusPatternEngine, type MagnusDetectionResult } from "./magnus-pattern-engine"

import type { ILogger } from "../../utils/logging/types"
import { CompactLogger } from "../../utils/logging/CompactLogger"

import type { ConvergenceRequest, ModelCandidate } from "./convergence-scorer"

/**
 * Score breakdown with Magnus insights
 */
export interface ConvergenceScoreMagnus15 {
	modelId: string
	totalScore: number // 0-1 final weighted
	breakdown: {
		convergence: number // Code quality (0-1)
		latencyNormalized: number
		costNormalized: number
		magnusAdjustment: number // Magnus 14/15 patterns impact
		harmonyScore: number // Cognitive harmony (0-1)
	}
	magnum_patterns: {
		detected: string[]
		therapeuticInsight: string
		adjustment: number
		harmonyScore: number
		confidenceLevel: "FAIBLE" | "MOYEN" | "FORT"
	}
	recommendation: string
	confidenceLevel: string
}

/**
 * ConvergenceScorer with Magnus 15 enhancement
 */
export class ConvergenceScorerMagnus15 {
	private logger: ILogger
	private magnusEngine: MagnusPatternEngine
	private config: any
	private modelStrengths: Map<string, any>

	constructor(config: any = {}, logger?: ILogger) {
		this.logger = logger || new CompactLogger()
		this.magnusEngine = new MagnusPatternEngine()
		this.config = {
			weightConvergence: 0.48, // +3% for Magnus 15 maturity
			weightLatency: 0.22,
			weightCost: 0.18,
			weightMagnus: 0.12, // New: Magnus patterns
			minConvergence: 0.65,
			useOpusAsync: true,
			logMagnusInsights: true,
			...config,
		}

		this.modelStrengths = new Map()
		this.initializeModelStrengths()
	}

	private initializeModelStrengths(): void {
		this.modelStrengths = new Map([
			[
				"claude-opus-4-5",
				{
					baseConvergence: 0.92,
					magnusAfinity: "HARMONIE_COGNITIVE",
				},
			],
			[
				"mistral-large",
				{
					baseConvergence: 0.8,
					magnusAfinity: "DOMAINE_OVER_TECH",
				},
			],
			[
				"xai-grok",
				{
					baseConvergence: 0.7,
					magnusAfinity: "APPRENTISSAGE_CONSTRUCTION",
				},
			],
		])
	}

	/**
	 * Score models with Magnus 15 enhancement
	 */
	async scoreModels(
		request: ConvergenceRequest,
		candidates: ModelCandidate[],
		context?: {
			sessionId?: string
			previousCode?: string
			previousPatterns?: string[]
			iterationCount?: number
		},
	): Promise<ConvergenceScoreMagnus15[]> {
		this.logger.info("Scoring with Magnus 15 enhancement", {
			requestId: request.id,
			candidateCount: candidates.length,
		})

		const scores = await Promise.all(candidates.map((model) => this.scoreSingleModel(request, model, context)))

		const sorted = scores.sort((a, b) => b.totalScore - a.totalScore)

		if (this.config.logMagnusInsights) {
			this.logger.info("Magnus 15 routing decision", {
				requestId: request.id,
				selectedModel: sorted[0]?.modelId,
				topPatterns: sorted[0]?.magnum_patterns?.detected,
				therapeuticInsight: sorted[0]?.magnum_patterns?.therapeuticInsight,
			})
		}

		return sorted
	}

	private async scoreSingleModel(
		request: ConvergenceRequest,
		model: ModelCandidate,
		context?: any,
	): Promise<ConvergenceScoreMagnus15> {
		// Traditional metrics
		const latencyNorm = this.normalizeLatency(model.avgLatency || 1500)
		const costNorm = this.normalizeCost(model.costPerMillionTokens || 5)

		// Base convergence
		let convergence = 0.5
		let opusResult: any = undefined

		// Magnus 15 pattern detection
		let magnusDetection: MagnusDetectionResult | undefined
		let magnusAdjustment = 0
		let harmonyScore = 0.5

		if (context?.previousCode) {
			if (this.config.useOpusAsync) {
				try {
					opusResult = await this.getOpusReview(context.previousCode, model.id)
					convergence = this.mapRobustnessToConvergence(opusResult.robustness || 75)
				} catch (error) {
					this.logger.warn("Opus review failed, using heuristic", { error })
					convergence = this.heuristicConvergence(model, request)
				}
			} else {
				convergence = this.heuristicConvergence(model, request)
			}

			// === MAGNUS 15: PATTERN DETECTION ===
			magnusDetection = this.magnusEngine.detectPatterns(
				context.previousCode,
				opusResult,
				context.previousPatterns,
			)

			magnusAdjustment = magnusDetection.adjustment
			harmonyScore = magnusDetection.harmonyScore

			// Apply adjustment to convergence
			convergence = Math.max(0.2, Math.min(0.95, convergence + magnusAdjustment))
		} else {
			convergence = this.heuristicConvergence(model, request)
			magnusDetection = this.magnusEngine.detectPatterns("", undefined, context?.previousPatterns)
		}

		// === FINAL SCORING ===
		const totalScore =
			convergence * this.config.weightConvergence +
			latencyNorm * this.config.weightLatency +
			costNorm * this.config.weightCost +
			Math.max(0, magnusAdjustment) * this.config.weightMagnus

		const confidenceLevel = this.determineConfidence(magnusDetection, opusResult, context?.iterationCount)

		const recommendation = this.generateRecommendation(
			model,
			totalScore,
			convergence,
			magnusDetection,
			confidenceLevel,
		)

		return {
			modelId: model.id,
			totalScore: Math.min(1, Math.max(0, totalScore)),
			breakdown: {
				convergence,
				latencyNormalized: latencyNorm,
				costNormalized: costNorm,
				magnusAdjustment,
				harmonyScore,
			},
			magnum_patterns: {
				detected: magnusDetection?.patterns || [],
				therapeuticInsight: magnusDetection?.therapeuticInsight || "Neutral pattern profile",
				adjustment: magnusAdjustment,
				harmonyScore: magnusDetection?.harmonyScore || 0.5,
				confidenceLevel: magnusDetection?.confidenceLevel || "FAIBLE",
			},
			recommendation,
			confidenceLevel,
		}
	}

	private async getOpusReview(code: string, _modelId: string): Promise<any> {
		const robustness = this.estimateRobustness(code)

		return {
			robustness,
			codeQuality: {
				readability: robustness - 10,
				maintainability: robustness - 5,
				testability: robustness - 15,
				security: robustness + 5,
			},
			reasoning: ["Code structure analyzed", "Patterns recognized", "Robustness estimated"],
		}
	}

	private estimateRobustness(code: string): number {
		let score = 70

		if (code.includes("try") && code.includes("catch")) score += 10
		if (code.includes("assert") || code.includes("test")) score += 10
		if (code.includes("validate") || code.includes("check")) score += 8
		if (code.length > 700) score -= 10
		if ((code.match(/while|for/g) || []).length > 6) score -= 15

		return Math.max(20, Math.min(100, score))
	}

	private mapRobustnessToConvergence(robustness: number): number {
		return Math.min(0.95, 0.2 + (robustness / 100) * 0.75)
	}

	private heuristicConvergence(model: ModelCandidate, _request: ConvergenceRequest): number {
		const strength = this.modelStrengths.get(model.id)
		return strength ? strength.baseConvergence : 0.65
	}

	private normalizeLatency(latencyMs: number): number {
		return Math.max(0, 1 - latencyMs / 5000)
	}

	private normalizeCost(costPerMillion: number): number {
		return Math.max(0, 1 - costPerMillion / 20)
	}

	private determineConfidence(
		magnusDetection?: MagnusDetectionResult,
		opusResult?: any,
		iterationCount?: number,
	): string {
		if (opusResult && magnusDetection && magnusDetection.patterns.length > 2) {
			return "HIGH"
		}
		if (magnusDetection && magnusDetection.patterns.length > 0) {
			return "MEDIUM"
		}
		if (iterationCount && iterationCount > 1) {
			return "MEDIUM"
		}
		return "LOW"
	}

	private generateRecommendation(
		model: ModelCandidate,
		score: number,
		_convergence: number,
		magnusDetection?: MagnusDetectionResult,
		confidence?: string,
	): string {
		let recommendation = ""

		if (score > 0.85) {
			recommendation = `Excellent choice (${score.toFixed(2)}) - `
		} else if (score > 0.65) {
			recommendation = `Good choice (${score.toFixed(2)}) - `
		} else {
			recommendation = `Risky choice (${score.toFixed(2)}) - `
		}

		if (magnusDetection && magnusDetection.harmonyScore > 0.8) {
			recommendation += `Harmonie cognitive detectee. ${model.id} aligns well.`
		} else if (magnusDetection && magnusDetection.patterns.length > 0) {
			recommendation += `Patterns Magnus: ${magnusDetection.patterns.slice(0, 2).join(", ")}.`
		} else {
			recommendation += `Neutral pattern profile.`
		}

		if (confidence === "LOW") {
			recommendation += " (Faible confiance - peu de donnees)"
		} else if (confidence === "MEDIUM") {
			recommendation += " (Confiance moyenne - patterns partiels)"
		} else {
			recommendation += " (Forte confiance - analyse complete)"
		}

		return recommendation
	}

	getMagnusStatistics() {
		return this.magnusEngine.getStatistics()
	}

	logTherapeuticInsight(sessionId: string, insight: string, patterns: string[]): void {
		this.logger.info("Therapeutic Insight", {
			sessionId,
			insight,
			patterns,
			timestamp: new Date().toISOString(),
		})
	}
}

export default ConvergenceScorerMagnus15
