/**
 * EditExecutor Service
 *
 * Applies edits to files with undo/redo support.
 * Generates diffs and tracks edit history.
 *
 * @module EditExecutor
 */

import * as vscode from "vscode"
import { diffLines } from "diff"
import type { EditSuggestion, EditAction } from "./types"
import { ActionType } from "./types"
import { createApplyFailedError, createFileNotFoundError } from "./errors"
import { generateUUID } from "./utils"

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Logs a message with timestamp
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
	const timestamp = new Date().toISOString()
	const logMessage = `[${timestamp}] [EditExecutor] [${level.toUpperCase()}] ${message}`

	if (level === "error") {
		console.error(logMessage, data)
	} else if (level === "warn") {
		console.warn(logMessage, data)
	} else {
		console.log(logMessage, data)
	}
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Result of applying an edit
 */
export interface ApplyEditResult {
	/** The action that was performed */
	action: EditAction
	/** Whether the edit was successfully applied */
	success: boolean
	/** Error message if application failed */
	error?: string
}

/**
 * Result of bulk applying edits
 */
export interface BulkApplyResult {
	/** IDs of successfully applied edits */
	applied: string[]
	/** Failed edits with error messages */
	failed: Array<{
		editId: string
		error: string
	}>
}

/**
 * Interface for EditExecutor service
 */
export interface IEditExecutor {
	/**
	 * Applies a single edit to a file
	 *
	 * @param edit - The edit suggestion to apply
	 * @param modification - Optional user modification to the edit
	 * @returns Promise with apply result
	 */
	applyEdit(edit: EditSuggestion, modification?: string): Promise<ApplyEditResult>

	/**
	 * Generates a unified diff for an edit
	 *
	 * @param edit - The edit suggestion
	 * @returns Unified diff string
	 */
	generateDiff(edit: EditSuggestion): string

	/**
	 * Applies multiple edits in bulk
	 *
	 * @param edits - Array of edits to apply
	 * @returns Promise with bulk apply result
	 */
	bulkApplyEdits(edits: EditSuggestion[]): Promise<BulkApplyResult>

	/**
	 * Undoes the last applied edit
	 *
	 * @param sessionId - The session ID
	 * @param level - Undo level: 'edit' (single), 'file' (all in file), or 'all' (all edits)
	 * @returns Promise with undone edit action
	 */
	undoLastEdit(sessionId: string, level?: "edit" | "file" | "all"): Promise<EditAction | null>

	/**
	 * Redoes the last undone edit
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with redone edit action
	 */
	redoLastEdit(sessionId: string): Promise<EditAction | null>

	/**
	 * Gets git diff for an edit
	 *
	 * @param edit - The edit suggestion
	 * @returns Promise with git diff string
	 */
	getGitDiff(edit: EditSuggestion): Promise<string>

	/**
	 * Previews all changes in git
	 *
	 * @param sessionId - The session ID
	 * @returns Promise with array of file diffs
	 */
	previewAllChanges(sessionId: string): Promise<
		Array<{
			path: string
			diff: string
			status: "modified" | "added" | "deleted"
		}>
	>

	/**
	 * Checks if undo is available
	 *
	 * @param sessionId - The session ID
	 * @returns true if undo is available
	 */
	canUndo(sessionId: string): boolean

	/**
	 * Checks if redo is available
	 *
	 * @param sessionId - The session ID
	 * @returns true if redo is available
	 */
	canRedo(sessionId: string): boolean
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * EditExecutor implementation
 */
export class EditExecutor implements IEditExecutor {
	constructor(private readonly context: vscode.ExtensionContext) {
		// Initialize undo/redo stacks storage
		this.undoStacks = new Map()
		this.redoStacks = new Map()
	}

	private undoStacks: Map<string, EditAction[]>
	private redoStacks: Map<string, EditAction[]>
	private editMap: Map<string, EditSuggestion> = new Map()

	async applyEdit(edit: EditSuggestion, modification?: string): Promise<ApplyEditResult> {
		const startTime = Date.now()

		try {
			if (!edit) {
				log("error", "Cannot apply edit: edit is required")
				throw new Error("Edit is required. Please provide a valid edit suggestion.")
			}

			log("info", `Applying edit: ${edit.id}`, { filePath: edit.filePath, hasModification: !!modification })

			// Store edit for later reference
			this.editMap.set(edit.id, edit)

			// Read original file content
			const originalContent = await this.readFile(edit.filePath)

			// Use modification if provided, otherwise use edit's suggestedContent
			const replacement = modification || edit.suggestedContent

			// Apply the edit
			const modifiedContent = originalContent.replace(edit.originalContent, replacement)

			// Write modified content
			await this.writeFile(edit.filePath, modifiedContent)

			// Create action record
			const action = this.createAction(edit, ActionType.ACCEPT, replacement)

			// Add to undo stack
			this.addToUndoStack(edit.sessionId, action)

			// Clear redo stack for this session
			this.redoStacks.delete(edit.sessionId)

			const duration = Date.now() - startTime
			log("info", `Edit applied successfully: ${edit.id}`, { duration: `${duration}ms` })

			return {
				action,
				success: true,
			}
		} catch (error) {
			const duration = Date.now() - startTime
			const errorMessage = error instanceof Error ? error.message : "Unknown error"

			// If edit is null, re-throw the error instead of trying to create an action
			if (!edit) {
				log("error", `Failed to apply edit after ${duration}ms`, error)
				throw error
			}

			log("error", `Failed to apply edit: ${edit.id} after ${duration}ms`, error)
			return {
				action: this.createAction(edit, ActionType.ACCEPT),
				success: false,
				error: `Failed to apply edit: ${errorMessage}`,
			}
		}
	}

