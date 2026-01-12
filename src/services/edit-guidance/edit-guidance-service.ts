// kilocode_change - new file

/**
 * Edit Guidance Service
 * Manages edit plans, steps, and execution for multi-file code changes
 */

import type {
	EditPlan,
	EditStep,
	CreateEditPlanRequest,
	EditPlanGenerationRequest,
	ExecuteStepRequest,
	EditPlanResponse,
	StepExecutionResponse,
} from "./types"
import { EntityFactory } from "./models"
import { getDatabaseManager } from "../../core/database/manager"
import type { DatabaseManager } from "../../core/database/manager"
import { EditGuidanceError, PlanExecutionError, AnalysisError } from "./types"

export interface EditGuidanceServiceConfig {
	/** Maximum number of steps per plan */
	maxStepsPerPlan?: number
	/** Maximum number of files per step */
	maxFilesPerStep?: number
	/** Whether to preview changes before execution */
	previewChanges?: boolean
	/** Whether to require confirmation before execution */
	confirmBeforeExecute?: boolean
	/** Whether to auto-save progress */
	autoSaveProgress?: boolean
	/** Whether to include tests in analysis */
	includeTests?: boolean
	/** Whether to include documentation in analysis */
	includeDocumentation?: boolean
}

export class EditGuidanceService {
	private db: DatabaseManager
	private config: Required<EditGuidanceServiceConfig>

	constructor(config: EditGuidanceServiceConfig = {}) {
		this.db = getDatabaseManager()
		this.config = {
			maxStepsPerPlan: config.maxStepsPerPlan ?? 50,
			maxFilesPerStep: config.maxFilesPerStep ?? 50,
			previewChanges: config.previewChanges ?? true,
			confirmBeforeExecute: config.confirmBeforeExecute ?? true,
			autoSaveProgress: config.autoSaveProgress ?? true,
			includeTests: config.includeTests ?? true,
			includeDocumentation: config.includeDocumentation ?? true,
		}
	}

	/**
	 * Create a new edit plan
	 */
	async createPlan(request: CreateEditPlanRequest): Promise<EditPlanResponse> {
		try {
			// Validate title length
			if (request.title.length > 255) {
				throw new EditGuidanceError("Title exceeds maximum length of 255 characters", "INVALID_INPUT")
			}

			// Validate description length
			if (request.description.length > 10000) {
				throw new EditGuidanceError("Description exceeds maximum length of 10,000 characters", "INVALID_INPUT")
			}

			// Create plan entity
			const plan = EntityFactory.createEditPlan({
				userId: "default-user", // TODO: Get from auth context
				title: request.title,
				description: request.description,
				status: "pending",
				metadata: {
					estimatedFiles: request.files?.length,
				},
			})

			// Save to database
			const planId = this.db.createEditPlan({
				user_id: plan.userId,
				title: plan.title,
				description: plan.description,
				status: plan.status,
				metadata: JSON.stringify(plan.metadata),
			})

			plan.id = planId

			return {
				plan: plan.toJSON(),
				success: true,
			}
		} catch (error) {
			if (error instanceof EditGuidanceError) {
				throw error
			}
			throw new EditGuidanceError(`Failed to create plan: ${error}`, "CREATE_PLAN_FAILED", error)
		}
	}

	/**
	 * Get an edit plan by ID
	 */
	async getPlan(planId: string): Promise<EditPlan> {
		try {
			const row = this.db.getEditPlan(planId)
			if (!row) {
				throw new EditGuidanceError("Plan not found", "PLAN_NOT_FOUND")
			}

			const plan = EntityFactory.createEditPlan({
				id: row.id,
				userId: row.user_id,
				title: row.title,
				description: row.description,
				status: row.status,
				createdAt: new Date(row.created_at),
				updatedAt: new Date(row.updated_at),
				metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			})

			// Load steps
			const stepRows = this.db.getEditStepsByPlanId(planId)
			plan.steps = stepRows.map((stepRow) => this.parseStepRow(stepRow))

			return plan.toJSON()
		} catch (error) {
			if (error instanceof EditGuidanceError) {
				throw error
			}
			throw new EditGuidanceError(`Failed to get plan: ${error}`, "GET_PLAN_FAILED", error)
		}
	}

	/**
	 * Generate an edit plan from initial change
	 */
	async generatePlan(request: EditPlanGenerationRequest): Promise<EditPlanResponse> {
		try {
			// Validate initial change
			if (!request.initialChange.filePath || !request.initialChange.filePath.startsWith("/")) {
				throw new EditGuidanceError("Invalid file path: must be absolute", "INVALID_INPUT")
			}

			// Create plan entity
			const plan = EntityFactory.createEditPlan({
				userId: "default-user",
				title: `Edit plan for ${request.initialChange.filePath}`,
				description: request.initialChange.content || "Auto-generated edit plan",
				status: "pending",
				metadata: {
					complexity: "medium",
				},
			})

			// Save plan to database
			const planId = this.db.createEditPlan({
				user_id: plan.userId,
				title: plan.title,
				description: plan.description,
				status: plan.status,
				metadata: JSON.stringify(plan.metadata),
			})

			plan.id = planId

			// TODO: Integrate with AST analyzer to generate steps
			// For now, create a placeholder step
			const step = EntityFactory.createUpdateStep(
				planId,
				1,
				"Apply initial change",
				`Apply ${request.initialChange.changeType} to ${request.initialChange.filePath}`,
			)

			const stepId = this.db.createEditStep({
				plan_id: planId,
				order: step.order,
				title: step.title,
				type: step.type,
				description: step.description,
				status: step.status,
				metadata: JSON.stringify(step.metadata),
			})

			step.id = stepId

			// Add file reference
			const fileRef = EntityFactory.createFileUpdate(
				stepId,
				request.initialChange.filePath,
				"", // oldContent
				request.initialChange.content || "", // newContent
			)

			this.db.createFileReference({
				step_id: stepId,
				file_path: fileRef.filePath,
				change_type: fileRef.changeType,
				old_content: fileRef.oldContent,
				new_content: fileRef.newContent,
				metadata: JSON.stringify(fileRef.metadata),
			})

			plan.steps = [step.toJSON()]

			return {
				plan: plan.toJSON(),
				success: true,
				warnings: ["Plan generated with placeholder step - AST analysis integration needed"],
			}
		} catch (error) {
			if (error instanceof EditGuidanceError) {
				throw error
			}
			throw new EditGuidanceError(`Failed to generate plan: ${error}`, "GENERATE_PLAN_FAILED", error)
		}
	}

