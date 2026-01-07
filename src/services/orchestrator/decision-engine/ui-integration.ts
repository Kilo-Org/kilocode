// kilocode_change - new file

import type { ThinkingState, DecisionLogEntry } from "./thinking-state"
import type { ConfidenceScore } from "./confidence-scorer"
import type { InterventionRequest } from "./user-intervention-service"
import type { HealingResult } from "./self-healing-strategy"
import type { OdooErrorResult } from "./odoo-error-handler"

export interface OrchestratorUIConfig {
	showDecisionLogs: boolean
	showConfidenceScore: boolean
	showInterventionRequests: boolean
	showHealingStatus: boolean
	enableRealTimeUpdates: boolean
	animationsEnabled: boolean
}

export interface OrchestratorUIMessage {
	type: OrchestratorUIMessageType
	payload: Record<string, unknown>
	timestamp: number
}

export type OrchestratorUIMessageType =
	| "state_change"
	| "decision_log"
	| "confidence_update"
	| "intervention_request"
	| "intervention_response"
	| "healing_attempt"
	| "error_occurred"
	| "progress_update"
	| "task_complete"
	| "step_complete"

export interface UIStateUpdate {
	state: ThinkingState
	previousState?: ThinkingState
	reason?: string
}

export interface DecisionLogDisplay {
	entries: DecisionLogEntry[]
	showDetails: boolean
	filter?: string
}

export interface ConfidenceDisplay {
	overall: number
	factors: Array<{ name: string; score: number; weight: number }>
	threshold: number
	isSufficient: boolean
	recommendation: string
}

export interface InterventionDisplay {
	request: InterventionRequest
	timestamp: number
	canDismiss: boolean
}

export interface HealingStatusDisplay {
	inProgress: boolean
	lastAttempt?: HealingResult
	errorCount: number
	maxRetries: number
	odooErrors?: OdooErrorResult[]
}

export interface ProgressDisplay {
	currentStep: number
	totalSteps: number
	stepDescription: string
	percentage: number
	estimatedTimeRemaining?: number
}

export class OrchestratorUIBridge {
	private config: OrchestratorUIConfig
	private listeners: Map<OrchestratorUIMessageType, Set<(payload: Record<string, unknown>) => void>> = new Map()
	private messageQueue: OrchestratorUIMessage[] = []
	private maxQueueSize: number = 50

	constructor(config?: Partial<OrchestratorUIConfig>) {
		this.config = {
			showDecisionLogs: config?.showDecisionLogs ?? true,
			showConfidenceScore: config?.showConfidenceScore ?? true,
			showInterventionRequests: config?.showInterventionRequests ?? true,
			showHealingStatus: config?.showHealingStatus ?? true,
			enableRealTimeUpdates: config?.enableRealTimeUpdates ?? true,
			animationsEnabled: config?.animationsEnabled ?? true,
		}
	}

