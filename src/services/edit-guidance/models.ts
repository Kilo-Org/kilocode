// kilocode_change - new file

/**
 * Entity models for Edit Guidance Service
 * Provides data structures and validation for edit plans, steps, and file references
 */

import { v4 as uuidv4, validate as uuidValidate } from "uuid"
import type { EditPlan, EditStep, FileReference, PlanMetadata, StepMetadata, FileMetadata } from "./types"

/**
 * EditPlan Entity
 * Represents a multi-step code change operation
 */
export class EditPlanEntity implements EditPlan {
	id: string
	userId: string
	title: string
	description: string
	status: "pending" | "in-progress" | "completed" | "cancelled"
	steps: EditStep[]
	createdAt: Date
	updatedAt: Date
	metadata?: PlanMetadata

	constructor(data: Partial<EditPlan> = {}) {
		this.id = data.id || uuidv4()
		this.userId = data.userId || ""
		this.title = data.title || ""
		this.description = data.description || ""
		this.status = data.status || "pending"
		this.steps = data.steps || []
		this.createdAt = data.createdAt || new Date()
		this.updatedAt = data.updatedAt || new Date()
		this.metadata = data.metadata || {}
	}

	validate(): boolean {
		const errors: string[] = []

		if (!this.id || !uuidValidate(this.id)) {
			errors.push("Invalid plan ID")
		}

		if (!this.userId || this.userId.trim().length === 0) {
			errors.push("User ID is required")
		}

		if (!this.title || this.title.trim().length === 0) {
			errors.push("Title is required")
		}

		if (this.title && this.title.length > 255) {
			errors.push("Title exceeds maximum length of 255 characters")
		}

		if (!this.description || this.description.trim().length === 0) {
			errors.push("Description is required")
		}

		if (this.description && this.description.length > 10000) {
			errors.push("Description exceeds maximum length of 10,000 characters")
		}

		if (!["pending", "in-progress", "completed", "cancelled"].includes(this.status)) {
			errors.push("Invalid status")
		}

		if (!Array.isArray(this.steps)) {
			errors.push("Steps must be an array")
		}

		if (this.steps.length > 100) {
			errors.push("Plan cannot have more than 100 steps")
		}

		if (!(this.createdAt instanceof Date)) {
			errors.push("Invalid createdAt timestamp")
		}

		if (!(this.updatedAt instanceof Date)) {
			errors.push("Invalid updatedAt timestamp")
		}

		if (errors.length > 0) {
			throw new Error(`EditPlan validation failed: ${errors.join(", ")}`)
		}

		return true
	}

	toJSON(): EditPlan {
		return {
			id: this.id,
			userId: this.userId,
			title: this.title,
			description: this.description,
			status: this.status,
			steps: this.steps,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
			metadata: this.metadata,
		}
	}

	static fromJSON(data: EditPlan): EditPlanEntity {
		return new EditPlanEntity(data)
	}

	updateTimestamp(): void {
		this.updatedAt = new Date()
	}

	setStatus(status: "pending" | "in-progress" | "completed" | "cancelled"): void {
		this.status = status
		this.updateTimestamp()
	}

	addStep(step: EditStep): void {
		this.steps.push(step)
		this.updateTimestamp()
	}

	removeStep(stepId: string): void {
		this.steps = this.steps.filter((step) => step.id !== stepId)
		this.updateTimestamp()
	}

	getStepById(stepId: string): EditStep | undefined {
		return this.steps.find((step) => step.id === stepId)
	}

	getStepsByStatus(status: "pending" | "completed" | "skipped" | "failed"): EditStep[] {
		return this.steps.filter((step) => step.status === status)
	}

	getCompletedSteps(): EditStep[] {
		return this.getStepsByStatus("completed")
	}

	getPendingSteps(): EditStep[] {
		return this.getStepsByStatus("pending")
	}

	getFailedSteps(): EditStep[] {
		return this.getStepsByStatus("failed")
	}

	isPending(): boolean {
		return this.status === "pending"
	}

	isInProgress(): boolean {
		return this.status === "in-progress"
	}

	isCompleted(): boolean {
		return this.status === "completed"
	}

	isCancelled(): boolean {
		return this.status === "cancelled"
	}

	canExecute(): boolean {
		return this.status === "pending" || this.status === "in-progress"
	}

	getProgress(): number {
		if (this.steps.length === 0) return 0
		const completed = this.getCompletedSteps().length
		return Math.round((completed / this.steps.length) * 100)
	}

	setEstimatedDuration(duration: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.estimatedDuration = duration
	}

	setActualDuration(duration: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.actualDuration = duration
	}

	setComplexity(complexity: "low" | "medium" | "high"): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.complexity = complexity
	}

	setRiskLevel(risk: "low" | "medium" | "high"): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.riskLevel = risk
	}

	setEstimatedFiles(count: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.estimatedFiles = count
	}
}

