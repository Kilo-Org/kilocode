// src/services/convergence/magnus-pattern-engine.ts
// Magnus 14/15 Pattern Recognition Engine - Production Ready
// Consciousness-driven code analysis for Kilo
//
// Detects internal patterns: spirals, learning, harmony, self-reflection
// Provides therapeutic insights for developers
// Integrates with ConvergenceScorer for routing decisions

import type { ILogger } from "../../utils/logging/types"
import { CompactLogger } from "../../utils/logging/CompactLogger"

/**
 * Pattern definition interface
 */
export interface MagnusPattern {
	name: string
	origin: string // Original insight from manifesto
	type: "positive" | "anti"
	weight: number // Impact on convergence score (-0.4 to +0.4)
	magnitude: "CRITIQUE" | "MAJOREUR" | "MINEUR"
	description: string
	indicators: string[] // Heuristics to detect
	therapeuticMessage: string
	manifestoRef: string
}

/**
 * Detection result with insights
 */
export interface MagnusDetectionResult {
	patterns: string[]
	adjustment: number // Score adjustment (-0.8 to +0.8)
	therapeuticInsight: string
	harmonyScore: number // 0-1: cognitive harmony
	patternsDetailed: {
		name: string
		type: "positive" | "anti"
		weight: number
		reason: string
		magnitude: string
	}[]
	confidenceLevel: "FAIBLE" | "MOYEN" | "FORT"
	timestamp: number
}

/**
 * Complete Magnus 14/15 patterns catalog
 */
