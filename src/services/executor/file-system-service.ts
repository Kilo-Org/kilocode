// kilocode_change - new file

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import { ParsedEdit } from "./edit-parser"

/**
 * Helper functions for file operations
 */
async function ensureDir(dirPath: string): Promise<void> {
	try {
		await fs.mkdir(dirPath, { recursive: true })
	} catch (error) {
		// Directory might already exist
		if ((error as any).code !== "EEXIST") {
			throw error
		}
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

async function remove(filePath: string): Promise<void> {
	try {
		const stats = await fs.stat(filePath)
		if (stats.isDirectory()) {
			await fs.rmdir(filePath, { recursive: true })
		} else {
			await fs.unlink(filePath)
		}
	} catch (error) {
		// File might not exist
		if ((error as any).code !== "ENOENT") {
			throw error
		}
	}
}

export interface FileOperation {
	type: "create" | "update" | "delete"
	filePath: string
	content?: string
	originalContent?: string
	timestamp: number
}

export interface Transaction {
	id: string
	operations: FileOperation[]
	timestamp: number
	description?: string
}

export interface SafetyCheckResult {
	isSafe: boolean
	errors: string[]
	warnings: string[]
}

/**
 * File System Transaction Manager with atomic operations and undo/redo
 */
export class FileSystemService {
	private transactions: Transaction[] = []
	private currentTransaction: Transaction | null = null
	private workspaceRoot: string
	private dangerousPaths: string[] = [
		".git",
		"node_modules",
		".vscode",
		".idea",
		"dist",
		"build",
		"coverage",
		".nyc_output",
		".pytest_cache",
		"__pycache__",
	]

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
	}

	/**
	 * Start a new transaction
	 */
	async startTransaction(description?: string): Promise<string> {
		const transactionId = this.generateTransactionId()
		this.currentTransaction = {
			id: transactionId,
			operations: [],
			timestamp: Date.now(),
			description,
		}

		return transactionId
	}

	/**
	 * Commit the current transaction
	 */
	async commitTransaction(): Promise<void> {
		if (!this.currentTransaction) {
			throw new Error("No active transaction to commit")
		}

		// Apply all operations atomically
		const backupOperations: FileOperation[] = []

		try {
			for (const operation of this.currentTransaction.operations) {
				const backupOp = await this.applyOperation(operation)
				if (backupOp) {
					backupOperations.push(backupOp)
				}
			}

			// Add to transaction history
			this.transactions.push(this.currentTransaction)

			// Keep only last 50 transactions
			if (this.transactions.length > 50) {
				this.transactions = this.transactions.slice(-50)
			}
		} catch (error) {
			// Rollback on failure
			await this.rollbackOperations(backupOperations)
			throw error
		} finally {
			this.currentTransaction = null
		}
	}

	/**
	 * Rollback the current transaction
	 */
	async rollbackTransaction(): Promise<void> {
		if (!this.currentTransaction) {
			throw new Error("No active transaction to rollback")
		}

		await this.rollbackOperations(this.currentTransaction.operations)
		this.currentTransaction = null
	}

	/**
	 * Apply a single file operation
	 */
	private async applyOperation(operation: FileOperation): Promise<FileOperation | null> {
		const fullPath = path.resolve(this.workspaceRoot, operation.filePath)

		// Safety check
		const safetyCheck = await this.checkSafety(fullPath)
		if (!safetyCheck.isSafe) {
			throw new Error(`Safety check failed: ${safetyCheck.errors.join(", ")}`)
		}

		let backupOp: FileOperation | null = null

		switch (operation.type) {
			case "create":
				// Ensure directory exists
				await ensureDir(path.dirname(fullPath))

				// Create backup if file exists
				if (await pathExists(fullPath)) {
					backupOp = {
						type: "update",
						filePath: operation.filePath,
						content: await fs.readFile(fullPath, "utf8"),
						originalContent: operation.originalContent,
						timestamp: Date.now(),
					}
				}

				await fs.writeFile(fullPath, operation.content || "", "utf8")
				break

			case "update":
				// Create backup
				if (await pathExists(fullPath)) {
					backupOp = {
						type: "update",
						filePath: operation.filePath,
						content: await fs.readFile(fullPath, "utf8"),
						originalContent: operation.originalContent,
						timestamp: Date.now(),
					}
				}

				await fs.writeFile(fullPath, operation.content || "", "utf8")
				break

			case "delete":
				// Create backup
				if (await pathExists(fullPath)) {
					backupOp = {
						type: "create",
						filePath: operation.filePath,
						content: await fs.readFile(fullPath, "utf8"),
						originalContent: operation.originalContent,
						timestamp: Date.now(),
					}
				}

				await remove(fullPath)
				break
		}

		return backupOp
	}

	/**
	 * Rollback multiple operations
	 */
	private async rollbackOperations(operations: FileOperation[]): Promise<void> {
		// Rollback in reverse order
		for (const operation of operations.reverse()) {
			try {
				await this.rollbackOperation(operation)
			} catch (error) {
				console.error(`Failed to rollback operation for ${operation.filePath}:`, error)
			}
		}
	}

	/**
	 * Rollback a single operation
	 */
	private async rollbackOperation(operation: FileOperation): Promise<void> {
		const fullPath = path.resolve(this.workspaceRoot, operation.filePath)

		switch (operation.type) {
			case "create":
				// Delete the created file
				if (await pathExists(fullPath)) {
					await remove(fullPath)
				}
				break

			case "update":
				// Restore original content
				if (operation.originalContent) {
					await fs.writeFile(fullPath, operation.originalContent, "utf8")
				}
				break

			case "delete":
				// Restore the deleted file
				if (operation.content) {
					await ensureDir(path.dirname(fullPath))
					await fs.writeFile(fullPath, operation.content, "utf8")
				}
				break
		}
	}

	/**
	 * Apply parsed edits to files
	 */
	async applyEdits(edits: ParsedEdit[]): Promise<void> {
		const transactionId = await this.startTransaction("Apply AI edits")

		try {
			for (const edit of edits) {
				await this.applyEdit(edit)
			}

			await this.commitTransaction()
		} catch (error) {
			await this.rollbackTransaction()
			throw error
		}
	}

	/**
	 * Apply a single edit
	 */
	private async applyEdit(edit: ParsedEdit): Promise<void> {
		const fullPath = path.resolve(this.workspaceRoot, edit.filePath)

		// Safety check
		const safetyCheck = await this.checkSafety(fullPath)
		if (!safetyCheck.isSafe) {
			throw new Error(`Safety check failed for ${edit.filePath}: ${safetyCheck.errors.join(", ")}`)
		}

		let currentContent = ""
		let originalContent = ""

		// Read current file content if it exists
		if (await pathExists(fullPath)) {
			currentContent = await fs.readFile(fullPath, "utf8")
			originalContent = currentContent
		}

		let newContent = currentContent

		switch (edit.type) {
			case "search_replace":
				newContent = this.applySearchReplace(currentContent, edit.search || "", edit.replace || "")
				break

			case "insert":
				newContent = this.applyInsert(
					currentContent,
					edit.replace || "",
					edit.position || "before",
					edit.anchor || "",
				)
				break

			case "delete":
				newContent = this.applyDelete(currentContent, edit.search || "")
				break
		}

		// Add operation to transaction
		if (this.currentTransaction) {
			const operation: FileOperation = {
				type: (await pathExists(fullPath)) ? "update" : "create",
				filePath: edit.filePath,
				content: newContent,
				originalContent,
				timestamp: Date.now(),
			}

			this.currentTransaction.operations.push(operation)
		}
	}

	/**
	 * Apply search/replace edit
	 */
	private applySearchReplace(content: string, search: string, replace: string): string {
		// Try exact match first
		if (content.includes(search)) {
			return content.replace(search, replace)
		}

		// Try fuzzy matching
		const fuzzyResult = this.fuzzySearchReplace(content, search, replace)
		if (fuzzyResult.success) {
			return fuzzyResult.content
		}

		throw new Error(`Search content not found in file. Tried exact and fuzzy matching.`)
	}

	/**
	 * Apply insert edit
	 */
	private applyInsert(content: string, insertText: string, position: "before" | "after", anchor: string): string {
		const anchorIndex = content.indexOf(anchor)
		if (anchorIndex === -1) {
			throw new Error(`Anchor text not found: ${anchor}`)
		}

		const insertIndex = position === "before" ? anchorIndex : anchorIndex + anchor.length
		return content.slice(0, insertIndex) + insertText + content.slice(insertIndex)
	}

	/**
	 * Apply delete edit
	 */
	private applyDelete(content: string, searchText: string): string {
		// Try exact match first
		if (content.includes(searchText)) {
			return content.replace(searchText, "")
		}

		// Try fuzzy matching
		const fuzzyResult = this.fuzzySearchReplace(content, searchText, "")
		if (fuzzyResult.success) {
			return fuzzyResult.content
		}

		throw new Error(`Delete content not found in file. Tried exact and fuzzy matching.`)
	}

	/**
	 * Fuzzy search and replace with tolerance for whitespace differences
	 */
	private fuzzySearchReplace(
		content: string,
		search: string,
		replace: string,
	): { success: boolean; content: string } {
		const searchLines = search.split("\n").map((line) => line.trim())
		const contentLines = content.split("\n")

		// Try to find matching block with tolerance for whitespace
		for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
			const block = contentLines.slice(i, i + searchLines.length)
			const trimmedBlock = block.map((line) => line.trim())

			if (this.linesMatch(trimmedBlock, searchLines)) {
				// Found matching block
				const newLines = replace.split("\n")
				const newContent = [
					...contentLines.slice(0, i),
					...newLines,
					...contentLines.slice(i + searchLines.length),
				].join("\n")

				return { success: true, content: newContent }
			}
		}

		return { success: false, content }
	}

	/**
	 * Check if lines match with tolerance for whitespace
	 */
	private linesMatch(lines1: string[], lines2: string[]): boolean {
		if (lines1.length !== lines2.length) {
			return false
		}

		for (let i = 0; i < lines1.length; i++) {
			if (lines1[i].trim() !== lines2[i].trim()) {
				return false
			}
		}

		return true
	}

	/**
	 * Safety check for file operations
	 */
	async checkSafety(filePath: string): Promise<SafetyCheckResult> {
		const errors: string[] = []
		const warnings: string[] = []

		// Check if path is within workspace
		const resolvedPath = path.resolve(filePath)
		const resolvedWorkspace = path.resolve(this.workspaceRoot)

		if (!resolvedPath.startsWith(resolvedWorkspace)) {
			errors.push("File path is outside workspace")
		}

		// Check for dangerous paths
		const relativePath = path.relative(this.workspaceRoot, resolvedPath)
		for (const dangerousPath of this.dangerousPaths) {
			if (relativePath.includes(dangerousPath)) {
				errors.push(`Cannot modify files in ${dangerousPath}`)
			}
		}

		// Check for system files
		const systemFilePatterns = [
			/\.env(\..*)?$/,
			/\.DS_Store$/,
			/Thumbs\.db$/,
			/\.gitignore$/,
			/\.npmrc$/,
			/\.yarnrc$/,
			/package-lock\.json$/,
			/yarn\.lock$/,
			/pnpm-lock\.yaml$/,
		]

		for (const pattern of systemFilePatterns) {
			if (pattern.test(relativePath)) {
				warnings.push(`Modifying system file: ${relativePath}`)
			}
		}

		return {
			isSafe: errors.length === 0,
			errors,
			warnings,
		}
	}

	/**
	 * Undo the last transaction
	 */
	async undo(): Promise<boolean> {
		if (this.transactions.length === 0) {
			return false
		}

		const lastTransaction = this.transactions.pop()!
		await this.rollbackOperations(lastTransaction.operations)
		return true
	}

	/**
	 * Redo the last undone transaction
	 */
	async redo(): Promise<boolean> {
		// For simplicity, we don't implement redo in this version
		// Would need to store undone transactions separately
		return false
	}

	/**
	 * Get transaction history
	 */
	getTransactionHistory(): Transaction[] {
		return [...this.transactions]
	}

	/**
	 * Generate unique transaction ID
	 */
	private generateTransactionId(): string {
		return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
	}

	/**
	 * Read file fragment
	 */
	async readFileFragment(filePath: string, startLine: number, endLine: number): Promise<string> {
		const fullPath = path.resolve(this.workspaceRoot, filePath)

		const safetyCheck = await this.checkSafety(fullPath)
		if (!safetyCheck.isSafe) {
			throw new Error(`Safety check failed: ${safetyCheck.errors.join(", ")}`)
		}

		if (!(await pathExists(fullPath))) {
			throw new Error(`File not found: ${filePath}`)
		}

		const content = await fs.readFile(fullPath, "utf8")
		const lines = content.split("\n")

		const start = Math.max(0, startLine - 1) // Convert to 0-based
		const end = Math.min(lines.length, endLine)

		return lines.slice(start, end).join("\n")
	}

	/**
	 * Test code syntax (placeholder - would integrate with LSP)
	 */
	async testCodeSyntax(filePath: string): Promise<{ isValid: boolean; errors: string[] }> {
		// This would integrate with LSP for actual syntax checking
		// For now, return a placeholder result
		return {
			isValid: true,
			errors: [],
		}
	}
}
