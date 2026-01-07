// kilocode_change - new file

import { DatabaseManager, EditHistoryRecord } from "../storage/database-manager"
import { TransactionalExecutor } from "./transactional-executor"
import * as vscode from "vscode"
import * as path from "path"
import { createHash } from "crypto"

export interface RevertOptions {
	force?: boolean
	createBackup?: boolean
	verifyIntegrity?: boolean
	showPreview?: boolean
}

export interface RevertResult {
	success: boolean
	revertedFiles: string[]
	conflicts: FileConflict[]
	errors: string[]
	warnings: string[]
	backupCreated?: boolean
}

export interface FileConflict {
	filePath: string
	conflictType: "manual_edits" | "file_missing" | "permission_denied" | "checksum_mismatch"
	currentContent?: string
	expectedContent?: string
	resolution?: "force" | "merge" | "skip"
}

export interface RevertPreview {
	messageId: string
	affectedFiles: Array<{
		filePath: string
		currentContent: string
		revertedContent: string
		hasConflicts: boolean
		conflictType?: string
	}>
	estimatedImpact: "low" | "medium" | "high"
}

/**
 * Service for atomic reverting of AI-driven modifications
 */
export class RevertService {
	private databaseManager: DatabaseManager
	private workspaceRoot: string
	private conflictResolutionStrategies: Map<string, (conflict: FileConflict) => Promise<boolean>> = new Map()

	constructor(databaseManager: DatabaseManager, workspaceRoot: string) {
		this.databaseManager = databaseManager
		this.workspaceRoot = workspaceRoot
		this.initializeConflictStrategies()
	}

	/**
	 * Preview what a revert would look like without applying changes
	 */
	async previewRevert(messageId: string): Promise<RevertPreview> {
		console.log(`[RevertService] Generating preview for message ${messageId}`)

		const editHistory = await this.databaseManager.getEditHistoryByMessageId(messageId)
		if (editHistory.length === 0) {
			throw new Error(`No edit history found for message ${messageId}`)
		}

		const latestEdit = editHistory[0] // Get the most recent edit
		const reversePatches = JSON.parse(latestEdit.reverse_patches)
		const originalSnapshots = JSON.parse(latestEdit.original_snapshots)

		const affectedFiles = []
		let totalChanges = 0

		for (const patch of reversePatches) {
			const filePath = patch.filePath
			const originalSnapshot = originalSnapshots.find((s: any) => s.filePath === filePath)

			try {
				const currentContent = await this.getCurrentFileContent(filePath)
				const revertedContent = await this.applyReversePatch(currentContent, patch.diff)

				const hasConflicts = await this.detectConflicts(filePath, originalSnapshot?.content, currentContent)

				affectedFiles.push({
					filePath,
					currentContent,
					revertedContent,
					hasConflicts: hasConflicts.length > 0,
					conflictType: hasConflicts[0]?.conflictType,
				})

				totalChanges += Math.abs(currentContent.split("\n").length - revertedContent.split("\n").length)
			} catch (error) {
				affectedFiles.push({
					filePath,
					currentContent: "",
					revertedContent: originalSnapshot?.content || "",
					hasConflicts: true,
					conflictType: "file_missing",
				})
			}
		}

		const estimatedImpact = totalChanges < 10 ? "low" : totalChanges < 100 ? "medium" : "high"

		return {
			messageId,
			affectedFiles,
			estimatedImpact,
		}
	}