	// Subscribe to UI messages
	subscribe(type: OrchestratorUIMessageType, listener: (payload: Record<string, unknown>) => void): () => void {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set())
		}
		this.listeners.get(type)!.add(listener)
		return () => this.listeners.get(type)?.delete(listener)
	}

	// Send message to UI
	send(type: OrchestratorUIMessageType, payload: Record<string, unknown>): void {
		const message: OrchestratorUIMessage = {
			type,
			payload,
			timestamp: Date.now(),
		}

		// Add to queue if real-time updates are disabled
		if (!this.config.enableRealTimeUpdates) {
			this.messageQueue.push(message)
			if (this.messageQueue.length > this.maxQueueSize) {
				this.messageQueue.shift()
			}
			return
		}

		// Notify listeners
		this.notifyListeners(type, payload)

		// Log message
		if (this.config.showDecisionLogs) {
			console.log(`[Orchestrator UI] ${type}:`, payload)
		}
	}

	private notifyListeners(type: OrchestratorUIMessageType, payload: Record<string, unknown>): void {
		const typeListeners = this.listeners.get(type)
		if (typeListeners) {
			for (const listener of typeListeners) {
				try {
					listener(payload)
				} catch (error) {
					console.error(`Error in UI listener for ${type}:`, error)
				}
			}
		}
	}

	// State change notifications
	notifyStateChange(state: ThinkingState, previousState?: ThinkingState, reason?: string): void {
		this.send("state_change", {
			state,
			previousState,
			reason,
			display: {
				stateLabel: this.getStateLabel(state),
				stateIcon: this.getStateIcon(state),
				stateColor: this.getStateColor(state),
			} as Record<string, unknown>,
		})
	}

	// Decision log notifications
	notifyDecisionLog(entry: DecisionLogEntry): void {
		if (!this.config.showDecisionLogs) return

		this.send("decision_log", {
			entry,
			display: {
				formattedTime: new Date(entry.timestamp).toLocaleTimeString(),
				decisionIcon: this.getDecisionIcon(entry.decision),
			} as Record<string, unknown>,
		})
	}

	// Confidence score notifications
	notifyConfidenceUpdate(score: ConfidenceScore): void {
		if (!this.config.showConfidenceScore) return

		this.send("confidence_update", {
			score,
			display: this.formatConfidenceDisplay(score),
		})
	}

	// Intervention request notifications
	notifyInterventionRequest(request: InterventionRequest): void {
		if (!this.config.showInterventionRequests) return

		this.send("intervention_request", {
			request,
			display: {
				typeLabel: this.getInterventionTypeLabel(request.type),
				priority: this.getInterventionPriority(request.type),
				suggestedActions: request.suggestedActions,
			} as Record<string, unknown>,
		})
	}

	// Intervention response notifications
	notifyInterventionResponse(requestId: string, approved: boolean, action?: string): void {
		this.send("intervention_response", {
			requestId,
			approved,
			action,
		})
	}

	// Healing status notifications
	notifyHealingAttempt(result: HealingResult, errorCount: number): void {
		if (!this.config.showHealingStatus) return

		this.send("healing_attempt", {
			result,
			errorCount,
			display: {
				statusLabel: result.success ? "Recovery in progress" : "Recovery failed",
				retryIndicator: result.willRetry ? `Retry ${result.retryCount}/${3}` : "No more retries",
			} as Record<string, unknown>,
		})
	}

	// Error notifications
	notifyError(error: Error, context?: Record<string, unknown>): void {
		this.send("error_occurred", {
			message: error.message,
			stack: error.stack,
			context,
		})
	}

	// Progress notifications
	notifyProgress(currentStep: number, totalSteps: number, stepDescription: string): void {
		const percentage = Math.round((currentStep / Math.max(totalSteps, 1)) * 100)

		this.send("progress_update", {
			currentStep,
			totalSteps,
			stepDescription,
			percentage,
			display: {
				progressBar: this.generateProgressBar(percentage),
				stepLabel: `Step ${currentStep} of ${totalSteps}`,
			} as Record<string, unknown>,
		})
	}

	// Task complete notification
	notifyTaskComplete(summary: Record<string, unknown>): void {
		this.send("task_complete", { summary })
	}

	// Step complete notification
	notifyStepComplete(stepId: string, result: Record<string, unknown>): void {
		this.send("step_complete", { stepId, result })
	}

	// Flush message queue (for non-real-time mode)
	flushQueue(): OrchestratorUIMessage[] {
		const messages = [...this.messageQueue]
		this.messageQueue = []
		return messages
	}

	// Update configuration
	updateConfig(updates: Partial<OrchestratorUIConfig>): void {
		this.config = { ...this.config, ...updates }
	}

	getConfig(): OrchestratorUIConfig {
		return { ...this.config }
	}

	// Helper methods for UI display
	private getStateLabel(state: ThinkingState): string {
		const labels: Record<ThinkingState, string> = {
			idle: "Ready",
			analyzing: "Analyzing",
			planning: "Planning",
			executing: "Executing",
			reflecting: "Reflecting",
			healing: "Self-Healing",
			waiting_user: "Waiting for User",
			paused: "Paused",
			completed: "Completed",
			error: "Error",
		}
		return labels[state] ?? "Unknown"
	}

	private getStateIcon(state: ThinkingState): string {
		const icons: Record<ThinkingState, string> = {
			idle: "⚪",
			analyzing: "🔍",
			planning: "📋",
			executing: "▶️",
			reflecting: "🤔",
			healing: "🔧",
			waiting_user: "⏸️",
			paused: "⏸️",
			completed: "✅",
			error: "❌",
		}
		return icons[state] ?? "❓"
	}

	private getStateColor(state: ThinkingState): string {
		const colors: Record<ThinkingState, string> = {
			idle: "#888888",
			analyzing: "#3498db",
			planning: "#9b59b6",
			executing: "#27ae60",
			reflecting: "#f39c12",
			healing: "#e67e22",
			waiting_user: "#95a5a6",
			paused: "#95a5a6",
			completed: "#2ecc71",
			error: "#e74c3c",
		}
		return colors[state] ?? "#888888"
	}

	private getDecisionIcon(decision: string): string {
		if (decision.toLowerCase().includes("retry")) return "🔄"
		if (decision.toLowerCase().includes("proceed")) return "▶️"
		if (decision.toLowerCase().includes("stop") || decision.toLowerCase().includes("fail")) return "🛑"
		if (decision.toLowerCase().includes("heal") || decision.toLowerCase().includes("recover")) return "🔧"
		if (decision.toLowerCase().includes("ask") || decision.toLowerCase().includes("user")) return "❓"
		return "📝"
	}

	private getInterventionTypeLabel(type: string): string {
		const labels: Record<string, string> = {
			high_cost: "High Cost",
			high_risk: "High Risk",
			decision_fork: "Decision Required",
			confidence_low: "Low Confidence",
		}
		return labels[type] ?? "Intervention"
	}

	private getInterventionPriority(type: string): number {
		const priorities: Record<string, number> = {
			high_risk: 10,
			decision_fork: 8,
			high_cost: 6,
			confidence_low: 4,
		}
		return priorities[type] ?? 5
	}

	private formatConfidenceDisplay(score: ConfidenceScore): Record<string, unknown> {
		return {
			overallLabel: `${(score.overall * 100).toFixed(0)}%`,
			overallColor: score.overall >= 0.7 ? "#2ecc71" : score.overall >= 0.5 ? "#f39c12" : "#e74c3c",
			thresholdLabel: `${(score.threshold * 100).toFixed(0)}%`,
			factors: score.factors.map((f) => ({
				name: f.name,
				score: `${(f.score * 100).toFixed(0)}%`,
				contribution: `${(f.contribution * 100).toFixed(1)}%`,
			})),
			recommendation: score.recommendation,
		}
	}

	private generateProgressBar(percentage: number): string {
		const filled = Math.round(percentage / 10)
		const empty = 10 - filled
		return "█".repeat(filled) + "░".repeat(empty)
	}
}
