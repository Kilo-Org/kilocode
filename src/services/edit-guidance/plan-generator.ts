// kilocode_change - new file

/**
 * Edit Plan Generator Service
 * Generates comprehensive edit plans using AST analysis and code understanding
 */

import type { EditPlan, EditPlanGenerationRequest, EditPlanResponse, EditStep, FileReference } from "./types"
import { EntityFactory } from "./models"
import { getASTAnalyzer } from "./ast-analyzer"
import { EditGuidanceError, AnalysisError } from "./types"

export interface PlanGeneratorConfig {
	/** Maximum number of steps to generate */
	maxSteps?: number
	/** Whether to include test files */
	includeTests?: boolean
	/** Whether to include documentation files */
	includeDocumentation?: boolean
	/** Whether to analyze dependencies */
	analyzeDependencies?: boolean
	/** Scope of analysis */
	defaultScope?: "current-file" | "project" | "dependencies"
}

export class PlanGeneratorService {
	private config: Required<PlanGeneratorConfig>
	private astAnalyzer: ReturnType<typeof getASTAnalyzer>

	constructor(config: PlanGeneratorConfig = {}) {
		this.config = {
			maxSteps: config.maxSteps ?? 50,
			includeTests: config.includeTests ?? true,
			includeDocumentation: config.includeDocumentation ?? true,
			analyzeDependencies: config.analyzeDependencies ?? true,
			defaultScope: config.defaultScope ?? "project",
		}
		this.astAnalyzer = getASTAnalyzer()
	}

	/**
	 * Generate an edit plan from initial change
	 */
	async generatePlan(request: EditPlanGenerationRequest, userId: string = "default-user"): Promise<EditPlanResponse> {
		try {
			// Validate request
			if (!request.initialChange.filePath || !request.initialChange.filePath.startsWith("/")) {
				throw new EditGuidanceError("Invalid file path: must be absolute", "INVALID_INPUT")
			}

			// Determine scope
			const scope = request.scope || this.config.defaultScope

			// Create plan entity
			const plan = EntityFactory.createEditPlan({
				userId,
				title: this.generatePlanTitle(request.initialChange),
				description: request.initialChange.content || "Auto-generated edit plan",
				status: "pending",
				metadata: {
					complexity: this.estimateComplexity(request),
				},
			})

			// Analyze the change and generate steps
			const steps = await this.generateSteps(request, scope)

			// Validate step count
			if (steps.length > this.config.maxSteps) {
				throw new EditGuidanceError(
					`Generated plan exceeds maximum steps (${this.config.maxSteps})`,
					"PLAN_TOO_LARGE",
				)
			}

			plan.steps = steps

			// Estimate files affected
			const totalFiles = steps.reduce((count, step) => count + step.files.length, 0)
			plan.setEstimatedFiles(totalFiles)

			return {
				plan: plan.toJSON(),
				success: true,
				warnings: this.generateWarnings(steps),
			}
		} catch (error) {
			if (error instanceof EditGuidanceError || error instanceof AnalysisError) {
				throw error
			}
			throw new EditGuidanceError(`Failed to generate plan: ${error}`, "GENERATE_PLAN_FAILED", error)
		}
	}

	/**
	 * Generate steps for the edit plan
	 */
	private async generateSteps(
		request: EditPlanGenerationRequest,
		scope: "current-file" | "project" | "dependencies",
	): Promise<EditStep[]> {
		const steps: EditStep[] = []
		const { initialChange } = request

		// Analyze the file to understand the change
		const fileContent = await this.readFile(initialChange.filePath)
		const analysis = await this.astAnalyzer.analyzeFile(initialChange.filePath, fileContent)

		// Step 1: Apply the initial change
		const initialStep = this.createInitialStep(initialChange, analysis)
		steps.push(initialStep)

		// If scope is broader than current-file, analyze dependencies
		if (scope !== "current-file") {
			// Step 2: Update imports in dependent files
			const importSteps = await this.generateImportUpdateSteps(analysis, scope)
			steps.push(...importSteps)

			// Step 3: Update function calls in dependent files
			const referenceSteps = await this.generateReferenceUpdateSteps(analysis, scope)
			steps.push(...referenceSteps)
		}

		// Step 4: Update tests if included
		if (request.includeTests && this.config.includeTests) {
			const testSteps = await this.generateTestUpdateSteps(analysis)
			steps.push(...testSteps)
		}

		// Step 5: Update documentation if included
		if (request.includeDocumentation && this.config.includeDocumentation) {
			const docSteps = await this.generateDocumentationUpdateSteps(analysis)
			steps.push(...docSteps)
		}

		// Set dependencies between steps
		this.setStepDependencies(steps)

		return steps
	}

	/**
	 * Create the initial step for the change
	 */
	private createInitialStep(initialChange: EditPlanGenerationRequest["initialChange"], analysis: any): EditStep {
		const step = EntityFactory.createUpdateStep(
			"plan-id", // Will be set when plan is created
			1,
			`Apply ${initialChange.changeType} to ${this.getFileName(initialChange.filePath)}`,
			`Apply ${initialChange.changeType} operation to ${initialChange.filePath}`,
		)

		// Add file reference
		const fileRef = EntityFactory.createFileUpdate(
			"step-id", // Will be set when step is created
			initialChange.filePath,
			initialChange.content || "", // oldContent
			initialChange.content || "", // newContent
		)

		step.files = [fileRef.toJSON()]

		return step.toJSON()
	}