/**
 * EditStep Entity
 * Represents individual steps within an edit plan
 */
export class EditStepEntity implements EditStep {
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

	constructor(data: Partial<EditStep> = {}) {
		this.id = data.id || uuidv4()
		this.planId = data.planId || ""
		this.order = data.order || 1
		this.title = data.title || ""
		this.type = data.type || "update"
		this.files = data.files || []
		this.description = data.description || ""
		this.status = data.status || "pending"
		this.dependencies = data.dependencies || []
		this.metadata = data.metadata || {}
	}

	validate(): boolean {
		const errors: string[] = []

		if (!this.id || !uuidValidate(this.id)) {
			errors.push("Invalid step ID")
		}

		if (!this.planId || this.planId.trim().length === 0) {
			errors.push("Plan ID is required")
		}

		if (this.order < 1) {
			errors.push("Order must be a positive integer")
		}

		if (!this.title || this.title.trim().length === 0) {
			errors.push("Title is required")
		}

		if (this.title && this.title.length > 255) {
			errors.push("Title exceeds maximum length of 255 characters")
		}

		if (!["create", "update", "delete", "move"].includes(this.type)) {
			errors.push("Invalid type: must be 'create', 'update', 'delete', or 'move'")
		}

		if (!Array.isArray(this.files)) {
			errors.push("Files must be an array")
		}

		if (this.files.length > 50) {
			errors.push("Step cannot have more than 50 files")
		}

		if (!this.description || this.description.trim().length === 0) {
			errors.push("Description is required")
		}

		if (!["pending", "completed", "skipped", "failed"].includes(this.status)) {
			errors.push("Invalid status")
		}

		if (!Array.isArray(this.dependencies)) {
			errors.push("Dependencies must be an array")
		}

		// Validate dependencies are valid UUIDs
		this.dependencies.forEach((depId) => {
			if (!uuidValidate(depId)) {
				errors.push(`Invalid dependency ID: ${depId}`)
			}
		})

		if (errors.length > 0) {
			throw new Error(`EditStep validation failed: ${errors.join(", ")}`)
		}

		return true
	}

	toJSON(): EditStep {
		return {
			id: this.id,
			planId: this.planId,
			order: this.order,
			title: this.title,
			type: this.type,
			files: this.files,
			description: this.description,
			status: this.status,
			dependencies: this.dependencies,
			metadata: this.metadata,
		}
	}

	static fromJSON(data: EditStep): EditStepEntity {
		return new EditStepEntity(data)
	}

	setStatus(status: "pending" | "completed" | "skipped" | "failed"): void {
		this.status = status
	}

	addFile(file: FileReference): void {
		this.files.push(file)
	}

	removeFile(fileId: string): void {
		this.files = this.files.filter((file) => file.id !== fileId)
	}

	getFileById(fileId: string): FileReference | undefined {
		return this.files.find((file) => file.id === fileId)
	}

	addDependency(stepId: string): void {
		if (!this.dependencies.includes(stepId)) {
			this.dependencies.push(stepId)
		}
	}

	removeDependency(stepId: string): void {
		this.dependencies = this.dependencies.filter((depId) => depId !== stepId)
	}

	hasDependencies(): boolean {
		return this.dependencies.length > 0
	}

	areDependenciesMet(completedStepIds: string[]): boolean {
		return this.dependencies.every((depId) => completedStepIds.includes(depId))
	}

	isPending(): boolean {
		return this.status === "pending"
	}

	isCompleted(): boolean {
		return this.status === "completed"
	}

	isSkipped(): boolean {
		return this.status === "skipped"
	}

	isFailed(): boolean {
		return this.status === "failed"
	}

	isCreate(): boolean {
		return this.type === "create"
	}

	isUpdate(): boolean {
		return this.type === "update"
	}

	isDelete(): boolean {
		return this.type === "delete"
	}

	isMove(): boolean {
		return this.type === "move"
	}

	setEstimatedTime(time: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.estimatedTime = time
	}

	setActualTime(time: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.actualTime = time
	}

	addConflict(conflict: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		if (!this.metadata.conflicts) {
			this.metadata.conflicts = []
		}
		this.metadata.conflicts.push(conflict)
	}

	addWarning(warning: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		if (!this.metadata.warnings) {
			this.metadata.warnings = []
		}
		this.metadata.warnings.push(warning)
	}

	setVerificationRequired(required: boolean): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.verificationRequired = required
	}
}

/**
 * FileReference Entity
 * Represents a file affected by an edit step
 */
export class FileReferenceEntity implements FileReference {
	id: string
	stepId: string
	filePath: string
	changeType: "create" | "update" | "delete"
	oldContent?: string
	newContent?: string
	metadata?: FileMetadata

	constructor(data: Partial<FileReference> = {}) {
		this.id = data.id || uuidv4()
		this.stepId = data.stepId || ""
		this.filePath = data.filePath || ""
		this.changeType = data.changeType || "update"
		this.oldContent = data.oldContent
		this.newContent = data.newContent
		this.metadata = data.metadata || {}
	}