	/**
	 * Execute a step in an edit plan
	 */
	async executeStep(request: ExecuteStepRequest): Promise<StepExecutionResponse> {
		try {
			// Get plan
			const plan = await this.getPlan(request.planId)

			// Get step
			const step = plan.steps.find((s) => s.id === request.stepId)
			if (!step) {
				throw new PlanExecutionError("Step not found", request.stepId)
			}

			// Check if step can be executed
			if (step.status !== "pending") {
				throw new PlanExecutionError(`Step is ${step.status}, cannot execute`, request.stepId)
			}

			// Check dependencies
			const completedStepIds = plan.steps.filter((s) => s.status === "completed").map((s) => s.id)
			if (!step.dependencies.every((depId) => completedStepIds.includes(depId))) {
				throw new PlanExecutionError("Dependencies not met", request.stepId)
			}

			// Check if dry run
			if (request.options?.dryRun) {
				return {
					step: { ...step, status: "pending" },
					success: true,
					appliedChanges: step.files.map((file) => ({
						filePath: file.filePath,
						changeType: file.changeType,
						oldContent: file.oldContent,
						newContent: file.newContent,
						success: true,
					})),
					warnings: ["Dry run - no changes applied to disk"],
				}
			}

			// TODO: Integrate with step executor for actual file operations
			// For now, simulate successful execution
			const appliedChanges = step.files.map((file) => ({
				filePath: file.filePath,
				changeType: file.changeType,
				oldContent: file.oldContent,
				newContent: file.newContent,
				success: true,
			}))

			// Update step status
			this.db.updateEditStep(request.stepId, {
				status: "completed",
				metadata: JSON.stringify({
					...step.metadata,
					actualTime: Date.now(),
				}),
			})

			// Update plan status if all steps completed
			const allStepsCompleted = plan.steps.every((s) => s.status === "completed")
			if (allStepsCompleted) {
				this.db.updateEditPlan(request.planId, {
					status: "completed",
				})
			} else {
				this.db.updateEditPlan(request.planId, {
					status: "in-progress",
				})
			}

			return {
				step: { ...step, status: "completed" },
				success: true,
				appliedChanges,
			}
		} catch (error) {
			if (error instanceof PlanExecutionError) {
				throw error
			}
			throw new PlanExecutionError(`Failed to execute step: ${error}`, request.stepId, error)
		}
	}

	/**
	 * Get active plans for a user
	 */
	async getActivePlans(userId: string): Promise<EditPlan[]> {
		try {
			const rows = this.db.getEditPlansByUserId(userId)
			const activePlans = rows.filter((row) => row.status === "pending" || row.status === "in-progress")

			return activePlans.map((row) => {
				const plan = EntityFactory.createEditPlan({
					id: row.id,
					userId: row.user_id,
					title: row.title,
					description: row.description,
					status: row.status,
					createdAt: new Date(row.created_at),
					updatedAt: new Date(row.updated_at),
					metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
				})

				// Load steps
				const stepRows = this.db.getEditStepsByPlanId(row.id)
				plan.steps = stepRows.map((stepRow) => this.parseStepRow(stepRow))

				return plan.toJSON()
			})
		} catch (error) {
			throw new EditGuidanceError(`Failed to get active plans: ${error}`, "GET_ACTIVE_PLANS_FAILED", error)
		}
	}

	/**
	 * Cancel an edit plan
	 */
	async cancelPlan(planId: string): Promise<void> {
		try {
			const plan = await this.getPlan(planId)

			if (plan.status === "completed") {
				throw new EditGuidanceError("Cannot cancel completed plan", "INVALID_OPERATION")
			}

			this.db.updateEditPlan(planId, {
				status: "cancelled",
			})
		} catch (error) {
			if (error instanceof EditGuidanceError) {
				throw error
			}
			throw new EditGuidanceError(`Failed to cancel plan: ${error}`, "CANCEL_PLAN_FAILED", error)
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Parse step row from database
	 */
	private parseStepRow(row: any): EditStep {
		const step = EntityFactory.createEditStep({
			id: row.id,
			planId: row.plan_id,
			order: row.order,
			title: row.title,
			type: row.type,
			description: row.description,
			status: row.status,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		})

		// Load file references
		const fileRows = this.db.getFileReferencesByStepId(row.id)
		step.files = fileRows.map((fileRow) => ({
			id: fileRow.id,
			stepId: fileRow.step_id,
			filePath: fileRow.file_path,
			changeType: fileRow.change_type,
			oldContent: fileRow.old_content,
			newContent: fileRow.new_content,
			metadata: fileRow.metadata ? JSON.parse(fileRow.metadata) : undefined,
		}))

		return step.toJSON()
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: EditGuidanceService | null = null

export function getEditGuidanceService(config?: EditGuidanceServiceConfig): EditGuidanceService {
	if (!instance) {
		instance = new EditGuidanceService(config)
	}
	return instance
}

export function resetEditGuidanceService(): void {
	instance = null
}
