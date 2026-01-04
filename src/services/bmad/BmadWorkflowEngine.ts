// kilocode_change - new file for BMAD-METHOD workflow execution engine

import type {
	BmadWorkflow,
	BmadWorkflowStep,
	WorkflowExecutionOptions,
	WorkflowResult,
	WorkflowSession,
	StepResult,
} from "./types"
import { BmadIntegrationService } from "./BmadIntegrationService"
import { BmadAgentRegistry } from "./BmadAgentRegistry"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * Workflow execution context
 */
export interface WorkflowExecutionContext {
	sessionId: string
	workflowId: string
	startTime: Date
	currentStepIndex: number
	variables: Record<string, any>
	history: WorkflowStepExecution[]
	status: "running" | "paused" | "completed" | "failed" | "cancelled"
}

/**
 * Workflow step execution result
 */
export interface WorkflowStepExecution {
	stepId: string
	stepName: string
	startTime: Date
	endTime?: Date
	status: "pending" | "running" | "completed" | "failed" | "skipped"
	result?: any
	error?: string
	duration?: number
}

/**
 * Workflow event types
 */
export type WorkflowEventType =
	| "workflow_started"
	| "workflow_paused"
	| "workflow_resumed"
	| "workflow_completed"
	| "workflow_failed"
	| "workflow_cancelled"
	| "step_started"
	| "step_completed"
	| "step_failed"

/**
 * Workflow event listener
 */
export interface WorkflowEventListener {
	(eventType: WorkflowEventType, data: any): void | Promise<void>
}

/**
 * BMAD workflow engine
 * Executes BMAD workflows with step-by-step processing
 */
export class BmadWorkflowEngine {
	private integrationService: BmadIntegrationService
	private agentRegistry: BmadAgentRegistry
	private activeSessions: Map<string, WorkflowExecutionContext> = new Map()
	private eventListeners: Map<WorkflowEventType, Set<WorkflowEventListener>> = new Map()
	private isInitialized = false

	constructor(integrationService: BmadIntegrationService, agentRegistry: BmadAgentRegistry) {
		this.integrationService = integrationService
		this.agentRegistry = agentRegistry
	}