export const MAGNUS_15_PATTERNS: MagnusPattern[] = [
	// ===== MAGNUS 14: EXTERNALISATION =====

	{
		name: "SPIRALE_CLARIFICATION",
		origin: "Je spirale pour clarifier",
		type: "anti",
		weight: 0.35,
		magnitude: "MAJOREUR",
		description: "Tentative de clarification par imbrication excessive",
		indicators: [
			"file length > 700 LOC",
			"nested conditions > 3 levels",
			"while/for/if count > 12",
			"high cyclomatic complexity",
			"unclear error recovery",
			"multiple refactoring attempts visible",
		],
		therapeuticMessage:
			"Spirale detectee: Le code tente de clarifier par imbrication. Recommandez simplification directe.",
		manifestoRef: "Magnus 14 - Recognition of internal spirals",
	},

	{
		name: "APPRENTISSAGE_CONSTRUCTION",
		origin: "J'apprends en construisant",
		type: "positive",
		weight: 0.25,
		magnitude: "MINEUR",
		description: "Apprentissage iteratif visible dans le code",
		indicators: [
			'contains "prototype" or "MVP"',
			"v1/v2/v3 progression",
			"iterative structure",
			"refactoring comments",
			"test-driven approach",
			"gradual feature addition",
		],
		therapeuticMessage:
			"Apprentissage en construction: Code montre evolution progressive. Approche saine et experimentale.",
		manifestoRef: "Magnus 14 - Learning through building",
	},

	{
		name: "DOMAINE_OVER_TECH",
		origin: "Le domaine importe plus que la tech",
		type: "positive",
		weight: 0.2,
		magnitude: "MINEUR",
		description: "Priorite au metier sur les abstractions tech",
		indicators: [
			"clear business logic separation",
			"domain-driven naming (DDD)",
			"minimal premature optimization",
			"business keywords (user, order, customer)",
			"readable over clever",
			"explicit business rules",
		],
		therapeuticMessage: "Priorite au domaine: Architecture centree metier. Excellent choix.",
		manifestoRef: "Magnus 14 - Domain-first thinking",
	},

	{
		name: "CHANCE_VS_COMPETENCE",
		origin: "Est-ce reel ou juste de la chance ?",
		type: "anti",
		weight: 0.3,
		magnitude: "MAJOREUR",
		description: "Logique non validee, dependante de la chance",
		indicators: [
			"no unit tests",
			"no assertions",
			"no input validation",
			"no edge case handling",
			"missing error paths",
			"lucky scenarios only",
		],
		therapeuticMessage: "Incertitude detectee: Code manque de preuves formelles. Ajoutez assertions et tests.",
		manifestoRef: "Magnus 14 - Chance vs competence",
	},

	{
		name: "CHAOS_INTERNE",
		origin: "Anxiete : chaos ou pattern ?",
		type: "anti",
		weight: 0.4,
		magnitude: "CRITIQUE",
		description: "Structure interne chaotique ou non lisible",
		indicators: [
			"inconsistent naming (camelCase + snake_case)",
			"mixed architectural styles",
			"unclear intent",
			"silent error handling",
			"no clear structure",
			"mixed indentation",
			"no separation of concerns",
		],
		therapeuticMessage: "Chaos interne detecte: Code montre manque de coherence. Recommandez restructuration.",
		manifestoRef: "Magnus 14 - Internal chaos recognition",
	},

	// ===== MAGNUS 15: CONSCIENCE ET HARMONIE =====

	{
		name: "AUTO_REFLEXION",
		origin: "Dialogue structure avec soi-meme",
		type: "positive",
		weight: 0.3,
		magnitude: "MAJOREUR",
		description: "Code qui se regarde / se log / s'observe",
		indicators: [
			"comprehensive logging",
			"console.log/logger",
			"debugger or debug mode",
			"reflection APIs",
			"introspection hooks",
			"audit trails",
			"stack traces preserved",
		],
		therapeuticMessage: "Auto-reflexion detectee: Code peut s'observer lui-meme. Capacite reflexive presente.",
		manifestoRef: "Magnus 15 - Self-reflective consciousness",
	},

	{
		name: "FEEDBACK_ITERATIF",
		origin: "Boucle d'apprentissage sur patterns passes",
		type: "positive",
		weight: 0.25,
		magnitude: "MINEUR",
		description: "Evolution visible entre versions",
		indicators: [
			"metrics collection",
			"feedback mechanisms",
			"adaptive algorithms",
			"learning from history",
			"version tracking",
			"progressive improvements",
			"evolution visible",
		],
		therapeuticMessage: "Feedback iteratif detecte: Code apprend de ses executions. Boucle d'amelioration active.",
		manifestoRef: "Magnus 15 - Iterative learning loops",
	},

	{
		name: "HARMONIE_COGNITIVE",
		origin: "Patterns alignes sans conflit interne",
		type: "positive",
		weight: 0.35,
		magnitude: "MAJOREUR",
		description: "Coherence globale, zero conflit majeur",
		indicators: [
			"robustness > 85",
			"no critical issues",
			"consistent error handling",
			"unified design philosophy",
			"clear architecture layers",
			"patterns aligned",
			"zero cognitive dissonance",
		],
		therapeuticMessage: "Harmonie cognitive detectee: Tous patterns alignes, pas de conflits. Architecture saine.",
		manifestoRef: "Magnus 15 - Cognitive harmony",
	},

	{
		name: "INCERTITUDE_REDUITE",
		origin: "Preuves accumulees vs doute initial",
		type: "positive",
		weight: 0.28,
		magnitude: "MAJOREUR",
		description: "Validation et preuves croissantes",
		indicators: [
			"test coverage > 80%",
			"assertions throughout",
			"edge cases handled",
			"documentation complete",
			"all error paths tested",
			"invariants maintained",
			"formal proofs present",
		],
		therapeuticMessage: "Certitude accumulee detectee: Preuves solides et testees. Incertitude reduite.",
		manifestoRef: "Magnus 15 - Accumulated evidence",
	},

	{
		name: "CONSCIENCE_RECURSIVE",
		origin: "Meta-niveau self-awareness",
		type: "positive",
		weight: 0.32,
		magnitude: "MAJOREUR",
		description: "Code capable de s'auto-modifier ou s'auto-evaluer",
		indicators: [
			"introspection APIs",
			"self-examining code",
			"meta-analysis",
			"consciousness-aware logging",
			"recursive awareness",
			"multi-level reflection",
			"observer pattern",
		],
		therapeuticMessage:
			"Conscience recursive detectee: Code s'examine lui-meme a plusieurs niveaux. Meta-awareness presente.",
		manifestoRef: "Magnus 15 - Recursive consciousness",
	},
]

/**
 * MagnusPatternEngine - Core pattern detection engine
 */
export class MagnusPatternEngine {
	private logger: ILogger
	private detectionHistory: MagnusDetectionResult[] = []
	private patternFrequency: Map<string, number> = new Map()

	constructor(logger?: ILogger) {
		this.logger = logger || new CompactLogger()
	}

