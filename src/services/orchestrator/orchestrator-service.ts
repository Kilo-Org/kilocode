// kilocode_change - new file

import type { DecisionEngine, DecisionResult, DecisionEngineConfig, ObservationStep } from "./decision-engine"
import { DecisionEngine as DecisionEngineImpl } from "./decision-engine"
import { SelfHealingStrategy, type ErrorContext, type RecoveryPlan } from "./decision-engine/self-healing-strategy"
import {
	UserInterventionService,
	type InterventionRequest,
	type InterventionResponse,
} from "./decision-engine/user-intervention-service"
import { ConfidenceScorer, type ConfidenceContext } from "./decision-engine/confidence-scorer"
import { OdooErrorHandler } from "./decision-engine/odoo-error-handler"
import { createThinkingStateManager, type ThinkingState } from "./decision-engine/thinking-state"
import { OrchestratorUIBridge } from "./decision-engine/ui-integration"

export interface OrchestratorConfig {
	decisionEngine: DecisionEngineConfig
	selfHealing: { defaultMaxRetries: number }
	userIntervention: {
		maxTokenThreshold: number
		maxCostThreshold: number
		enableHighRiskDetection: boolean
	}
	confidence: { defaultThreshold: number }
	ui: {
		showDecisionLogs: boolean
		showConfidenceScore: boolean
		enableRealTimeUpdates: boolean
	}
}

export interface OrchestratorTask {
	id: string
	description: string
	steps: OrchestratorStep[]
	context: Record<string, unknown>
}

export interface OrchestratorStep {
	id: string
	description: string
	action: string
	target?: string
	estimatedTokens?: number
	dependencies?: string[]
}

export interface OrchestratorResult {
	success: boolean
	completedSteps: number
	totalSteps: number
	decisions: DecisionResult[]
	healingAttempts: number
	interventions: number
	summary: Record<string, unknown>
}

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void

export interface OrchestratorEvent {
	type: string
	timestamp: number
	payload?: Record<string, unknown>
}

export class OrchestratorService {
	private config: OrchestratorConfig
	private decisionEngine: DecisionEngine
	private selfHealing: SelfHealingStrategy
	private userIntervention: UserInterventionService
	private confidenceScorer: ConfidenceScorer
	private odooErrorHandler: OdooErrorHandler
	private thinkingState: ReturnType<typeof createThinkingStateManager>
	private uiBridge: OrchestratorUIBridge
	private eventHandlers: Set<OrchestratorEventHandler>
	private currentTask: OrchestratorTask | null = null
	private isRunning: boolean = false
	private abortController: AbortController | null = null

	constructor(config?: Partial<OrchestratorConfig>) {
		this.config = this.getDefaultConfig(config)

		// Initialize components
		this.decisionEngine = new DecisionEngineImpl(this.config.decisionEngine)
		this.selfHealing = new SelfHealingStrategy({
			defaultMaxRetries: this.config.selfHealing.defaultMaxRetries,
		})
		this.userIntervention = new UserInterventionService({
			maxTokenThreshold: this.config.userIntervention.maxTokenThreshold,
			maxCostThreshold: this.config.userIntervention.maxCostThreshold,
			enableHighRiskDetection: this.config.userIntervention.enableHighRiskDetection,
		})
		this.confidenceScorer = new ConfidenceScorer({
			defaultThreshold: this.config.confidence.defaultThreshold,
		})
		this.odooErrorHandler = new OdooErrorHandler()
		this.thinkingState = createThinkingStateManager()
		this.uiBridge = new OrchestratorUIBridge({
			showDecisionLogs: this.config.ui.showDecisionLogs,
			showConfidenceScore: this.config.ui.showConfidenceScore,
			enableRealTimeUpdates: this.config.ui.enableRealTimeUpdates,
		})
		this.eventHandlers = new Set()

		// Setup user intervention callback
		this.userIntervention.setCallback(async (request: InterventionRequest) => {
			return this.handleUserIntervention(request)
		})
	}

	private getDefaultConfig(partial?: Partial<OrchestratorConfig>): OrchestratorConfig {
		return {
			decisionEngine: {
				maxReflections: partial?.decisionEngine?.maxReflections ?? 5,
				observationThreshold: partial?.decisionEngine?.observationThreshold ?? 0.7,
				confidenceThreshold: partial?.decisionEngine?.confidenceThreshold ?? 0.7,
				timeoutMs: partial?.decisionEngine?.timeoutMs ?? 30000,
			},
			selfHealing: {
				defaultMaxRetries: partial?.selfHealing?.defaultMaxRetries ?? 3,
			},
			userIntervention: {
				maxTokenThreshold: partial?.userIntervention?.maxTokenThreshold ?? 100000,
				maxCostThreshold: partial?.userIntervention?.maxCostThreshold ?? 10.0,
				enableHighRiskDetection: partial?.userIntervention?.enableHighRiskDetection ?? true,
			},
			confidence: {
				defaultThreshold: partial?.confidence?.defaultThreshold ?? 0.7,
			},
			ui: {
				showDecisionLogs: partial?.ui?.showDecisionLogs ?? true,
				showConfidenceScore: partial?.ui?.showConfidenceScore ?? true,
				enableRealTimeUpdates: partial?.ui?.enableRealTimeUpdates ?? true,
			},
		}
	}

