// kilocode_change - new file

import { DatabaseManager, EditHistoryRecord } from "../storage/database-manager"
import { ExecutorService } from "../executor/executor-service"
import { ParsedEdit } from "../executor/edit-parser"
import * as vscode from "vscode"
import * as path from "path"
import { createHash } from "crypto"

export interface TransactionalEdit {
	filePath: string
	edits: ParsedEdit[]
	originalContent: string
	reverseDiff: string
}

export interface TransactionMetadata {
	messageId: string
	operationType: "edit" | "create" | "delete" | "move"
	userAgent?: string
	context?: string
	description?: string
}

export interface TransactionResult {
	success: boolean
	transactionId: string
	affectedFiles: string[]
	errors: string[]
	warnings: string[]
}

/**
 * Transactional file operations layer that captures snapshots and reverse diffs
 */
export class TransactionalExecutor {
	private databaseManager: DatabaseManager
	private executorService: ExecutorService
	private workspaceRoot: string

	constructor(databaseManager: DatabaseManager, executorService: ExecutorService, workspaceRoot: string) {
		this.databaseManager = databaseManager
		this.executorService = executorService
		this.workspaceRoot = workspaceRoot
	}

	/**
	 * Execute edits transactionally with full history tracking
	 */
	async executeTransactionalEdit(
		edits: Array<{ filePath: string; edits: ParsedEdit[] }>,
		metadata: TransactionMetadata,
	): Promise<TransactionResult> {
		const transactionId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
		const startTime = Date.now()

		console.log(`[TransactionalExecutor] Starting transaction ${transactionId} for message ${metadata.messageId}`)

		try {
			// Step 1: Capture pre-execution snapshots and reverse diffs
			const transactionalEdits: TransactionalEdit[] = []
			const errors: string[] = []
			const warnings: string[] = []

			for (const edit of edits) {
				try {
					const originalContent = await this.captureFileSnapshot(edit.filePath)
					const reverseDiff = await this.generateReverseDiff(edit.filePath, edit.edits, originalContent)

					transactionalEdits.push({
						filePath: edit.filePath,
						edits: edit.edits,
						originalContent,
						reverseDiff,
					})
				} catch (error) {
					const errorMsg = `Failed to capture snapshot for ${edit.filePath}: ${error instanceof Error ? error.message : String(error)}`
					errors.push(errorMsg)
					console.error(`[TransactionalExecutor] ${errorMsg}`)
				}
			}

			// Step 2: Validate all edits before execution
			for (const edit of edits) {
				const validation = await this.executorService.validateEdits(edit.edits)
				if (!validation.isValid) {
					errors.push(...validation.errors)
				}
				warnings.push(...validation.warnings)
			}

			if (errors.length > 0) {
				console.error(`[TransactionalExecutor] Validation failed for transaction ${transactionId}`)
				return {
					success: false,
					transactionId,
					affectedFiles: [],
					errors,
					warnings,
				}
			}

			// Step 3: Execute the edits
			try {
				await this.executorService.applyMultiFilePatch(edits)
				console.log(`[TransactionalExecutor] Successfully applied edits for transaction ${transactionId}`)
			} catch (error) {
				const errorMsg = `Failed to apply edits: ${error instanceof Error ? error.message : String(error)}`
				errors.push(errorMsg)
				console.error(`[TransactionalExecutor] ${errorMsg}`)

				// Attempt rollback if execution failed
				await this.attemptRollback(transactionalEdits, metadata.messageId)
				return {
					success: false,
					transactionId,
					affectedFiles: edits.map((e) => e.filePath),
					errors,
					warnings,
				}
			}

			// Step 4: Save edit history for atomic revert
			await this.saveEditHistory(transactionalEdits, metadata, transactionId)

			const executionTime = Date.now() - startTime
			console.log(`[TransactionalExecutor] Transaction ${transactionId} completed in ${executionTime}ms`)

			return {
				success: true,
				transactionId,
				affectedFiles: edits.map((e) => e.filePath),
				errors: [],
				warnings,
			}
		} catch (error) {
			const errorMsg = `Transaction failed: ${error instanceof Error ? error.message : String(error)}`
			console.error(`[TransactionalExecutor] ${errorMsg}`)

			return {
				success: false,
				transactionId,
				affectedFiles: [],
				errors: [errorMsg],
				warnings: [],
			}
		}
	}

