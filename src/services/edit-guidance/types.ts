// kilocode_change - new file

/**
 * Edit guidance service types for next edit guidance system
 * Provides TypeScript interfaces for multi-file edit planning and execution
 */

export interface EditPlan {
	id: string
	userId: string
	title: string
	description: string
	status: "pending" | "in-progress" | "completed" | "cancelled"
	steps: EditStep[]
	createdAt: Date
	updatedAt: Date
	metadata?: PlanMetadata
}

export interface EditStep {
	id: string
	planId: string
	order: number
	title: string
	type: "create" | "update" | "delete" | "move"
	files: FileReference[]
	description: string
	status: "pending" | "completed" | "skipped" | "failed"
	dependencies: string[]
	metadata?: StepMetadata
}

export interface FileReference {
	id: string
	stepId: string
	filePath: string
	changeType: "create" | "update" | "delete"
	oldContent?: string
	newContent?: string
	metadata?: FileMetadata
}

// Metadata interfaces
export interface PlanMetadata {
	estimatedDuration?: number
	complexity?: "low" | "medium" | "high"
	riskLevel?: "low" | "medium" | "high"
	affectedComponents?: string[]
	estimatedFiles?: number
	actualDuration?: number
}

export interface StepMetadata {
	estimatedTime?: number
	actualTime?: number
	conflicts?: string[]
	warnings?: string[]
	manualSteps?: string[]
	verificationRequired?: boolean
}

export interface FileMetadata {
	size?: number
	lines?: number
	language?: string
	lastModified?: Date
	checksum?: string
	encoding?: string
}

// Request/Response types
export interface CreateEditPlanRequest {
	title: string
	description: string
	files?: string[]
	type?: "refactor" | "upgrade" | "restructure" | "custom"
}

export interface EditPlanGenerationRequest {
	initialChange: {
		filePath: string
		changeType: "create" | "update" | "delete"
		content?: string
	}
	scope?: "current-file" | "project" | "dependencies"
	includeTests?: boolean
	includeDocumentation?: boolean
}

export interface ExecuteStepRequest {
	planId: string
	stepId: string
	options?: {
		skipConfirmation?: boolean
		dryRun?: boolean
		force?: boolean
	}
}

export interface EditPlanResponse {
	plan: EditPlan
	success: boolean
	warnings?: string[]
	errors?: string[]
}

export interface StepExecutionResponse {
	step: EditStep
	success: boolean
	appliedChanges: FileChange[]
	conflicts?: FileConflict[]
	warnings?: string[]
}

export interface FileChange {
	filePath: string
	changeType: "create" | "update" | "delete"
	oldContent?: string
	newContent?: string
	success: boolean
	error?: string
}

export interface FileConflict {
	filePath: string
	type: "content" | "permission" | "locking"
	description: string
	resolution?: string
}

// Analysis types
export interface CodeAnalysis {
	filePath: string
	language: string
	ast?: any
	dependencies: Dependency[]
	references: CodeReference[]
	imports: ImportStatement[]
	exports: ExportStatement[]
}

export interface Dependency {
	name: string
	version?: string
	type: "import" | "require" | "include"
	source: string
	isExternal: boolean
}

export interface CodeReference {
	name: string
	type: "function" | "class" | "variable" | "interface" | "type"
	filePath: string
	line: number
	column: number
	isDefinition: boolean
}

export interface ImportStatement {
	module: string
	name?: string
	alias?: string
	isDefault: boolean
	isTypeOnly: boolean
	filePath: string
	line: number
}

export interface ExportStatement {
	name: string
	type: "function" | "class" | "interface" | "type" | "variable" | "default"
	isDefault: boolean
	filePath: string
	line: number
}

// Error types
export class EditGuidanceError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly originalError?: any,
	) {
		super(message)
		this.name = "EditGuidanceError"
	}
}

export class PlanExecutionError extends EditGuidanceError {
	constructor(
		message: string,
		public readonly stepId?: string,
		public override readonly originalError?: any,
	) {
		super(message, "PLAN_EXECUTION_ERROR", originalError)
	}
}

export class AnalysisError extends EditGuidanceError {
	constructor(
		message: string,
		public readonly filePath?: string,
		public override readonly originalError?: any,
	) {
		super(message, "ANALYSIS_ERROR", originalError)
	}
}

// Utility types
export type EditPlanStatus = "pending" | "in-progress" | "completed" | "cancelled"
export type StepStatus = "pending" | "completed" | "skipped" | "failed"
export type ChangeType = "create" | "update" | "delete" | "move"
export type EditType = "refactor" | "upgrade" | "restructure" | "custom"
export type AnalysisScope = "current-file" | "project" | "dependencies"
export type ConflictType = "content" | "permission" | "locking"

// Configuration types
export interface EditGuidanceSettings {
	maxStepsPerPlan: number
	previewChanges: boolean
	confirmBeforeExecute: boolean
	autoSaveProgress: boolean
	includeTests: boolean
	includeDocumentation: boolean
	maxFilesPerStep: number
}

// Event types
export interface EditGuidanceEvent {
	type: "plan_created" | "step_started" | "step_completed" | "plan_completed" | "plan_cancelled"
	planId: string
	stepId?: string
	timestamp: Date
	data?: any
}