	/**
	 * Generate steps to update imports in dependent files
	 */
	private async generateImportUpdateSteps(
		analysis: any,
		scope: "current-file" | "project" | "dependencies",
	): Promise<EditStep[]> {
		const steps: EditStep[] = []

		// Get all exports from the file
		const exports = analysis.exports || []

		if (exports.length === 0) {
			return steps
		}

		// TODO: Find files that import these exports
		// For now, create placeholder steps
		const step = EntityFactory.createUpdateStep(
			"plan-id",
			2,
			"Update imports in dependent files",
			`Update import statements for exports: ${exports.map((e: any) => e.name).join(", ")}`,
		)

		step.files = [] // Will be populated when actual files are found

		steps.push(step.toJSON())

		return steps
	}

	/**
	 * Generate steps to update function calls in dependent files
	 */
	private async generateReferenceUpdateSteps(
		analysis: any,
		scope: "current-file" | "project" | "dependencies",
	): Promise<EditStep[]> {
		const steps: EditStep[] = []

		// Get all function/class definitions
		const definitions = analysis.references?.filter((ref: any) => ref.isDefinition) || []

		if (definitions.length === 0) {
			return steps
		}

		// TODO: Find files that reference these definitions
		// For now, create placeholder steps
		const step = EntityFactory.createUpdateStep(
			"plan-id",
			3,
			"Update function calls in dependent files",
			`Update function calls for: ${definitions.map((d: any) => d.name).join(", ")}`,
		)

		step.files = [] // Will be populated when actual files are found

		steps.push(step.toJSON())

		return steps
	}

	/**
	 * Generate steps to update tests
	 */
	private async generateTestUpdateSteps(analysis: any): Promise<EditStep[]> {
		const steps: EditStep[] = []

		// TODO: Find test files that reference the changed code
		// For now, create placeholder step
		const step = EntityFactory.createUpdateStep(
			"plan-id",
			4,
			"Update related tests",
			"Update test files that reference the modified code",
		)

		step.files = []

		steps.push(step.toJSON())

		return steps
	}

	/**
	 * Generate steps to update documentation
	 */
	private async generateDocumentationUpdateSteps(analysis: any): Promise<EditStep[]> {
		const steps: EditStep[] = []

		// TODO: Find documentation files that reference the changed code
		// For now, create placeholder step
		const step = EntityFactory.createUpdateStep(
			"plan-id",
			5,
			"Update documentation",
			"Update documentation files that reference the modified code",
		)

		step.files = []

		steps.push(step.toJSON())

		return steps
	}

	/**
	 * Set dependencies between steps
	 */
	private setStepDependencies(steps: EditStep[]): void {
		// Step 1 has no dependencies
		// Step 2 depends on Step 1
		// Step 3 depends on Step 1
		// Step 4 depends on Step 1
		// Step 5 depends on Step 1

		for (let i = 1; i < steps.length; i++) {
			steps[i].dependencies = [steps[0].id]
		}
	}

	/**
	 * Generate a title for the plan
	 */
	private generatePlanTitle(initialChange: EditPlanGenerationRequest["initialChange"]): string {
		const fileName = this.getFileName(initialChange.filePath)
		const action =
			initialChange.changeType === "create"
				? "Create"
				: initialChange.changeType === "delete"
					? "Delete"
					: "Update"

		return `${action} ${fileName}`
	}

	/**
	 * Estimate complexity of the plan
	 */
	private estimateComplexity(request: EditPlanGenerationRequest): "low" | "medium" | "high" {
		const scope = request.scope || this.config.defaultScope

		if (scope === "current-file") {
			return "low"
		} else if (scope === "project") {
			return "medium"
		} else {
			return "high"
		}
	}

	/**
	 * Generate warnings for the plan
	 */
	private generateWarnings(steps: EditStep[]): string[] {
		const warnings: string[] = []

		// Check for steps with no files
		const emptySteps = steps.filter((step) => step.files.length === 0)
		if (emptySteps.length > 0) {
			warnings.push(`${emptySteps.length} steps have no associated files yet`)
		}

		// Check for large number of steps
		if (steps.length > 10) {
			warnings.push(`Plan contains ${steps.length} steps - consider breaking into smaller plans`)
		}

		// Check for steps with many dependencies
		const complexSteps = steps.filter((step) => step.dependencies.length > 2)
		if (complexSteps.length > 0) {
			warnings.push(`${complexSteps.length} steps have multiple dependencies`)
		}

		return warnings
	}

	/**
	 * Get file name from path
	 */
	private getFileName(filePath: string): string {
		return filePath.split("/").pop() || filePath
	}

	/**
	 * Read file content (placeholder - will integrate with VSCode API)
	 */
	private async readFile(filePath: string): Promise<string> {
		// TODO: Integrate with VSCode API or file system
		// For now, return empty string
		return ""
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: PlanGeneratorService | null = null

export function getPlanGeneratorService(config?: PlanGeneratorConfig): PlanGeneratorService {
	if (!instance) {
		instance = new PlanGeneratorService(config)
	}
	return instance
}

export function resetPlanGeneratorService(): void {
	instance = null
}
