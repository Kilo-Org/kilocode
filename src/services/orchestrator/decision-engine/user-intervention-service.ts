// kilocode_change - new file

export interface InterventionConfig {
	maxTokenThreshold: number
	maxCostThreshold: number
	enableHighRiskDetection: boolean
	enableDecisionForkDetection: boolean
}

export type InterventionType = "high_cost" | "high_risk" | "decision_fork" | "confidence_low"

export interface InterventionRequest {
	id: string
	type: InterventionType
	reason: string
	details: Record<string, unknown>
	requiresUserApproval: boolean
	suggestedActions?: string[]
}

export interface InterventionResponse {
	approved: boolean
	action?: string
	userComment?: string
}

export type InterventionCallback = (request: InterventionRequest) => Promise<InterventionResponse>

export interface RiskAssessment {
	isHighRisk: boolean
	riskLevel: "low" | "medium" | "high" | "critical"
	riskFactors: string[]
	requiresConfirmation: boolean
}

export interface CostEstimate {
	estimatedTokens: number
	estimatedCost: number
	currency: string
	warningThreshold: number
}

export interface DecisionFork {
	id: string
	description: string
	options: Array<{
		id: string
		label: string
		description: string
		pros: string[]
		cons: string[]
	}>
	recommendation?: string
}

export class UserInterventionService {
	private config: InterventionConfig
	private pendingInterventions: Map<string, InterventionRequest> = new Map()
	private callback: InterventionCallback | null = null
	private decisionForks: Map<string, DecisionFork> = new Map()

	constructor(config?: Partial<InterventionConfig>) {
		this.config = {
			maxTokenThreshold: config?.maxTokenThreshold ?? 100000,
			maxCostThreshold: config?.maxCostThreshold ?? 10.0,
			enableHighRiskDetection: config?.enableHighRiskDetection ?? true,
			enableDecisionForkDetection: config?.enableDecisionForkDetection ?? true,
		}
	}

	setCallback(callback: InterventionCallback): void {
		this.callback = callback
	}