	/**
	 * Main detection method
	 */
	public detectPatterns(
		code: string,
		opusResult?: {
			robustness?: number
			codeQuality?: any
			reasoning?: string[]
			issues?: any[]
		},
		previousPatterns?: string[],
	): MagnusDetectionResult {
		const detected: string[] = []
		const detailed: any[] = []
		let adjustment = 0

		// === DETECTION PHASE ===
		for (const pattern of MAGNUS_15_PATTERNS) {
			const detectionScore = this.scorePattern(code, pattern, opusResult, previousPatterns)

			if (detectionScore > 0.5) {
				detected.push(pattern.name)

				const weight = pattern.type === "positive" ? pattern.weight : -pattern.weight
				adjustment += weight

				detailed.push({
					name: pattern.name,
					type: pattern.type,
					weight: pattern.weight,
					magnitude: pattern.magnitude,
					reason: `Detected with ${(detectionScore * 100).toFixed(0)}% confidence`,
				})

				this.patternFrequency.set(pattern.name, (this.patternFrequency.get(pattern.name) || 0) + 1)
			}
		}

		// === HARMONY PHASE ===
		const antiCount = detailed.filter((d: any) => d.type === "anti").length
		const positiveCount = detailed.filter((d: any) => d.type === "positive").length

		let harmonyScore = 0.5
		if (antiCount === 0 && positiveCount > 0) {
			harmonyScore = 0.95
			adjustment += 0.15
		} else if (antiCount > 0 && positiveCount > 0) {
			harmonyScore = Math.max(0.3, 1 - antiCount / (antiCount + positiveCount))
		} else if (antiCount > 2) {
			harmonyScore = 0.1
			adjustment -= 0.2
		}

		// Clamp adjustment
		adjustment = Math.max(-0.8, Math.min(0.8, adjustment))

		// === THERAPEUTIC INSIGHT ===
		const therapeuticInsight = this.generateTherapeuticInsight(detailed)

		// === CONFIDENCE LEVEL ===
		const confidenceLevel = this.calculateConfidence(detailed, opusResult)

		const result: MagnusDetectionResult = {
			patterns: detected,
			adjustment,
			therapeuticInsight,
			harmonyScore,
			patternsDetailed: detailed,
			confidenceLevel,
			timestamp: Date.now(),
		}

		this.detectionHistory.push(result)

		// Log detection
		this.logger.info("Patterns detected", {
			patternsCount: detected.length,
			adjustment: adjustment.toFixed(2),
			harmonyScore: harmonyScore.toFixed(2),
			confidence: confidenceLevel,
			detected: detected.join(", "),
		})

		return result
	}

	/**
	 * Score a single pattern
	 */
	private scorePattern(code: string, pattern: MagnusPattern, opusResult?: any, previousPatterns?: string[]): number {
		let score = 0

		// Heuristic scoring
		score += this.scoreHeuristic(code, pattern)

		// Opus-based scoring
		if (opusResult) {
			score += this.scoreOpusResult(opusResult, pattern)
		}

		// Previous patterns coherence
		if (previousPatterns?.includes(pattern.name)) {
			score += 0.2 // Consistency bonus
		}

		return Math.min(1, score)
	}