	validate(): boolean {
		const errors: string[] = []

		if (!this.id || !uuidValidate(this.id)) {
			errors.push("Invalid file reference ID")
		}

		if (!this.stepId || this.stepId.trim().length === 0) {
			errors.push("Step ID is required")
		}

		if (!this.filePath || this.filePath.trim().length === 0) {
			errors.push("File path is required")
		}

		if (!this.filePath.startsWith("/")) {
			errors.push("File path must be absolute")
		}

		if (!["create", "update", "delete"].includes(this.changeType)) {
			errors.push("Invalid changeType: must be 'create', 'update', or 'delete'")
		}

		// Validate content requirements based on change type
		if (this.changeType === "update" && !this.oldContent) {
			errors.push("Old content is required for update operations")
		}

		if (this.changeType === "update" && !this.newContent) {
			errors.push("New content is required for update operations")
		}

		if (this.changeType === "create" && !this.newContent) {
			errors.push("New content is required for create operations")
		}

		if (this.changeType === "delete" && !this.oldContent) {
			errors.push("Old content is required for delete operations")
		}

		if (errors.length > 0) {
			throw new Error(`FileReference validation failed: ${errors.join(", ")}`)
		}

		return true
	}

	toJSON(): FileReference {
		return {
			id: this.id,
			stepId: this.stepId,
			filePath: this.filePath,
			changeType: this.changeType,
			oldContent: this.oldContent,
			newContent: this.newContent,
			metadata: this.metadata,
		}
	}

	static fromJSON(data: FileReference): FileReferenceEntity {
		return new FileReferenceEntity(data)
	}

	isCreate(): boolean {
		return this.changeType === "create"
	}

	isUpdate(): boolean {
		return this.changeType === "update"
	}

	isDelete(): boolean {
		return this.changeType === "delete"
	}

	setSize(size: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.size = size
	}

	setLines(lines: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.lines = lines
	}

	setLanguage(language: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.language = language
	}

	setLastModified(date: Date): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.lastModified = date
	}

	setChecksum(checksum: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.checksum = checksum
	}

	setEncoding(encoding: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.encoding = encoding
	}

	getSize(): number {
		return this.metadata?.size || 0
	}

	getLines(): number {
		return this.metadata?.lines || 0
	}

	getLanguage(): string {
		return this.metadata?.language || ""
	}
}

/**
 * Factory functions for creating entities
 */
export const EntityFactory = {
	createEditPlan(data: Partial<EditPlan> = {}): EditPlanEntity {
		const entity = new EditPlanEntity(data)
		entity.validate()
		return entity
	},

	createEditStep(data: Partial<EditStep> = {}): EditStepEntity {
		const entity = new EditStepEntity(data)
		entity.validate()
		return entity
	},

	createFileReference(data: Partial<FileReference> = {}): FileReferenceEntity {
		const entity = new FileReferenceEntity(data)
		entity.validate()
		return entity
	},

	createRefactorPlan(userId: string, title: string, description: string): EditPlanEntity {
		return this.createEditPlan({
			userId,
			title,
			description,
			status: "pending",
			metadata: {
				complexity: "medium",
			},
		})
	},

	createUpgradePlan(userId: string, title: string, description: string): EditPlanEntity {
		return this.createEditPlan({
			userId,
			title,
			description,
			status: "pending",
			metadata: {
				complexity: "low",
			},
		})
	},

	createUpdateStep(planId: string, order: number, title: string, description: string): EditStepEntity {
		return this.createEditStep({
			planId,
			order,
			title,
			type: "update",
			description,
			status: "pending",
			dependencies: [],
		})
	},

	createCreateStep(planId: string, order: number, title: string, description: string): EditStepEntity {
		return this.createEditStep({
			planId,
			order,
			title,
			type: "create",
			description,
			status: "pending",
			dependencies: [],
		})
	},

	createDeleteStep(planId: string, order: number, title: string, description: string): EditStepEntity {
		return this.createEditStep({
			planId,
			order,
			title,
			type: "delete",
			description,
			status: "pending",
			dependencies: [],
		})
	},

	createFileUpdate(stepId: string, filePath: string, oldContent: string, newContent: string): FileReferenceEntity {
		return this.createFileReference({
			stepId,
			filePath,
			changeType: "update",
			oldContent,
			newContent,
		})
	},

	createFileCreate(stepId: string, filePath: string, content: string): FileReferenceEntity {
		return this.createFileReference({
			stepId,
			filePath,
			changeType: "create",
			newContent: content,
		})
	},

	createFileDelete(stepId: string, filePath: string, content: string): FileReferenceEntity {
		return this.createFileReference({
			stepId,
			filePath,
			changeType: "delete",
			oldContent: content,
		})
	},
}
