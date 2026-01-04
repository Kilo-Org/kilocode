// kilocode_change - new file

export interface ConfidenceConfig {
	defaultThreshold: number
	enableMultiFactorScoring: boolean
	factors: ConfidenceFactor[]
}

export interface ConfidenceFactor {
	name: string
	weight: number
	evaluator: (context: ConfidenceContext) => number
}

export interface ConfidenceContext {
	taskDescription: string
	availableTools: string[]
	codebaseContext: Record<string, unknown>
	previousSuccess?: number
	complexity?: "low" | "medium" | "high"
	uncertaintyLevel?: number
	timeEstimate?: number
	hasTests?: boolean
	isOdooProject?: boolean
}

export interface ConfidenceScore {
	overall: number
	factors: Array<{ name: string; score: number; weight: number; contribution: number }>
	threshold: number
	isSufficient: boolean
	recommendation: string
}

export interface StepConfidence {
	stepId: string
	stepDescription: string
	confidence: number
	factors: Record<string, number>
	requiresApproval: boolean
}

export class ConfidenceScorer {
	private config: ConfidenceConfig
	private defaultFactors: ConfidenceFactor[] = [
		{
			name: "codebase_presence",
			weight: 0.25,
			evaluator: (ctx) => {
				const relevantTools = ctx.availableTools.filter((t) =>
					ctx.taskDescription.toLowerCase().includes(t.toLowerCase()),
				).length
				return Math.min(relevantTools / Math.max(ctx.availableTools.length, 1), 1)
			},
		},
		{
			name: "complexity_match",
			weight: 0.2,
			evaluator: (ctx) => {
				const complexityScores = { low: 1.0, medium: 0.7, high: 0.4 }
				const complexity = ctx.complexity ?? "medium"
				return complexityScores[complexity]
			},
		},
		{
			name: "uncertainty_penalty",
			weight: 0.15,
			evaluator: (ctx) => {
				const uncertainty = ctx.uncertaintyLevel ?? 0.5
				return 1 - Math.min(uncertainty, 1)
			},
		},
		{
			name: "time_estimate",
			weight: 0.1,
			evaluator: (ctx) => {
				const time = ctx.timeEstimate ?? 30
				if (time <= 15) return 1.0
				if (time <= 30) return 0.85
				if (time <= 60) return 0.7
				if (time <= 120) return 0.5
				return 0.3
			},
		},
		{
			name: "test_coverage",
			weight: 0.15,
			evaluator: (ctx) => {
				return ctx.hasTests ? 0.9 : 0.6
			},
		},
		{
			name: "historical_success",
			weight: 0.15,
			evaluator: (ctx) => {
				const success = ctx.previousSuccess ?? 0.7
				return Math.min(success, 1)
			},
		},
	]

	constructor(config?: Partial<ConfidenceConfig>) {
		this.config = {
			defaultThreshold: config?.defaultThreshold ?? 0.7,
			enableMultiFactorScoring: config?.enableMultiFactorScoring ?? true,
			factors: config?.factors ?? this.defaultFactors,
		}
	}

	calculateConfidence(context: ConfidenceContext): ConfidenceScore {
		if (!this.config.enableMultiFactorScoring) {
			const score = this.simpleConfidence(context)
			return {
				overall: score,
				factors: [{ name: "simple", score, weight: 1, contribution: score }],
				threshold: this.config.defaultThreshold,
				isSufficient: score >= this.config.defaultThreshold,
				recommendation: this.getRecommendation(score),
			}
		}

		const factorScores = this.config.factors.map((factor) => {
			const score = factor.evaluator(context)
			const contribution = score * factor.weight
			return {
				name: factor.name,
				score,
				weight: factor.weight,
				contribution,
			}
		})

		const overall = factorScores.reduce((sum, f) => sum + f.contribution, 0)

		return {
			overall,
			factors: factorScores,
			threshold: this.config.defaultThreshold,
			isSufficient: overall >= this.config.defaultThreshold,
			recommendation: this.getRecommendation(overall),
		}
	}

	private simpleConfidence(context: ConfidenceContext): number {
		// Simplified confidence calculation
		let score = 0.5

		if (context.previousSuccess) {
			score += context.previousSuccess * 0.3
		}

		if (context.complexity === "low") {
			score += 0.2
		} else if (context.complexity === "high") {
			score -= 0.2
		}

		if (context.hasTests) {
			score += 0.15
		}

		if (context.uncertaintyLevel) {
			score -= context.uncertaintyLevel * 0.2
		}

		return Math.max(0, Math.min(1, score))
	}

	private getRecommendation(score: number): string {
		if (score >= 0.9) {
			return "Proceed with confidence"
		} else if (score >= 0.7) {
			return "Proceed with normal caution"
		} else if (score >= 0.5) {
			return "Consider gathering more information"
		} else if (score >= 0.3) {
			return "Recommend user approval before proceeding"
		} else {
			return "High uncertainty - require user intervention"
		}
	}

	calculateStepConfidence(stepId: string, stepDescription: string, context: ConfidenceContext): StepConfidence {
		const score = this.calculateConfidence(context)

		return {
			stepId,
			stepDescription,
			confidence: score.overall,
			factors: score.factors.reduce(
				(acc, f) => {
					acc[f.name] = f.score
					return acc
				},
				{} as Record<string, number>,
			),
			requiresApproval: score.overall < this.config.defaultThreshold,
		}
	}

	// Calculate confidence for a series of steps
	calculateBatchConfidence(steps: Array<{ id: string; description: string; context: ConfidenceContext }>): {
		totalConfidence: number
		stepScores: StepConfidence[]
		requiresApproval: boolean
		weakestStep: StepConfidence | null
	} {
		const stepScores = steps.map((step) => this.calculateStepConfidence(step.id, step.description, step.context))

		const totalConfidence =
			stepScores.length > 0 ? stepScores.reduce((sum, s) => sum + s.confidence, 0) / stepScores.length : 0

		const weakestStep =
			stepScores.length > 0 ? stepScores.reduce((min, s) => (s.confidence < min.confidence ? s : min)) : null

		return {
			totalConfidence,
			stepScores,
			requiresApproval: stepScores.some((s) => s.requiresApproval),
			weakestStep,
		}
	}

	// Update configuration
	updateConfig(updates: Partial<ConfidenceConfig>): void {
		this.config = { ...this.config, ...updates }
	}

	getConfig(): ConfidenceConfig {
		return { ...this.config }
	}

	// Add custom factor
	addFactor(factor: ConfidenceFactor): void {
		this.config.factors.push(factor)
	}

	// Remove factor by name
	removeFactor(name: string): boolean {
		const index = this.config.factors.findIndex((f) => f.name === name)
		if (index >= 0) {
			this.config.factors.splice(index, 1)
			return true
		}
		return false
	}
}