	/**
	 * Capture file snapshot before modification
	 */
	private async captureFileSnapshot(filePath: string): Promise<string> {
		try {
			const absolutePath = path.resolve(this.workspaceRoot, filePath)
			const fs = await import("fs/promises")
			return await fs.readFile(absolutePath, "utf8")
		} catch (error) {
			// File might not exist, return empty string for new files
			if ((error as any).code === "ENOENT") {
				return ""
			}
			throw error
		}
	}

	/**
	 * Generate reverse diff for reverting changes
	 */
	private async generateReverseDiff(filePath: string, edits: ParsedEdit[], originalContent: string): Promise<string> {
		// Apply edits to get the new content
		let newContent = originalContent
		const lines = newContent.split("\n")

		// Apply edits in reverse order to get final state
		for (const edit of edits.reverse()) {
			const startLine = (edit.startLine || 1) - 1 // Convert to 0-based
			const endLine = (edit.endLine || 1) - 1

			if (edit.type === "search_replace" && edit.replace) {
				// For search_replace, we need to apply the replacement
				const replacementContent = edit.replace

				// Simple line-based replacement
				lines.splice(startLine, endLine - startLine + 1, ...replacementContent.split("\n"))
			} else if (edit.type === "insert" && edit.replace) {
				lines.splice(startLine, 0, ...edit.replace.split("\n"))
			} else if (edit.type === "delete") {
				lines.splice(startLine, endLine - startLine + 1)
			}
		}

		newContent = lines.join("\n")

		// Generate reverse diff (new -> original)
		const diff = await this.createDiff(newContent, originalContent, filePath)
		return diff
	}

	/**
	 * Create a unified diff between two content strings
	 */
	private async createDiff(oldContent: string, newContent: string, filePath: string): Promise<string> {
		const oldLines = oldContent.split("\n")
		const newLines = newContent.split("\n")

		const diffLines: string[] = []
		diffLines.push(`--- a/${filePath}`)
		diffLines.push(`+++ b/${filePath}`)

		// Simple diff implementation - in production, use proper diff library
		let oldIndex = 0
		let newIndex = 0

		while (oldIndex < oldLines.length || newIndex < newLines.length) {
			if (oldIndex >= oldLines.length) {
				// Only new lines remain
				diffLines.push(`@@ -${oldIndex + 1},${0} +${newIndex + 1},${newLines.length - newIndex} @@`)
				while (newIndex < newLines.length) {
					diffLines.push(`+${newLines[newIndex]}`)
					newIndex++
				}
			} else if (newIndex >= newLines.length) {
				// Only old lines remain (deletions)
				diffLines.push(`@@ -${oldIndex + 1},${oldLines.length - oldIndex} +${newIndex + 1},${0} @@`)
				while (oldIndex < oldLines.length) {
					diffLines.push(`-${oldLines[oldIndex]}`)
					oldIndex++
				}
			} else if (oldLines[oldIndex] === newLines[newIndex]) {
				// Lines are the same
				oldIndex++
				newIndex++
			} else {
				// Lines differ - find the next matching point
				const oldMatch = this.findNextMatch(oldLines, oldIndex, newLines, newIndex)
				const newMatch = this.findNextMatch(newLines, newIndex, oldLines, oldIndex)

				if (oldMatch !== -1 && newMatch !== -1) {
					// Found a match, create hunk
					const oldStart = oldIndex + 1
					const oldCount = oldMatch - oldIndex
					const newStart = newIndex + 1
					const newCount = newMatch - newIndex

					diffLines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)

					// Add deletions
					while (oldIndex < oldMatch) {
						diffLines.push(`-${oldLines[oldIndex]}`)
						oldIndex++
					}

					// Add additions
					while (newIndex < newMatch) {
						diffLines.push(`+${newLines[newIndex]}`)
						newIndex++
					}
				} else {
					// No match found, treat as replacement
					diffLines.push(`@@ -${oldIndex + 1},1 +${newIndex + 1},1 @@`)
					diffLines.push(`-${oldLines[oldIndex]}`)
					diffLines.push(`+${newLines[newIndex]}`)
					oldIndex++
					newIndex++
				}
			}
		}