	/**
	 * Revert changes for a specific message atomically
	 */
	async revertAction(messageId: string, options: RevertOptions = {}): Promise<RevertResult> {
		console.log(`[RevertService] Starting atomic revert for message ${messageId}`)

		const startTime = Date.now()
		const result: RevertResult = {
			success: false,
			revertedFiles: [],
			conflicts: [],
			errors: [],
			warnings: [],
		}

		try {
			// Step 1: Get edit history
			const editHistory = await this.databaseManager.getEditHistoryByMessageId(messageId)
			if (editHistory.length === 0) {
				result.errors.push(`No edit history found for message ${messageId}`)
				return result
			}

			const latestEdit = editHistory[0]
			if (latestEdit.is_reverted) {
				result.warnings.push(`Message ${messageId} has already been reverted`)
				result.success = true
				return result
			}

			// Step 2: Create backup if requested
			if (options.createBackup) {
				try {
					await this.createBackup(latestEdit)
					result.backupCreated = true
				} catch (error) {
					result.warnings.push(
						`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			// Step 3: Verify integrity if requested
			if (options.verifyIntegrity) {
				const integrityIssues = await this.verifyFileIntegrity(latestEdit)
				if (integrityIssues.length > 0 && !options.force) {
					result.conflicts.push(...integrityIssues)
					result.errors.push("File integrity issues detected. Use force=true to override.")
					return result
				}
			}

			// Step 4: Check for conflicts
			const conflicts = await this.detectAllConflicts(latestEdit)
			if (conflicts.length > 0 && !options.force) {
				result.conflicts.push(...conflicts)
				result.errors.push("Conflicts detected. Use force=true to override or resolve conflicts first.")
				return result
			}

			// Step 5: Apply revert atomically
			const revertResult = await this.applyAtomicRevert(latestEdit, options)

			if (revertResult.success) {
				// Step 6: Mark as reverted in database
				await this.databaseManager.markEditHistoryAsReverted(latestEdit.id, "user")

				result.success = true
				result.revertedFiles = revertResult.revertedFiles
				result.conflicts = revertResult.conflicts

				console.log(`[RevertService] Atomic revert completed successfully in ${Date.now() - startTime}ms`)

				// Step 7: Trigger workspace refresh
				await this.triggerWorkspaceRefresh()

				// Step 8: Check if this is an Odoo project and suggest module update
				await this.handleOdooContext(latestEdit)
			} else {
				result.errors.push(...revertResult.errors)
				result.conflicts.push(...revertResult.conflicts)
			}
		} catch (error) {
			const errorMsg = `Revert failed: ${error instanceof Error ? error.message : String(error)}`
			result.errors.push(errorMsg)
			console.error(`[RevertService] ${errorMsg}`)
		}

		return result
	}

	/**
	 * Get revert history for a workspace
	 */
	async getRevertHistory(limit: number = 50): Promise<EditHistoryRecord[]> {
		return await this.databaseManager.getRecentEditHistory(limit)
	}

	/**
	 * Check if a message can be reverted
	 */
	async canRevert(messageId: string): Promise<{ canRevert: boolean; reason?: string }> {
		const editHistory = await this.databaseManager.getEditHistoryByMessageId(messageId)

		if (editHistory.length === 0) {
			return { canRevert: false, reason: "No edit history found" }
		}

		const latestEdit = editHistory[0]
		if (latestEdit.is_reverted) {
			return { canRevert: false, reason: "Already reverted" }
		}

		return { canRevert: true }
	}

	// Private methods

	private async getCurrentFileContent(filePath: string): Promise<string> {
		const absolutePath = path.resolve(this.workspaceRoot, filePath)
		const fs = await import("fs/promises")
		return await fs.readFile(absolutePath, "utf8")
	}

	private async applyReversePatch(currentContent: string, reverseDiff: string): Promise<string> {
		// Simple reverse patch application - in production, use proper patch library
		const lines = currentContent.split("\n")
		const diffLines = reverseDiff.split("\n")

		let i = 0
		while (i < diffLines.length) {
			const line = diffLines[i]

			if (line.startsWith("@@")) {
				// Parse hunk header
				const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
				if (match) {
					const oldStart = parseInt(match[1]) - 1
					const newStart = parseInt(match[3]) - 1

					i++

					// Apply changes
					const deletions: string[] = []
					const additions: string[] = []

					while (
						i < diffLines.length &&
						!diffLines[i].startsWith("@@") &&
						!diffLines[i].startsWith("---") &&
						!diffLines[i].startsWith("+++")
					) {
						const diffLine = diffLines[i]
						if (diffLine.startsWith("-")) {
							deletions.push(diffLine.substring(1))
						} else if (diffLine.startsWith("+")) {
							additions.push(diffLine.substring(1))
						}
						i++
					}

					// Apply deletions and additions
					if (deletions.length > 0) {
						lines.splice(oldStart, deletions.length)
					}
					if (additions.length > 0) {
						lines.splice(newStart, 0, ...additions)
					}
				}
			} else {
				i++
			}
		}

		return lines.join("\n")
	}

	private async detectConflicts(
		filePath: string,
		originalContent?: string,
		currentContent?: string,
	): Promise<FileConflict[]> {
		const conflicts: FileConflict[] = []

		if (!currentContent) {
			conflicts.push({
				filePath,
				conflictType: "file_missing",
				resolution: "skip",
			})
			return conflicts
		}

		if (!originalContent) {
			conflicts.push({
				filePath,
				conflictType: "manual_edits",
				currentContent,
				expectedContent: "",
				resolution: "force",
			})
			return conflicts
		}

		// Check if file has been manually modified
		const currentHash = this.createContentHash(currentContent)
		const originalHash = this.createContentHash(originalContent)

		if (currentHash !== originalHash) {
			conflicts.push({
				filePath,
				conflictType: "checksum_mismatch",
				currentContent,
				expectedContent: originalContent,
				resolution: "merge",
			})
		}

		return conflicts
	}

	private async detectAllConflicts(editHistory: EditHistoryRecord): Promise<FileConflict[]> {
		const reversePatches = JSON.parse(editHistory.reverse_patches)
		const originalSnapshots = JSON.parse(editHistory.original_snapshots)
		const allConflicts: FileConflict[] = []

		for (const patch of reversePatches) {
			const filePath = patch.filePath
			const originalSnapshot = originalSnapshots.find((s: any) => s.filePath === filePath)

			try {
				const currentContent = await this.getCurrentFileContent(filePath)
				const conflicts = await this.detectConflicts(filePath, originalSnapshot?.content, currentContent)
				allConflicts.push(...conflicts)
			} catch (error) {
				allConflicts.push({
					filePath,
					conflictType: "file_missing",
					resolution: "skip",
				})
			}
		}

		return allConflicts
	}

	private async verifyFileIntegrity(editHistory: EditHistoryRecord): Promise<FileConflict[]> {
		const originalSnapshots = JSON.parse(editHistory.original_snapshots)
		const conflicts: FileConflict[] = []

		for (const snapshot of originalSnapshots) {
			try {
				const currentContent = await this.getCurrentFileContent(snapshot.filePath)
				const currentHash = this.createContentHash(currentContent)
				const originalHash = this.createContentHash(snapshot.content)

				if (currentHash !== originalHash) {
					conflicts.push({
						filePath: snapshot.filePath,
						conflictType: "checksum_mismatch",
						currentContent,
						expectedContent: snapshot.content,
						resolution: "merge",
					})
				}
			} catch (error) {
				conflicts.push({
					filePath: snapshot.filePath,
					conflictType: "file_missing",
					resolution: "skip",
				})
			}
		}

		return conflicts
	}

	private async applyAtomicRevert(
		editHistory: EditHistoryRecord,
		options: RevertOptions,
	): Promise<{
		success: boolean
		revertedFiles: string[]
		conflicts: FileConflict[]
		errors: string[]
	}> {
		const reversePatches = JSON.parse(editHistory.reverse_patches)
		const originalSnapshots = JSON.parse(editHistory.original_snapshots)
		const revertedFiles: string[] = []
		const conflicts: FileConflict[] = []
		const errors: string[] = []

		// Create a temporary backup of current state
		const currentStates: Array<{ filePath: string; content: string }> = []

		try {
			// Step 1: Backup current state
			for (const patch of reversePatches) {
				try {
					const currentContent = await this.getCurrentFileContent(patch.filePath)
					currentStates.push({ filePath: patch.filePath, content: currentContent })
				} catch (error) {
					// File doesn't exist, that's okay
					currentStates.push({ filePath: patch.filePath, content: "" })
				}
			}

			// Step 2: Apply reverse patches
			for (const patch of reversePatches) {
				try {
					const currentContent = await this.getCurrentFileContent(patch.filePath)
					const revertedContent = await this.applyReversePatch(currentContent, patch.diff)

					const absolutePath = path.resolve(this.workspaceRoot, patch.filePath)
					const fs = await import("fs/promises")
					await fs.writeFile(absolutePath, revertedContent, "utf8")

					revertedFiles.push(patch.filePath)
				} catch (error) {
					const errorMsg = `Failed to revert ${patch.filePath}: ${error instanceof Error ? error.message : String(error)}`
					errors.push(errorMsg)

					// Rollback on failure
					await this.rollbackChanges(currentStates)
					return { success: false, revertedFiles, conflicts, errors }
				}
			}

			return { success: true, revertedFiles, conflicts, errors }
		} catch (error) {
			// Rollback on any failure
			await this.rollbackChanges(currentStates)
			errors.push(`Atomic revert failed: ${error instanceof Error ? error.message : String(error)}`)
			return { success: false, revertedFiles, conflicts, errors }
		}
	}

	private async rollbackChanges(states: Array<{ filePath: string; content: string }>): Promise<void> {
		console.log("[RevertService] Rolling back changes due to failure")

		for (const state of states) {
			try {
				const absolutePath = path.resolve(this.workspaceRoot, state.filePath)
				const fs = await import("fs/promises")

				if (state.content === "") {
					// Delete file if it was originally empty
					await fs.unlink(absolutePath)
				} else {
					await fs.writeFile(absolutePath, state.content, "utf8")
				}
			} catch (error) {
				console.error(`[RevertService] Failed to rollback ${state.filePath}: ${error}`)
			}
		}
	}

	private async createBackup(editHistory: EditHistoryRecord): Promise<void> {
		const backupDir = path.join(this.workspaceRoot, ".kilocode", "backups")
		const fs = await import("fs/promises")

		await fs.mkdir(backupDir, { recursive: true })

		const backupFile = path.join(backupDir, `backup_${editHistory.id}_${Date.now()}.json`)
		const backupData = {
			editHistory,
			timestamp: Date.now(),
			workspaceRoot: this.workspaceRoot,
		}

		await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2))
		console.log(`[RevertService] Created backup: ${backupFile}`)
	}

	private async triggerWorkspaceRefresh(): Promise<void> {
		// Trigger VSCode to refresh the workspace
		try {
			await vscode.commands.executeCommand("workbench.files.action.refreshFilesExplorer")
		} catch (error) {
			console.warn("[RevertService] Failed to trigger workspace refresh:", error)
		}
	}

	private async handleOdooContext(editHistory: EditHistoryRecord): Promise<void> {
		// Check if this is an Odoo project and suggest module update
		try {
			const metadata = JSON.parse(editHistory.metadata || "{}")
			const affectedFiles = JSON.parse(editHistory.affected_files)

			const hasOdooFiles = affectedFiles.some(
				(filePath: string) =>
					filePath.includes("__manifest__.py") ||
					filePath.includes("models/") ||
					filePath.includes("views/") ||
					filePath.includes("controllers/"),
			)

			if (hasOdooFiles) {
				// Show suggestion to update Odoo module
				const suggestion =
					"Odoo files were reverted. Consider updating the module with: ./odoo-bin -u module_name"
				vscode.window.showInformationMessage(suggestion, "Update Module").then((choice) => {
					if (choice === "Update Module") {
						vscode.commands.executeCommand("workbench.action.terminal.new")
					}
				})
			}
		} catch (error) {
			console.warn("[RevertService] Failed to handle Odoo context:", error)
		}
	}

	private createContentHash(content: string): string {
		return createHash("sha256").update(content).digest("hex")
	}

	private initializeConflictStrategies(): void {
		// Initialize conflict resolution strategies
		this.conflictResolutionStrategies.set("manual_edits", async (conflict) => {
			const choice = await vscode.window.showWarningMessage(
				`File ${conflict.filePath} has been manually modified. How would you like to proceed?`,
				"Force Revert",
				"Show Diff",
				"Cancel",
			)

			return choice === "Force Revert"
		})

		this.conflictResolutionStrategies.set("file_missing", async (conflict) => {
			const choice = await vscode.window.showWarningMessage(
				`File ${conflict.filePath} is missing. How would you like to proceed?`,
				"Create File",
				"Skip",
				"Cancel",
			)

			return choice === "Create File"
		})
	}
}