	// Main execution method
	async runTask(task: OrchestratorTask): Promise<OrchestratorResult> {
		if (this.isRunning) {
			throw new Error("Orchestrator is already running a task")
		}

		this.isRunning = true
		this.currentTask = task
		this.abortController = new AbortController()

		const decisions: DecisionResult[] = []
		let healingAttempts = 0
		let interventions = 0

		try {
			this.thinkingState.setState("analyzing")
			this.emitEvent("task_started", { taskId: task.id })

			// Pre-execution checks
			for (const step of task.steps) {
				if (this.abortController?.signal.aborted) {
					throw new Error("Task was cancelled")
				}

				// Check confidence threshold
				const confidence = this.confidenceScorer.calculateStepConfidence(
					step.id,
					step.description,
					this.buildConfidenceContext(task, step),
				)

				this.uiBridge.notifyConfidenceUpdate({
					overall: confidence.confidence,
					factors: Object.entries(confidence.factors).map(([name, score]) => ({
						name,
						score,
						weight: 1,
						contribution: score,
					})),
					threshold: this.config.confidence.defaultThreshold,
					isSufficient: confidence.confidence >= this.config.confidence.defaultThreshold,
					recommendation:
						confidence.confidence >= this.config.confidence.defaultThreshold
							? "Proceed"
							: "User approval recommended",
				})

				if (confidence.requiresApproval) {
					this.thinkingState.setState("waiting_user")
					interventions++
					const intervention = await this.userIntervention.checkConfidenceThreshold(
						confidence.confidence,
						step.description,
					)
					if (intervention && !intervention.approved) {
						return {
							success: false,
							completedSteps: 0,
							totalSteps: task.steps.length,
							decisions,
							healingAttempts,
							interventions,
							summary: { reason: "User rejected low confidence step" },
						}
					}
				}

				// Check for high-risk actions
				const riskAssessment = this.userIntervention.assessRisk(step.action, step.target ?? "")

				if (riskAssessment.isHighRisk) {
					this.thinkingState.setState("waiting_user")
					interventions++
					const response = await this.userIntervention.requestIntervention(
						"high_risk",
						`High-risk action: ${step.action} on ${step.target}`,
						{ riskLevel: riskAssessment.riskLevel, riskFactors: riskAssessment.riskFactors },
					)
					if (!response.approved) {
						return {
							success: false,
							completedSteps: 0,
							totalSteps: task.steps.length,
							decisions,
							healingAttempts,
							interventions,
							summary: { reason: "User rejected high-risk action" },
						}
					}
				}

				// Execute the step through decision engine
				this.thinkingState.setState("executing")

				const decisionResult = await this.executeWithDecisionLoop(step, task.context)
				decisions.push(decisionResult)

				// Handle self-healing if needed
				if (decisionResult.action === "retry" || decisionResult.action === "heal") {
					healingAttempts++
					const recoveryPlan = await this.createRecoveryPlan(step, decisionResult)
					await this.executeRecoveryPlan(recoveryPlan)
				}

				this.uiBridge.notifyStepComplete(step.id, {
					success: decisionResult.action === "proceed",
					confidence: decisionResult.confidence,
				})

				// Log the decision
				this.thinkingState.logDecision(decisionResult.action, decisionResult.reasoning, { stepId: step.id })
				this.uiBridge.notifyDecisionLog({
					id: `log-${Date.now()}`,
					timestamp: Date.now(),
					state: this.thinkingState.state,
					decision: decisionResult.action,
					reasoning: decisionResult.reasoning,
					context: { stepId: step.id },
				})
			}

			this.thinkingState.setState("completed")
			this.emitEvent("task_completed", { taskId: task.id })

			return {
				success: true,
				completedSteps: task.steps.length,
				totalSteps: task.steps.length,
				decisions,
				healingAttempts,
				interventions,
				summary: {
					taskId: task.id,
					allStepsCompleted: true,
				},
			}
		} catch (error) {
			this.thinkingState.setState("error")
			this.uiBridge.notifyError(error instanceof Error ? error : new Error(String(error)), { taskId: task.id })
			this.emitEvent("task_error", { taskId: task.id, error })

			return {
				success: false,
				completedSteps: 0,
				totalSteps: task.steps.length,
				decisions,
				healingAttempts,
				interventions,
				summary: {
					error: error instanceof Error ? error.message : String(error),
				},
			}
		} finally {
			this.isRunning = false
			this.currentTask = null
		}
	}

