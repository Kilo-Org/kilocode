// kilocode_change - new file

/**
 * Step Executor Service
 * Executes edit plan steps with file operations, conflict detection, and rollback support
 */

import type { EditStep, FileReference, FileChange, FileConflict, StepExecutionResponse } from "./types"
import { PlanExecutionError } from "./types"

export interface StepExecutorConfig {
	/** Whether to create backups before modifying files */
	createBackups?: boolean
	/** Whether to verify changes after execution */
	verifyChanges?: boolean
	/** Whether to auto-resolve conflicts */
	autoResolveConflicts?: boolean
	/** Maximum retry attempts for failed operations */
	maxRetries?: number
}

export class StepExecutorService {
	private config: Required<StepExecutorConfig>
	private backups: Map<string, string>

	constructor(config: StepExecutorConfig = {}) {
		this.config = {
			createBackups: config.createBackups ?? true,
			verifyChanges: config.verifyChanges ?? true,
			autoResolveConflicts: config.autoResolveConflicts ?? false,
			maxRetries: config.maxRetries ?? 3,
		}
		this.backups = new Map()
	}

	/**
	 * Execute a single step
	 */
	async executeStep(
		step: EditStep,
		options: {
			skipConfirmation?: boolean
			dryRun?: boolean
			force?: boolean
		} = {},
	): Promise<StepExecutionResponse> {
		try {
			const startTime = Date.now()

			// Validate step
			if (step.status !== "pending") {
				throw new PlanExecutionError(`Step is ${step.status}, cannot execute`, step.id)
			}

			// Check if dry run
			if (options.dryRun) {
				return this.executeDryRun(step)
			}

			// Execute the step
			const appliedChanges: FileChange[] = []
			const conflicts: FileConflict[] = []
			const warnings: string[] = []

			for (const fileRef of step.files) {
				try {
					const result = await this.executeFileChange(fileRef, options.force)
					appliedChanges.push(result)

					if (result.conflicts) {
						conflicts.push(...result.conflicts)
					}

					if (result.warnings) {
						warnings.push(...result.warnings)
					}
				} catch (error) {
					appliedChanges.push({
						filePath: fileRef.filePath,
						changeType: fileRef.changeType,
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}

			// Determine overall success
			const allSuccessful = appliedChanges.every((change) => change.success)
			const hasConflicts = conflicts.length > 0

			// Rollback if not all successful and not forced
			if (!allSuccessful && !options.force) {
				await this.rollbackStep(step.id)
				return {
					step: { ...step, status: "failed" },
					success: false,
					appliedChanges,
					conflicts,
					warnings: [...warnings, "Step execution failed, changes rolled back"],
				}
			}

			// Update step metadata
			const executionTime = Date.now() - startTime

			return {
				step: {
					...step,
					status: allSuccessful ? "completed" : "failed",
				},
				success: allSuccessful,
				appliedChanges,
				conflicts: hasConflicts ? conflicts : undefined,
				warnings: warnings.length > 0 ? warnings : undefined,
			}
		} catch (error) {
			if (error instanceof PlanExecutionError) {
				throw error
			}
			throw new PlanExecutionError(`Failed to execute step: ${error}`, step.id, error)
		}
	}

	/**
	 * Execute a dry run (validate without applying changes)
	 */
	private async executeDryRun(step: EditStep): Promise<StepExecutionResponse> {
		const appliedChanges: FileChange[] = []
		const warnings: string[] = []

		for (const fileRef of step.files) {
			// Validate file reference
			const validation = await this.validateFileChange(fileRef)

			appliedChanges.push({
				filePath: fileRef.filePath,
				changeType: fileRef.changeType,
				oldContent: fileRef.oldContent,
				newContent: fileRef.newContent,
				success: validation.valid,
				error: validation.error,
			})

			if (validation.warnings) {
				warnings.push(...validation.warnings)
			}
		}

		return {
			step: { ...step, status: "pending" },
			success: appliedChanges.every((change) => change.success),
			appliedChanges,
			warnings: [...warnings, "Dry run - no changes applied to disk"],
		}
	}

	/**
	 * Execute a single file change
	 */
	private async executeFileChange(
		fileRef: FileReference,
		force: boolean = false,
	): Promise<FileChange & { conflicts?: FileConflict[]; warnings?: string[] }> {
		try {
			// Validate file change
			const validation = await this.validateFileChange(fileRef)
			if (!validation.valid && !force) {
				return {
					filePath: fileRef.filePath,
					changeType: fileRef.changeType,
					success: false,
					error: validation.error,
					warnings: validation.warnings,
				}
			}

			// Create backup if configured
			if (this.config.createBackups && fileRef.changeType !== "create") {
				await this.createBackup(fileRef.filePath)
			}

			// Execute the change based on type
			switch (fileRef.changeType) {
				case "create":
					return await this.createFile(fileRef)
				case "update":
					return await this.updateFile(fileRef, force)
				case "delete":
					return await this.deleteFile(fileRef, force)
				default:
					throw new Error(`Unsupported change type: ${fileRef.changeType}`)
			}
		} catch (error) {
			return {
				filePath: fileRef.filePath,
				changeType: fileRef.changeType,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Validate a file change
	 */
	private async validateFileChange(
		fileRef: FileReference,
	): Promise<{ valid: boolean; error?: string; warnings?: string[] }> {
		const warnings: string[] = []

		// Check if file exists for update/delete operations
		if (fileRef.changeType === "update" || fileRef.changeType === "delete") {
			const exists = await this.fileExists(fileRef.filePath)
			if (!exists) {
				return {
					valid: false,
					error: `File does not exist: ${fileRef.filePath}`,
				}
			}
		}

		// Check if file already exists for create operations
		if (fileRef.changeType === "create") {
			const exists = await this.fileExists(fileRef.filePath)
			if (exists) {
				warnings.push(`File already exists and will be overwritten: ${fileRef.filePath}`)
			}
		}

		// Validate content for update operations
		if (fileRef.changeType === "update") {
			if (!fileRef.oldContent || !fileRef.newContent) {
				return {
					valid: false,
					error: "Update operation requires both oldContent and newContent",
				}
			}

			// Check if old content matches current file
			const currentContent = await this.readFile(fileRef.filePath)
			if (currentContent !== fileRef.oldContent) {
				warnings.push(`File content has changed since plan was created: ${fileRef.filePath}`)
			}
		}

		return {
			valid: true,
			warnings: warnings.length > 0 ? warnings : undefined,
		}
	}

	/**
	 * Create a new file
	 */
	private async createFile(
		fileRef: FileReference,
	): Promise<FileChange & { conflicts?: FileConflict[]; warnings?: string[] }> {
		try {
			if (!fileRef.newContent) {
				throw new Error("Create operation requires newContent")
			}

			// Write file
			await this.writeFile(fileRef.filePath, fileRef.newContent)

			// Verify if configured
			if (this.config.verifyChanges) {
				const writtenContent = await this.readFile(fileRef.filePath)
				if (writtenContent !== fileRef.newContent) {
					throw new Error("File content verification failed")
				}
			}

			return {
				filePath: fileRef.filePath,
				changeType: "create",
				newContent: fileRef.newContent,
				success: true,
			}
		} catch (error) {
			return {
				filePath: fileRef.filePath,
				changeType: "create",
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Update an existing file
	 */
	private async updateFile(
		fileRef: FileReference,
		force: boolean = false,
	): Promise<FileChange & { conflicts?: FileConflict[]; warnings?: string[] }> {
		try {
			if (!fileRef.oldContent || !fileRef.newContent) {
				throw new Error("Update operation requires both oldContent and newContent")
			}

			// Read current content
			const currentContent = await this.readFile(fileRef.filePath)

			// Check for conflicts
			if (currentContent !== fileRef.oldContent && !force) {
				return {
					filePath: fileRef.filePath,
					changeType: "update",
					oldContent: fileRef.oldContent,
					newContent: fileRef.newContent,
					success: false,
					error: "File content has changed",
					conflicts: [
						{
							filePath: fileRef.filePath,
							type: "content",
							description: "File has been modified externally since plan was created",
						},
					],
				}
			}

			// Write new content
			await this.writeFile(fileRef.filePath, fileRef.newContent)

			// Verify if configured
			if (this.config.verifyChanges) {
				const writtenContent = await this.readFile(fileRef.filePath)
				if (writtenContent !== fileRef.newContent) {
					throw new Error("File content verification failed")
				}
			}

			return {
				filePath: fileRef.filePath,
				changeType: "update",
				oldContent: fileRef.oldContent,
				newContent: fileRef.newContent,
				success: true,
			}
		} catch (error) {
			return {
				filePath: fileRef.filePath,
				changeType: "update",
				oldContent: fileRef.oldContent,
				newContent: fileRef.newContent,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Delete a file
	 */
	private async deleteFile(
		fileRef: FileReference,
		force: boolean = false,
	): Promise<FileChange & { conflicts?: FileConflict[]; warnings?: string[] }> {
		try {
			if (!fileRef.oldContent) {
				throw new Error("Delete operation requires oldContent")
			}

			// Read current content
			const currentContent = await this.readFile(fileRef.filePath)

			// Check for conflicts
			if (currentContent !== fileRef.oldContent && !force) {
				return {
					filePath: fileRef.filePath,
					changeType: "delete",
					oldContent: fileRef.oldContent,
					success: false,
					error: "File content has changed",
					conflicts: [
						{
							filePath: fileRef.filePath,
							type: "content",
							description: "File has been modified externally since plan was created",
						},
					],
				}
			}

			// Delete file
			await this.deleteFileFromFS(fileRef.filePath)

			// Verify if configured
			if (this.config.verifyChanges) {
				const exists = await this.fileExists(fileRef.filePath)
				if (exists) {
					throw new Error("File deletion verification failed")
				}
			}

			return {
				filePath: fileRef.filePath,
				changeType: "delete",
				oldContent: fileRef.oldContent,
				success: true,
			}
		} catch (error) {
			return {
				filePath: fileRef.filePath,
				changeType: "delete",
				oldContent: fileRef.oldContent,
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	/**
	 * Rollback a step by restoring backups
	 */
	async rollbackStep(stepId: string): Promise<boolean> {
		try {
			// Restore all backups created for this step
			for (const [filePath, backupContent] of this.backups) {
				await this.writeFile(filePath, backupContent)
			}

			// Clear backups
			this.backups.clear()

			return true
		} catch (error) {
			console.error(`Failed to rollback step ${stepId}:`, error)
			return false
		}
	}

	/**
	 * Create a backup of a file
	 */
	private async createBackup(filePath: string): Promise<void> {
		try {
			const content = await this.readFile(filePath)
			this.backups.set(filePath, content)
		} catch (error) {
			console.error(`Failed to create backup for ${filePath}:`, error)
		}
	}

	/**
	 * Clear all backups
	 */
	clearBackups(): void {
		this.backups.clear()
	}

	// ============================================================================
	// File System Operations (Placeholder - will integrate with VSCode API)
	// ============================================================================

	/**
	 * Read file content
	 */
	private async readFile(filePath: string): Promise<string> {
		// TODO: Integrate with VSCode API or file system
		// For now, return empty string
		return ""
	}

	/**
	 * Write file content
	 */
	private async writeFile(filePath: string, content: string): Promise<void> {
		// TODO: Integrate with VSCode API or file system
		// For now, do nothing
	}

	/**
	 * Delete a file from filesystem
	 */
	private async deleteFileFromFS(filePath: string): Promise<void> {
		// TODO: Integrate with VSCode API or file system
		// For now, do nothing
	}

	/**
	 * Check if file exists
	 */
	private async fileExists(filePath: string): Promise<boolean> {
		// TODO: Integrate with VSCode API or file system
		// For now, return false
		return false
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: StepExecutorService | null = null

export function getStepExecutorService(config?: StepExecutorConfig): StepExecutorService {
	if (!instance) {
		instance = new StepExecutorService(config)
	}
	return instance
}

export function resetStepExecutorService(): void {
	instance = null
}