		return diffLines.join("\n")
	}

	/**
	 * Find the next matching line between two arrays
	 */
	private findNextMatch(
		sourceLines: string[],
		sourceIndex: number,
		targetLines: string[],
		targetIndex: number,
	): number {
		const maxLookahead = 10

		for (let i = 0; i < maxLookahead && sourceIndex + i < sourceLines.length; i++) {
			for (let j = 0; j < maxLookahead && targetIndex + j < targetLines.length; j++) {
				if (sourceLines[sourceIndex + i] === targetLines[targetIndex + j]) {
					return targetIndex + j
				}
			}
		}

		return -1
	}

	/**
	 * Save edit history to database
	 */
	private async saveEditHistory(
		transactionalEdits: TransactionalEdit[],
		metadata: TransactionMetadata,
		transactionId: string,
	): Promise<void> {
		const affectedFiles = transactionalEdits.map((te) => te.filePath)
		const reversePatches = transactionalEdits.map((te) => ({
			filePath: te.filePath,
			diff: te.reverseDiff,
		}))
		const originalSnapshots = transactionalEdits.map((te) => ({
			filePath: te.filePath,
			content: te.originalContent,
		}))

		const editHistory: Omit<EditHistoryRecord, "id"> = {
			message_id: metadata.messageId,
			timestamp: Date.now(),
			affected_files: JSON.stringify(affectedFiles),
			reverse_patches: JSON.stringify(reversePatches),
			original_snapshots: JSON.stringify(originalSnapshots),
			metadata: JSON.stringify({
				...metadata,
				transactionId,
				workspaceRoot: this.workspaceRoot,
			}),
			is_reverted: false,
		}

		await this.databaseManager.saveEditHistory(editHistory)
		console.log(`[TransactionalExecutor] Saved edit history for transaction ${transactionId}`)
	}

	/**
	 * Attempt rollback on failed execution
	 */
	private async attemptRollback(transactionalEdits: TransactionalEdit[], messageId: string): Promise<void> {
		console.log(`[TransactionalExecutor] Attempting rollback for failed transaction`)

		try {
			for (const edit of transactionalEdits) {
				const fs = await import("fs/promises")
				const absolutePath = path.resolve(this.workspaceRoot, edit.filePath)

				// Restore original content
				await fs.writeFile(absolutePath, edit.originalContent, "utf8")
			}

			console.log(`[TransactionalExecutor] Rollback completed successfully`)
		} catch (error) {
			console.error(
				`[TransactionalExecutor] Rollback failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Get transaction history for a message
	 */
	async getTransactionHistory(messageId: string): Promise<EditHistoryRecord[]> {
		return await this.databaseManager.getEditHistoryByMessageId(messageId)
	}

	/**
	 * Get recent transactions
	 */
	async getRecentTransactions(limit: number = 20): Promise<EditHistoryRecord[]> {
		return await this.databaseManager.getRecentEditHistory(limit)
	}

	/**
	 * Check if a message has any edit history
	 */
	async hasEditHistory(messageId: string): Promise<boolean> {
		const history = await this.databaseManager.getEditHistoryByMessageId(messageId)
		return history.length > 0
	}
}