	private async executeWithDecisionLoop(
		step: OrchestratorStep,
		context: Record<string, unknown>,
	): Promise<DecisionResult> {
		// Use the decision engine to make a decision
		const decisionContext = {
			...context,
			step,
			toolCall: {
				name: step.action,
				arguments: { target: step.target },
			},
		}

		return this.decisionEngine.makeDecision(decisionContext)
	}

	private async createRecoveryPlan(step: OrchestratorStep, decision: DecisionResult): Promise<RecoveryPlan> {
		const errorContext: ErrorContext = {
			toolName: step.action,
			errorMessage:
				decision.observations
					.filter((o: ObservationStep) => o.status === "failed")
					.map((o: ObservationStep) => o.error)
					.join("; ") || "Unknown error",
			previousAttempts: decision.reflections.length,
		}

		// Check for Odoo-specific errors first
		if (this.odooErrorHandler.isOdooError(errorContext.errorMessage)) {
			return this.odooErrorHandler.createRecoveryPlan(errorContext)
		}

		return this.selfHealing.createRecoveryPlan(errorContext)
	}

	private async executeRecoveryPlan(plan: RecoveryPlan): Promise<void> {
		if (plan.escalate) {
			await this.userIntervention.requestIntervention("high_risk", `Recovery failed: ${plan.escalationReason}`, {
				recoveryPlan: plan,
			})
			return
		}

		for (const recoveryStep of plan.steps) {
			this.thinkingState.setState("healing")
			this.uiBridge.notifyHealingAttempt(
				{ success: true, action: recoveryStep.action, error: null, retryCount: 1, willRetry: true },
				1,
			)
		}
	}

	private async handleUserIntervention(request: InterventionRequest): Promise<InterventionResponse> {
		this.uiBridge.notifyInterventionRequest(request)

		// In a real implementation, this would wait for user input
		// For now, we use a timeout-based response
		return new Promise((resolve) => {
			// This is a placeholder - in production, this would connect to the UI
			setTimeout(() => {
				resolve({ approved: false, action: "wait" })
			}, 100)
		})
	}

	private buildConfidenceContext(task: OrchestratorTask, step: OrchestratorStep): ConfidenceContext {
		return {
			taskDescription: task.description,
			availableTools: [step.action],
			codebaseContext: task.context,
			complexity: step.estimatedTokens && step.estimatedTokens > 50000 ? "high" : "medium",
			uncertaintyLevel: 0.3,
			timeEstimate: 30,
			hasTests: false,
			isOdooProject: task.context["odooProject"] as boolean,
		}
	}

	// Event handling
	onEvent(handler: OrchestratorEventHandler): () => void {
		this.eventHandlers.add(handler)
		return () => this.eventHandlers.delete(handler)
	}

	private emitEvent(type: string, payload?: Record<string, unknown>): void {
		const event: OrchestratorEvent = { type, timestamp: Date.now(), payload }
		for (const handler of this.eventHandlers) {
			try {
				handler(event)
			} catch (error) {
				console.error("Error in event handler:", error)
			}
		}
	}

	// Control methods
	pause(): void {
		if (this.isRunning) {
			this.thinkingState.pause("User requested pause")
			this.abortController?.abort()
		}
	}

	resume(): void {
		if (!this.isRunning && this.currentTask) {
			this.runTask(this.currentTask)
		} else {
			this.thinkingState.resume()
		}
	}

	cancel(): void {
		this.abortController?.abort()
		this.isRunning = false
		this.thinkingState.reset()
	}

	// State inspection
	getState(): { thinkingState: ThinkingState; isRunning: boolean; task?: string } {
		return {
			thinkingState: this.thinkingState.getState(),
			isRunning: this.isRunning,
			task: this.currentTask?.id,
		}
	}

	getDecisionLogs(): ReturnType<typeof this.thinkingState.getDecisionLogs> {
		return this.thinkingState.getDecisionLogs()
	}

	// Configuration
	updateConfig(updates: Partial<OrchestratorConfig>): void {
		this.config = { ...this.config, ...updates }
		this.decisionEngine.updateConfig(this.config.decisionEngine)
		this.userIntervention.updateConfig(this.config.userIntervention)
		this.confidenceScorer.updateConfig(this.config.confidence)
		this.uiBridge.updateConfig(this.config.ui)
	}

	getConfig(): OrchestratorConfig {
		return { ...this.config }
	}
}
