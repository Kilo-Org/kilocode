// kilocode_change - new file for BMAD-METHOD workflow tools

import type { BmadWorkflow, WorkflowExecutionOptions, WorkflowResult } from "./types"
import { BmadWorkflowEngine } from "./BmadWorkflowEngine"
import { logger } from "../../utils/logging"
import { t } from "../../i18n"

/**
 * BMAD workflow tool parameters
 */
export interface ExecuteWorkflowToolParams {
	workflowId: string
	variables?: Record<string, any>
}

/**
 * List workflows tool result
 */
export interface ListWorkflowsResult {
	workflows: Array<{
		id: string
		name: string
		description: string
		module: string
		stepCount: number
	}>
}

/**
 * Get workflow details tool result
 */
export interface GetWorkflowDetailsResult {
	workflow: BmadWorkflow | null
}

/**
 * BMAD workflow tools
 * Provides tools for executing and managing BMAD workflows
 */
export class BmadWorkflowTools {
	private workflowEngine: BmadWorkflowEngine

	constructor(workflowEngine: BmadWorkflowEngine) {
		this.workflowEngine = workflowEngine
	}

	/**
	 * Execute a BMAD workflow
	 */
	async executeWorkflow(params: ExecuteWorkflowToolParams): Promise<WorkflowResult> {
		try {
			const { workflowId, variables = {} } = params

			logger.info("[BmadWorkflowTools] Executing workflow", { workflowId })

			const options: WorkflowExecutionOptions = {
				variables,
			}

			const result = await this.workflowEngine.executeWorkflow(workflowId, options)

			if (result.success) {
				logger.info("[BmadWorkflowTools] Workflow executed successfully", {
					workflowId,
					duration: result.duration,
				})
			} else {
				logger.error("[BmadWorkflowTools] Workflow execution failed", {
					workflowId,
					error: result.error,
				})
			}

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Failed to execute workflow", {
				workflowId: params.workflowId,
				error: errorMessage,
			})

			return {
				success: false,
				sessionId: "",
				workflowId: params.workflowId,
				error: errorMessage,
				steps: [],
				duration: 0,
				variables: {},
			}
		}
	}

	/**
	 * List all available BMAD workflows
	 */
	async listWorkflows(): Promise<ListWorkflowsResult> {
		try {
			const workflows = this.workflowEngine.getAvailableWorkflows()

			const result = {
				workflows: workflows.map((workflow) => ({
					id: workflow.id,
					name: workflow.name,
					description: workflow.description,
					module: workflow.moduleId,
					stepCount: workflow.steps.length,
				})),
			}

			logger.info("[BmadWorkflowTools] Listed workflows", { count: result.workflows.length })

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Failed to list workflows", { error: errorMessage })

			return { workflows: [] }
		}
	}

	/**
	 * Get details of a specific workflow
	 */
	async getWorkflowDetails(workflowId: string): Promise<GetWorkflowDetailsResult> {
		try {
			const workflow = this.workflowEngine.getWorkflowById(workflowId)

			logger.info("[BmadWorkflowTools] Retrieved workflow details", { workflowId })

			return { workflow: workflow || null }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Failed to get workflow details", {
				workflowId,
				error: errorMessage,
			})

			return { workflow: null }
		}
	}

	/**
	 * Get active workflow sessions
	 */
	async getActiveSessions() {
		try {
			const sessions = this.workflowEngine.getActiveSessions()

			logger.info("[BmadWorkflowTools] Retrieved active sessions", { count: sessions.length })

			return {
				sessions: sessions.map((session) => ({
					sessionId: session.sessionId,
					workflowId: session.workflowId,
					startTime: session.startTime,
					currentStepIndex: session.currentStepIndex,
					status: session.status,
				})),
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Failed to get active sessions", { error: errorMessage })

			return { sessions: [] }
		}
	}

	/**
	 * Pause a workflow session
	 */
	async pauseSession(sessionId: string): Promise<{ success: boolean; message: string }> {
		try {
			const success = await this.workflowEngine.pauseSession(sessionId)

			if (success) {
				logger.info("[BmadWorkflowTools] Session paused", { sessionId })
				return { success: true, message: `Session ${sessionId} paused successfully` }
			} else {
				logger.warn("[BmadWorkflowTools] Failed to pause session", { sessionId })
				return { success: false, message: `Failed to pause session ${sessionId}` }
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Error pausing session", { sessionId, error: errorMessage })
			return { success: false, message: `Error pausing session: ${errorMessage}` }
		}
	}

	/**
	 * Resume a paused workflow session
	 */
	async resumeSession(sessionId: string): Promise<{ success: boolean; message: string }> {
		try {
			const success = await this.workflowEngine.resumeSession(sessionId)

			if (success) {
				logger.info("[BmadWorkflowTools] Session resumed", { sessionId })
				return { success: true, message: `Session ${sessionId} resumed successfully` }
			} else {
				logger.warn("[BmadWorkflowTools] Failed to resume session", { sessionId })
				return { success: false, message: `Failed to resume session ${sessionId}` }
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Error resuming session", { sessionId, error: errorMessage })
			return { success: false, message: `Error resuming session: ${errorMessage}` }
		}
	}

	/**
	 * Cancel a workflow session
	 */
	async cancelSession(sessionId: string): Promise<{ success: boolean; message: string }> {
		try {
			const success = await this.workflowEngine.cancelSession(sessionId)

			if (success) {
				logger.info("[BmadWorkflowTools] Session cancelled", { sessionId })
				return { success: true, message: `Session ${sessionId} cancelled successfully` }
			} else {
				logger.warn("[BmadWorkflowTools] Failed to cancel session", { sessionId })
				return { success: false, message: `Failed to cancel session ${sessionId}` }
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			logger.error("[BmadWorkflowTools] Error cancelling session", { sessionId, error: errorMessage })
			return { success: false, message: `Error cancelling session: ${errorMessage}` }
		}
	}

	/**
	 * Check if workflow engine is ready
	 */
	isReady(): boolean {
		return this.workflowEngine.isReady()
	}
}

/**
 * Create BMAD workflow tools instance
 */
export function createBmadWorkflowTools(workflowEngine: BmadWorkflowEngine): BmadWorkflowTools {
	return new BmadWorkflowTools(workflowEngine)
}