	async requestIntervention(
		type: InterventionType,
		reason: string,
		details: Record<string, unknown> = {},
	): Promise<InterventionResponse> {
		const request: InterventionRequest = {
			id: `intervention-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			type,
			reason,
			details,
			requiresUserApproval: true,
			suggestedActions: this.getSuggestedActions(type, details),
		}

		this.pendingInterventions.set(request.id, request)

		if (this.callback) {
			const response = await this.callback(request)
			this.pendingInterventions.delete(request.id)
			return response
		}

		// Default response if no callback is set
		return { approved: false, action: "wait" }
	}

	private getSuggestedActions(type: InterventionType, _details: Record<string, unknown>): string[] {
		switch (type) {
			case "high_cost":
				return ["continue_with_budget", "use_cheaper_model", "cancel_task", "proceed_anyway"]
			case "high_risk":
				return ["review_changes", "proceed_with_caution", "cancel_operation", "modify_operation"]
			case "decision_fork":
				return ["choose_option_1", "choose_option_2", "choose_option_3", "create_custom_option"]
			case "confidence_low":
				return ["proceed_anyway", "request_more_info", "modify_plan", "escalate"]
			default:
				return ["approve", "deny"]
		}
	}

	// High-risk action detection
	assessRisk(action: string, target: string): RiskAssessment {
		if (!this.config.enableHighRiskDetection) {
			return {
				isHighRisk: false,
				riskLevel: "low",
				riskFactors: [],
				requiresConfirmation: false,
			}
		}

		const highRiskPatterns = [
			{ pattern: /delete|remove|rm/i, level: "high" as const, factors: ["File deletion"] },
			{
				pattern: /\.env|config|secret|password|api_key/i,
				level: "critical" as const,
				factors: ["Sensitive file modification"],
			},
			{ pattern: /drop|truncate|alter.*table/i, level: "critical" as const, factors: ["Database modification"] },
			{ pattern: /sudo|chmod|chown/i, level: "high" as const, factors: ["System-level operation"] },
			{ pattern: /force push|reset.*hard/i, level: "high" as const, factors: ["Git destructive operation"] },
			{ pattern: /format|reinstall/i, level: "critical" as const, factors: ["System formatting"] },
			{ pattern: /exec|eval|spawn/i, level: "medium" as const, factors: ["Code execution"] },
		]

		const matchedPatterns = highRiskPatterns.filter((p) => p.pattern.test(action) || p.pattern.test(target))

		if (matchedPatterns.length === 0) {
			return {
				isHighRisk: false,
				riskLevel: "low",
				riskFactors: [],
				requiresConfirmation: false,
			}
		}

		const highestLevel = matchedPatterns.reduce((max, p) => {
			const levels = ["low", "medium", "high", "critical"]
			return levels.indexOf(p.level) > levels.indexOf(max.level) ? p : max
		})

		return {
			isHighRisk: true,
			riskLevel: highestLevel.level,
			riskFactors: matchedPatterns.flatMap((p) => p.factors),
			requiresConfirmation: ["medium", "high", "critical"].includes(highestLevel.level),
		}
	}

	// Cost estimation
	estimateCost(tokens: number, costPerToken: number = 0.00001): CostEstimate {
		const estimatedCost = tokens * costPerToken

		return {
			estimatedTokens: tokens,
			estimatedCost,
			currency: "USD",
			warningThreshold: this.config.maxCostThreshold,
		}
	}

	async checkCostThreshold(estimatedTokens: number): Promise<InterventionRequest | null> {
		if (estimatedTokens > this.config.maxTokenThreshold) {
			const request: InterventionRequest = {
				id: `intervention-${Date.now()}-${Math.random().toString(36).slice(2)}`,
				type: "high_cost",
				reason: `Estimated token usage (${estimatedTokens}) exceeds threshold (${this.config.maxTokenThreshold})`,
				details: { estimatedTokens, threshold: this.config.maxTokenThreshold },
				requiresUserApproval: true,
				suggestedActions: this.getSuggestedActions("high_cost", {
					estimatedTokens,
					threshold: this.config.maxTokenThreshold,
				}),
			}

			this.pendingInterventions.set(request.id, request)

			if (this.callback) {
				const response = await this.callback(request)
				this.pendingInterventions.delete(request.id)
				return null // Intervention was processed via callback
			}

			return request
		}
		return null
	}

	// Decision fork detection
	registerDecisionFork(fork: DecisionFork): void {
		this.decisionForks.set(fork.id, fork)
	}

	getDecisionFork(id: string): DecisionFork | undefined {
		return this.decisionForks.get(id)
	}

	async detectDecisionFork(
		id: string,
		description: string,
		options: DecisionFork["options"],
	): Promise<InterventionResponse | null> {
		if (!this.config.enableDecisionForkDetection) {
			return null
		}

		const fork: DecisionFork = {
			id,
			description,
			options,
		}

		this.registerDecisionFork(fork)

		return this.requestIntervention(
			"decision_fork",
			`Multiple valid implementation paths detected: ${description}`,
			{ forkId: id, options: options.map((o) => o.label) },
		)
	}

	// Confidence check
	async checkConfidenceThreshold(confidence: number, taskDescription: string): Promise<InterventionResponse | null> {
		if (confidence < 0.7) {
			return this.requestIntervention(
				"confidence_low",
				`Confidence score (${(confidence * 100).toFixed(1)}%) is below threshold (70%) for: ${taskDescription}`,
				{ confidence, threshold: 0.7 },
			)
		}
		return null
	}

	// Check if intervention is needed for an action
	async evaluateAction(
		action: string,
		target: string,
		estimatedTokens?: number,
	): Promise<{ needsIntervention: boolean; response?: InterventionResponse }> {
		const risk = this.assessRisk(action, target)

		if (risk.isHighRisk && risk.requiresConfirmation) {
			const response = await this.requestIntervention(
				"high_risk",
				`High-risk action detected: ${action} on ${target}`,
				{ action, target, riskLevel: risk.riskLevel, riskFactors: risk.riskFactors },
			)
			return { needsIntervention: true, response }
		}

		if (estimatedTokens && estimatedTokens > this.config.maxTokenThreshold) {
			const response = await this.requestIntervention("high_cost", `Estimated token usage exceeds threshold`, {
				estimatedTokens,
				threshold: this.config.maxTokenThreshold,
			})
			return { needsIntervention: true, response }
		}

		return { needsIntervention: false }
	}

	// Get pending interventions
	getPendingInterventions(): InterventionRequest[] {
		return Array.from(this.pendingInterventions.values())
	}

	// Clear pending interventions
	clearPendingInterventions(): void {
		this.pendingInterventions.clear()
	}

	// Update configuration
	updateConfig(updates: Partial<InterventionConfig>): void {
		this.config = { ...this.config, ...updates }
	}

	getConfig(): InterventionConfig {
		return { ...this.config }
	}
}