	/**
	 * Initialize the workflow engine
	 */
	async initialize(): Promise<void> {
		try {
			if (this.isInitialized) {
				logger.warn("[BmadWorkflowEngine] Already initialized")
				return
			}

			// Wait for integration service to be ready
			await this.integrationService.initialize()
			await this.agentRegistry.initialize()

			this.isInitialized = true
			logger.info("[BmadWorkflowEngine] Initialized successfully")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowEngine] Failed to initialize", { error: errorMessage })
			throw new Error(`Failed to initialize BMAD workflow engine: ${errorMessage}`)
		}
	}

	/**
	 * Execute a workflow
	 */
	async executeWorkflow(workflowId: string, options: WorkflowExecutionOptions = {}): Promise<WorkflowResult> {
		try {
			if (!this.isInitialized) {
				throw new Error("Workflow engine not initialized")
			}

			// Get the workflow
			const workflow = this.integrationService.getWorkflowById(workflowId)
			if (!workflow) {
				throw new Error(`Workflow not found: ${workflowId}`)
			}

			// Create execution context
			const sessionId = this.generateSessionId()
			const context: WorkflowExecutionContext = {
				sessionId,
				workflowId,
				startTime: new Date(),
				currentStepIndex: 0,
				variables: { ...options.variables },
				history: [],
				status: "running",
			}

			this.activeSessions.set(sessionId, context)

			// Emit workflow started event
			await this.emitEvent("workflow_started", {
				sessionId,
				workflowId,
				workflowName: workflow.name,
			})

			logger.info("[BmadWorkflowEngine] Starting workflow execution", {
				sessionId,
				workflowId,
				workflowName: workflow.name,
			})

			// Execute steps
			let result: WorkflowResult = {
				success: true,
				sessionId,
				workflowId,
				outputs: {},
				completedSteps: [],
				failedSteps: [],
				steps: [],
				duration: 0,
				variables: {},
			}

			try {
				for (let i = 0; i < workflow.steps.length; i++) {
					const step = workflow.steps[i]
					context.currentStepIndex = i

					const stepResult = await this.executeStep(context, step, workflow)

					// Convert WorkflowStepExecution to StepResult
					const stepResultForOutput: StepResult = {
						success: stepResult.status === "completed",
						stepId: stepResult.stepId,
						stepName: stepResult.stepName,
						outputs: stepResult.result || {},
						error: stepResult.error,
						duration: stepResult.duration || 0,
						result: stepResult.result,
						status: stepResult.status,
					}
					result.steps.push(stepResultForOutput)

					// Add step result to history
					context.history.push(stepResult)

					// Track completed/failed steps
					if (stepResult.status === "completed") {
						result.completedSteps.push(stepResult.stepId)
					} else if (stepResult.status === "failed") {
						result.failedSteps.push(stepResult.stepId)
					}

					// Check if step failed and workflow should stop
					if (stepResult.status === "failed" && step.continueOnFailure !== true) {
						throw new Error(`Step failed: ${step.name}`)
					}

					// Update variables from step result
					if (stepResult.result) {
						Object.assign(context.variables, stepResult.result)
						Object.assign(result.outputs, stepResult.result)
					}
				}

				// Workflow completed successfully
				context.status = "completed"
				result.success = true
				result.variables = { ...context.variables }
				result.outputs = { ...context.variables }
				result.duration = Date.now() - context.startTime.getTime()

				await this.emitEvent("workflow_completed", {
					sessionId,
					workflowId,
					duration: result.duration,
				})

				logger.info("[BmadWorkflowEngine] Workflow completed successfully", {
					sessionId,
					workflowId,
					duration: result.duration,
				})
			} catch (error) {
				// Workflow failed
				context.status = "failed"
				result.success = false
				result.error = error instanceof Error ? error.message : String(error)
				result.duration = Date.now() - context.startTime.getTime()

				await this.emitEvent("workflow_failed", {
					sessionId,
					workflowId,
					error: result.error,
				})

				logger.error("[BmadWorkflowEngine] Workflow failed", {
					sessionId,
					workflowId,
					error: result.error,
				})
			} finally {
				// Remove from active sessions
				this.activeSessions.delete(sessionId)
			}

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowEngine] Failed to execute workflow", {
				workflowId,
				error: errorMessage,
			})

			return {
				success: false,
				sessionId: "",
				workflowId,
				outputs: {},
				completedSteps: [],
				failedSteps: [],
				error: errorMessage,
				steps: [],
				duration: 0,
				variables: {},
			}
		}
	}

	/**
	 * Execute a single workflow step
	 */
	private async executeStep(
		context: WorkflowExecutionContext,
		step: BmadWorkflowStep,
		workflow: BmadWorkflow,
	): Promise<WorkflowStepExecution> {
		const stepExecution: WorkflowStepExecution = {
			stepId: step.id,
			stepName: step.name,
			startTime: new Date(),
			status: "running",
		}

		await this.emitEvent("step_started", {
			sessionId: context.sessionId,
			stepId: step.id,
			stepName: step.name,
		})

		logger.info("[BmadWorkflowEngine] Executing step", {
			sessionId: context.sessionId,
			stepId: step.id,
			stepName: step.name,
		})

		try {
			// Check if step has conditions
			if (step.conditions && !this.evaluateConditions(step.conditions, context.variables)) {
				stepExecution.status = "skipped"
				stepExecution.endTime = new Date()
				stepExecution.duration = stepExecution.endTime.getTime() - stepExecution.startTime.getTime()

				logger.info("[BmadWorkflowEngine] Step skipped due to conditions", {
					sessionId: context.sessionId,
					stepId: step.id,
				})

				return stepExecution
			}

			// Execute step based on type
			let result: any

			switch (step.type) {
				case "agent":
					result = await this.executeAgentStep(context, step, workflow)
					break
				case "task":
					result = await this.executeTaskStep(context, step, workflow)
					break
				case "condition":
					result = await this.executeConditionStep(context, step, workflow)
					break
				case "loop":
					result = await this.executeLoopStep(context, step, workflow)
					break
				case "parallel":
					result = await this.executeParallelStep(context, step, workflow)
					break
				default:
					throw new Error(`Unknown step type: ${step.type}`)
			}

			stepExecution.status = "completed"
			stepExecution.result = result
			stepExecution.endTime = new Date()
			stepExecution.duration = stepExecution.endTime.getTime() - stepExecution.startTime.getTime()

			await this.emitEvent("step_completed", {
				sessionId: context.sessionId,
				stepId: step.id,
				stepName: step.name,
				duration: stepExecution.duration,
			})

			logger.info("[BmadWorkflowEngine] Step completed", {
				sessionId: context.sessionId,
				stepId: step.id,
				duration: stepExecution.duration,
			})

			return stepExecution
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			stepExecution.status = "failed"
			stepExecution.error = errorMessage
			stepExecution.endTime = new Date()
			stepExecution.duration = stepExecution.endTime.getTime() - stepExecution.startTime.getTime()

			await this.emitEvent("step_failed", {
				sessionId: context.sessionId,
				stepId: step.id,
				stepName: step.name,
				error: errorMessage,
			})

			logger.error("[BmadWorkflowEngine] Step failed", {
				sessionId: context.sessionId,
				stepId: step.id,
				error: errorMessage,
			})

			return stepExecution
		}
	}

	/**
	 * Execute an agent step
	 */
	private async executeAgentStep(
		context: WorkflowExecutionContext,
		step: BmadWorkflowStep,
		workflow: BmadWorkflow,
	): Promise<any> {
		const agentId = step.agentId
		if (!agentId) {
			throw new Error("Agent step requires agentId")
		}

		const agent = this.agentRegistry.getAgentById(agentId)
		if (!agent) {
			throw new Error(`Agent not found: ${agentId}`)
		}

		// Record agent usage
		this.agentRegistry.recordAgentUsage(agentId)

		// Execute agent task
		const task = step.task || step.description || `Execute ${step.name}`
		const result = {
			agentId,
			agentName: agent.name,
			task,
			completed: true,
			timestamp: new Date(),
		}

		return result
	}

	/**
	 * Execute a task step
	 */
	private async executeTaskStep(
		context: WorkflowExecutionContext,
		step: BmadWorkflowStep,
		workflow: BmadWorkflow,
	): Promise<any> {
		const task = step.task || step.description || `Execute ${step.name}`

		// In a real implementation, this would execute the task
		// For now, return a placeholder result
		return {
			task,
			completed: true,
			timestamp: new Date(),
		}
	}

	/**
	 * Execute a condition step
	 */
	private async executeConditionStep(
		context: WorkflowExecutionContext,
		step: BmadWorkflowStep,
		workflow: BmadWorkflow,
	): Promise<any> {
		const condition = step.condition
		if (!condition) {
			throw new Error("Condition step requires condition")
		}

		const result = this.evaluateConditions([condition], context.variables)

		return {
			condition,
			result,
			timestamp: new Date(),
		}
	}

	/**
	 * Execute a loop step
	 */
	private async executeLoopStep(
		context: WorkflowExecutionContext,
		step: BmadWorkflowStep,
		workflow: BmadWorkflow,
	): Promise<any> {
		const iterations = step.iterations || 1
		const results: any[] = []

		for (let i = 0; i < iterations; i++) {
			// Execute nested steps
			if (step.steps) {
				for (const nestedStep of step.steps) {
					const nestedResult = await this.executeStep(context, nestedStep, workflow)
					results.push(nestedResult)
				}
			}
		}

		return {
			iterations,
			results,
			timestamp: new Date(),
		}
	}

	/**
	 * Execute a parallel step
	 */
	private async executeParallelStep(
		context: WorkflowExecutionContext,
		step: BmadWorkflowStep,
		workflow: BmadWorkflow,
	): Promise<any> {
		if (!step.steps || step.steps.length === 0) {
			throw new Error("Parallel step requires nested steps")
		}

		// Execute all steps in parallel
		const promises = step.steps.map((nestedStep) => this.executeStep(context, nestedStep, workflow))

		const results = await Promise.all(promises)

		return {
			steps: results,
			timestamp: new Date(),
		}
	}

	/**
	 * Evaluate conditions
	 */
	private evaluateConditions(conditions: any[], variables: Record<string, any>): boolean {
		// Simple condition evaluation
		// In a real implementation, this would use a more sophisticated expression evaluator
		for (const condition of conditions) {
			if (typeof condition === "boolean") {
				if (!condition) return false
			} else if (typeof condition === "string") {
				// Check if variable exists and is truthy
				const value = variables[condition]
				if (!value) return false
			} else if (typeof condition === "object" && condition !== null) {
				// Evaluate object condition
				const { variable, operator, value } = condition
				const varValue = variables[variable]

				switch (operator) {
					case "equals":
						if (varValue !== value) return false
						break
					case "not_equals":
						if (varValue === value) return false
						break
					case "contains":
						if (!Array.isArray(varValue) || !varValue.includes(value)) return false
						break
					case "greater_than":
						if (typeof varValue !== "number" || varValue <= value) return false
						break
					case "less_than":
						if (typeof varValue !== "number" || varValue >= value) return false
						break
					default:
						return false
				}
			}
		}

		return true
	}

	/**
	 * Pause a workflow session
	 */
	async pauseSession(sessionId: string): Promise<boolean> {
		const session = this.activeSessions.get(sessionId)
		if (!session) {
			return false
		}

		session.status = "paused"
		await this.emitEvent("workflow_paused", { sessionId })

		logger.info("[BmadWorkflowEngine] Session paused", { sessionId })
		return true
	}

	/**
	 * Resume a paused workflow session
	 */
	async resumeSession(sessionId: string): Promise<boolean> {
		const session = this.activeSessions.get(sessionId)
		if (!session || session.status !== "paused") {
			return false
		}

		session.status = "running"
		await this.emitEvent("workflow_resumed", { sessionId })

		logger.info("[BmadWorkflowEngine] Session resumed", { sessionId })
		return true
	}

	/**
	 * Cancel a workflow session
	 */
	async cancelSession(sessionId: string): Promise<boolean> {
		const session = this.activeSessions.get(sessionId)
		if (!session) {
			return false
		}

		session.status = "cancelled"
		this.activeSessions.delete(sessionId)

		await this.emitEvent("workflow_cancelled", { sessionId })

		logger.info("[BmadWorkflowEngine] Session cancelled", { sessionId })
		return true
	}

	/**
	 * Get active sessions
	 */
	getActiveSessions(): WorkflowExecutionContext[] {
		return Array.from(this.activeSessions.values())
	}

	/**
	 * Get session by ID
	 */
	getSession(sessionId: string): WorkflowExecutionContext | undefined {
		return this.activeSessions.get(sessionId)
	}

	/**
	 * Add event listener
	 */
	addEventListener(eventType: WorkflowEventType, listener: WorkflowEventListener): void {
		if (!this.eventListeners.has(eventType)) {
			this.eventListeners.set(eventType, new Set())
		}
		this.eventListeners.get(eventType)!.add(listener)
	}

	/**
	 * Remove event listener
	 */
	removeEventListener(eventType: WorkflowEventType, listener: WorkflowEventListener): void {
		const listeners = this.eventListeners.get(eventType)
		if (listeners) {
			listeners.delete(listener)
		}
	}

	/**
	 * Emit event to listeners
	 */
	private async emitEvent(eventType: WorkflowEventType, data: any): Promise<void> {
		const listeners = this.eventListeners.get(eventType)
		if (!listeners) {
			return
		}

		for (const listener of Array.from(listeners)) {
			try {
				await listener(eventType, data)
			} catch (error) {
				logger.error("[BmadWorkflowEngine] Event listener error", {
					eventType,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
	}

	/**
	 * Generate unique session ID
	 */
	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Get available workflows
	 */
	getAvailableWorkflows(): BmadWorkflow[] {
		return this.integrationService.getAllWorkflows()
	}

	/**
	 * Get workflow by ID
	 */
	getWorkflowById(workflowId: string): BmadWorkflow | undefined {
		return this.integrationService.getWorkflowById(workflowId)
	}

	/**
	 * Check if initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		// Cancel all active sessions
		for (const sessionId of Array.from(this.activeSessions.keys())) {
			this.cancelSession(sessionId)
		}

		this.activeSessions.clear()
		this.eventListeners.clear()
		this.isInitialized = false

		logger.info("[BmadWorkflowEngine] Disposed")
	}
}