	generateDiff(edit: EditSuggestion): string {
		try {
			if (!edit) {
				throw new Error("Edit is required")
			}

			// Generate unified diff
			return this.generateUnifiedDiff(edit.originalContent, edit.suggestedContent, edit.filePath)
		} catch (error) {
			throw new Error(`Failed to generate diff: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async bulkApplyEdits(edits: EditSuggestion[]): Promise<BulkApplyResult> {
		try {
			if (!edits || edits.length === 0) {
				return {
					applied: [],
					failed: [],
				}
			}

			const applied: string[] = []
			const failed: Array<{ editId: string; error: string }> = []

			for (const edit of edits) {
				try {
					const result = await this.applyEdit(edit)
					if (result.success) {
						applied.push(edit.id)
					} else {
						failed.push({
							editId: edit.id,
							error: result.error || "Unknown error",
						})
					}
				} catch (error) {
					failed.push({
						editId: edit.id,
						error: error instanceof Error ? error.message : "Unknown error",
					})
				}
			}

			return { applied, failed }
		} catch (error) {
			throw new Error(`Failed to bulk apply edits: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async undoLastEdit(sessionId: string, level: "edit" | "file" | "all" = "edit"): Promise<EditAction | null> {
		try {
			if (!sessionId) {
				log("error", "Cannot undo edit: session ID is required")
				throw new Error("Session ID is required")
			}

			const undoStack = this.undoStacks.get(sessionId)
			if (!undoStack || undoStack.length === 0) {
				log("warn", `No edits to undo for session: ${sessionId}`)
				return null
			}

			log("info", `Undoing last edit for session: ${sessionId}`, { level })

			let action: EditAction | null = null

			if (level === "edit") {
				// Undo single edit
				action = undoStack.pop()!
				await this.performUndo(action)
				this.addToRedoStack(sessionId, action)
			} else if (level === "file") {
				// Undo all edits for a specific file
				const lastAction = undoStack[undoStack.length - 1]
				const edit = this.editMap.get(lastAction.editId)
				if (!edit) {
					return null
				}

				const filePath = edit.filePath
				const fileActions: EditAction[] = []

				while (undoStack.length > 0) {
					const currentEdit = this.editMap.get(undoStack[undoStack.length - 1].editId)
					if (currentEdit && currentEdit.filePath === filePath) {
						const poppedAction = undoStack.pop()!
						fileActions.push(poppedAction)
						this.addToRedoStack(sessionId, poppedAction)
					} else {
						break
					}
				}

				// Perform undo in reverse order
				for (let i = fileActions.length - 1; i >= 0; i--) {
					await this.performUndo(fileActions[i])
				}

				action = fileActions[fileActions.length - 1]
				log("info", `Undone ${fileActions.length} edits for file: ${filePath}`)
			} else if (level === "all") {
				// Undo all edits
				const allActions = [...undoStack]
				undoStack.length = 0

				for (let i = allActions.length - 1; i >= 0; i--) {
					await this.performUndo(allActions[i])
					this.addToRedoStack(sessionId, allActions[i])
				}

				action = allActions[allActions.length - 1]
				log("info", `Undone all ${allActions.length} edits for session: ${sessionId}`)
			}

			return action
		} catch (error) {
			log("error", `Failed to undo last edit for session: ${sessionId}`, error)
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to undo last edit: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async redoLastEdit(sessionId: string): Promise<EditAction | null> {
		try {
			if (!sessionId) {
				throw new Error("Session ID is required")
			}

			const redoStack = this.redoStacks.get(sessionId)
			if (!redoStack || redoStack.length === 0) {
				return null
			}

			const action = redoStack.pop()!
			await this.performRedo(action)
			this.addToUndoStack(sessionId, action)

			return action
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to redo last edit: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async getGitDiff(edit: EditSuggestion): Promise<string> {
		try {
			if (!edit) {
				throw new Error("Edit is required")
			}

			// Read original content
			const originalContent = await this.readFile(edit.filePath)

			// Generate modified content
			const modifiedContent = originalContent.replace(edit.originalContent, edit.suggestedContent)

			// Generate unified diff
			return this.generateUnifiedDiff(originalContent, modifiedContent, edit.filePath)
		} catch (error) {
			if (error instanceof Error && error.message.includes("ENOENT")) {
				throw createFileNotFoundError(edit.filePath)
			}
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to get git diff: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async previewAllChanges(sessionId: string): Promise<
		Array<{
			path: string
			diff: string
			status: "modified" | "added" | "deleted"
		}>
	> {
		try {
			if (!sessionId) {
				throw new Error("Session ID is required")
			}

			const undoStack = this.undoStacks.get(sessionId) || []
			const fileMap = new Map<string, { original: string; modified: string }>()

			// Collect all changes by file
			for (const action of undoStack) {
				const edit = this.editMap.get(action.editId)
				if (!edit) continue

				const filePath = edit.filePath
				if (!fileMap.has(filePath)) {
					fileMap.set(filePath, {
						original: action.originalContent || "",
						modified: action.appliedContent || "",
					})
				} else {
					// Update with latest state
					fileMap.set(filePath, {
						original: action.originalContent || "",
						modified: action.appliedContent || "",
					})
				}
			}

			// Generate diffs for each file
			const results = []
			for (const [filePath, content] of fileMap) {
				const diff = this.generateUnifiedDiff(content.original, content.modified, filePath)
				results.push({
					path: filePath,
					diff,
					status: "modified" as const,
				})
			}

			return results
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(
				`Failed to preview all changes: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	canUndo(sessionId: string): boolean {
		if (!sessionId) {
			return false
		}

		const undoStack = this.undoStacks.get(sessionId)
		return undoStack !== undefined && undoStack.length > 0
	}

	canRedo(sessionId: string): boolean {
		if (!sessionId) {
			return false
		}

		const redoStack = this.redoStacks.get(sessionId)
		return redoStack !== undefined && redoStack.length > 0
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	/**
	 * Reads file content
	 */
	private async readFile(filePath: string): Promise<string> {
		try {
			const uri = vscode.Uri.file(filePath)
			const content = await vscode.workspace.fs.readFile(uri)
			return Buffer.from(content).toString("utf-8")
		} catch (error) {
			if (error instanceof Error && error.message.includes("ENOENT")) {
				throw createFileNotFoundError(filePath)
			}
			throw error
		}
	}

	/**
	 * Writes file content
	 */
	private async writeFile(filePath: string, content: string): Promise<void> {
		try {
			const uri = vscode.Uri.file(filePath)
			const encoder = new TextEncoder()
			await vscode.workspace.fs.writeFile(uri, encoder.encode(content))
		} catch (error) {
			throw createApplyFailedError(filePath, error instanceof Error ? error.message : "Unknown error")
		}
	}

	/**
	 * Creates an edit action record
	 */
	private createAction(edit: EditSuggestion, action: ActionType, appliedContent?: string): EditAction {
		return {
			id: generateUUID(),
			editId: edit.id,
			sessionId: edit.sessionId,
			action,
			timestamp: new Date(),
			originalContent: edit.originalContent,
			appliedContent,
			duration: 0,
		}
	}

	/**
	 * Generates unified diff using diff library
	 */
	private generateUnifiedDiff(original: string, modified: string, filePath: string): string {
		const changes = diffLines(original, modified)
		let output = `--- a/${filePath}\n`
		output += `+++ b/${filePath}\n`

		let lineNum = 1
		for (const change of changes) {
			if (change.added) {
				const lines = change.value.split("\n").filter((l) => l !== "")
				for (const line of lines) {
					output += `+${line}\n`
				}
			} else if (change.removed) {
				const lines = change.value.split("\n").filter((l) => l !== "")
				for (const line of lines) {
					output += `-${line}\n`
				}
			} else {
				lineNum += change.value.split("\n").length - 1
			}
		}

		return output
	}

	/**
	 * Performs undo operation
	 */
	private async performUndo(action: EditAction): Promise<void> {
		const edit = this.editMap.get(action.editId)
		if (!edit || !action.originalContent) {
			return
		}

		// Restore original content
		await this.writeFile(edit.filePath, action.originalContent)
	}

	/**
	 * Performs redo operation
	 */
	private async performRedo(action: EditAction): Promise<void> {
		const edit = this.editMap.get(action.editId)
		if (!edit || !action.appliedContent) {
			return
		}

		// Restore applied content
		await this.writeFile(edit.filePath, action.appliedContent)
	}

	/**
	 * Adds action to undo stack
	 */
	private addToUndoStack(sessionId: string, action: EditAction): void {
		if (!this.undoStacks.has(sessionId)) {
			this.undoStacks.set(sessionId, [])
		}
		this.undoStacks.get(sessionId)!.push(action)
	}

	/**
	 * Adds action to redo stack
	 */
	private addToRedoStack(sessionId: string, action: EditAction): void {
		if (!this.redoStacks.has(sessionId)) {
			this.redoStacks.set(sessionId, [])
		}
		this.redoStacks.get(sessionId)!.push(action)
	}
}