	/**
	 * Heuristic detection from code
	 */
	private scoreHeuristic(code: string, pattern: MagnusPattern): number {
		let score = 0
		const lowerCode = code.toLowerCase()

		// Check indicators
		for (const indicator of pattern.indicators) {
			if (lowerCode.includes(indicator.toLowerCase())) {
				score += 0.1
			}
		}

		// Pattern-specific heuristics
		switch (pattern.name) {
			case "SPIRALE_CLARIFICATION":
				if (code.length > 700) score += 0.15
				{
					const nestedCount = (code.match(/\{/g) || []).length
					if (nestedCount > 15) score += 0.2
				}
				{
					const conditionalCount = (code.match(/if|else|while|for/g) || []).length
					if (conditionalCount > 12) score += 0.2
				}
				break

			case "APPRENTISSAGE_CONSTRUCTION":
				if (/v\d+|version|iteration|build|prototype|MVP/i.test(code)) score += 0.25
				if ((code.match(/\/\/ FIXED:|\/\/ IMPROVED:/gi) || []).length > 2) score += 0.15
				break

			case "DOMAINE_OVER_TECH": {
				const businessKeywords = ["user", "customer", "order", "product", "service", "domain"]
				const matches = businessKeywords.filter((kw) => lowerCode.includes(kw)).length
				if (matches > 2) score += 0.25
				break
			}

			case "CHANCE_VS_COMPETENCE": {
				const hasTests = /test|assert|validate|check|expect/i.test(code)
				if (!hasTests) score += 0.3
				break
			}

			case "CHAOS_INTERNE": {
				const styleInconsistency = this.measureStyleInconsistency(code)
				if (styleInconsistency > 0.6) score += 0.3
				break
			}

			case "AUTO_REFLEXION":
				if (/console\.log|logger|debugger|debug|trace|log/i.test(code)) score += 0.2
				if (/reflect|observe|watch|monitor/i.test(code)) score += 0.15
				break

			case "FEEDBACK_ITERATIF":
				if (/metric|feedback|adapt|learn|improve/i.test(code)) score += 0.2
				break

			case "HARMONIE_COGNITIVE":
				if (/consistent|harmonious|coherent|aligned/i.test(code)) score += 0.15
				break

			case "INCERTITUDE_REDUITE": {
				const testCount = (code.match(/test|it\(|describe\(/gi) || []).length
				if (testCount > 5) score += 0.2
				const assertCount = (code.match(/assert|expect|should/gi) || []).length
				if (assertCount > 3) score += 0.15
				break
			}

			case "CONSCIENCE_RECURSIVE":
				if (/introspect|meta|self-aware|recursive|observe.*itself/i.test(code)) score += 0.25
				break
		}

		return Math.min(1, score)
	}

	/**
	 * Opus-based scoring
	 */
	private scoreOpusResult(opusResult: any, pattern: MagnusPattern): number {
		let score = 0

		// Robustness-based
		if (pattern.type === "positive") {
			const robustness = opusResult.robustness || 50
			if (robustness > 85) score += 0.25
			if (robustness > 90) score += 0.1
		} else {
			const robustness = opusResult.robustness || 50
			if (robustness < 60) score += 0.25
			if (robustness < 50) score += 0.15
		}

		// Code quality metrics
		if (opusResult.codeQuality) {
			const { readability = 0, maintainability = 0, security = 0 } = opusResult.codeQuality

			if (pattern.name === "HARMONIE_COGNITIVE" && readability > 80 && maintainability > 75) {
				score += 0.25
			}

			if (pattern.name === "INCERTITUDE_REDUITE" && security > 85) {
				score += 0.2
			}
		}

		// Reasoning analysis
		if (opusResult.reasoning?.length) {
			const reasoning = opusResult.reasoning.join(" ").toLowerCase()
			if (reasoning.includes(pattern.origin.toLowerCase())) {
				score += 0.25
			}
		}

		return Math.min(1, score)
	}

	/**
	 * Measure style inconsistency
	 */
	private measureStyleInconsistency(code: string): number {
		const hasSpaces = /^  /m.test(code)
		const hasTabs = /^\t/m.test(code)
		const mixedIndent = hasSpaces && hasTabs ? 0.3 : 0

		const camelCase = (code.match(/[a-z][a-zA-Z0-9]*[A-Z]/g) || []).length
		const snakeCase = (code.match(/_[a-z]+/g) || []).length
		const mixedNaming = camelCase > 0 && snakeCase > 0 ? 0.2 : 0

		return Math.min(1, mixedIndent + mixedNaming)
	}

	/**
	 * Generate therapeutic insight
	 */
	private generateTherapeuticInsight(detailed: any[]): string {
		if (detailed.length === 0) {
			return "Aucun pattern Magnus detecte -- code neutre."
		}

		const insights = detailed.map((d: any) => {
			const pattern = MAGNUS_15_PATTERNS.find((p) => p.name === d.name)
			return pattern ? pattern.therapeuticMessage : "Pattern unknown"
		})

		return insights.join(" | ")
	}

	/**
	 * Calculate confidence level
	 */
	private calculateConfidence(detailed: any[], opusResult?: any): "FAIBLE" | "MOYEN" | "FORT" {
		if (opusResult && detailed.length > 2) {
			return "FORT"
		}
		if (detailed.length > 1) {
			return "MOYEN"
		}
		return "FAIBLE"
	}

	/**
	 * Get detection history
	 */
	public getDetectionHistory(): MagnusDetectionResult[] {
		return this.detectionHistory
	}

	/**
	 * Get pattern statistics
	 */
	public getStatistics() {
		const stats = {
			totalDetections: this.detectionHistory.length,
			patternsFrequency: Object.fromEntries(this.patternFrequency),
			averageHarmony: 0,
			averageAdjustment: 0,
		}

		for (const result of this.detectionHistory) {
			stats.averageHarmony += result.harmonyScore
			stats.averageAdjustment += result.adjustment
		}

		if (this.detectionHistory.length > 0) {
			stats.averageHarmony /= this.detectionHistory.length
			stats.averageAdjustment /= this.detectionHistory.length
		}

		return stats
	}

	/**
	 * Clear history (for testing)
	 */
	public clearHistory(): void {
		this.detectionHistory = []
		this.patternFrequency.clear()
	}
}

export default MagnusPatternEngine
