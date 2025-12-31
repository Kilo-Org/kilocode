// kilocode_change - new file

import { FileSystemService } from "./file-system-service"
import { ValidationService } from "./validation-service"
import { DiffProvider } from "./diff-provider"
import { OdooEnhancedExecutor } from "./odoo-enhanced-executor"
import { EditParser, ParsedEdit, ParseResult } from "./edit-parser"
import * as vscode from "vscode"
import * as path from "path"

/**
 * Main Executor Service that orchestrates all AI execution capabilities
 */
export class ExecutorService {
	private fileSystemService: FileSystemService
	private validationService: ValidationService
	private diffProvider: DiffProvider
	private odooEnhancedExecutor: OdooEnhancedExecutor

	constructor(
		private workspaceRoot: string,
		private context: vscode.ExtensionContext,
	) {
		this.fileSystemService = new FileSystemService(workspaceRoot)
		this.validationService = new ValidationService(workspaceRoot)
		this.diffProvider = new DiffProvider(context, this.fileSystemService, this.validationService)
		this.odooEnhancedExecutor = new OdooEnhancedExecutor(
			this.fileSystemService,
			this.validationService,
			workspaceRoot,
		)
	}

	/**
	 * Read file fragment for precise reading before editing
	 */
	async readFileFragment(filePath: string, startLine: number, endLine: number): Promise<string> {
		return this.fileSystemService.readFileFragment(filePath, startLine, endLine)
	}

	/**
	 * Apply multi-file patch with coordinated changes
	 */
	async applyMultiFilePatch(patches: Array<{ filePath: string; edits: ParsedEdit[] }>): Promise<void> {
		// Convert to MultiFilePatch format for Odoo enhancement
		const multiFilePatches = patches.map((patch) => ({
			filePath: patch.filePath,
			edits: patch.edits,
			dependencies: [],
		}))

		// Check if this is an Odoo project
		if (await this.isOdooProject()) {
			await this.odooEnhancedExecutor.applyMultiFilePatch(multiFilePatches)
		} else {
			// Apply patches normally
			await this.fileSystemService.applyEdits(patches.flatMap((p) => p.edits))
		}
	}

	/**
	 * Test code syntax for file integrity
	 */
	async testCodeSyntax(filePath: string): Promise<{ isValid: boolean; errors: string[] }> {
		return this.fileSystemService.testCodeSyntax(filePath)
	}

	/**
	 * Parse AI-generated edit blocks
	 */
	parseEditBlocks(text: string, defaultFilePath?: string): ParseResult {
		return EditParser.parseEdits(text, defaultFilePath)
	}

	/**
	 * Validate edits before applying
	 */
	async validateEdits(edits: ParsedEdit[]): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
		const result = await this.validationService.validateEdits(edits)
		return {
			isValid: result.isValid,
			errors: result.syntaxErrors,
			warnings: result.warnings,
		}
	}

	/**
	 * Show pending edits in the editor
	 */
	showPendingEdits(filePath: string, edits: ParsedEdit[]): void {
		this.diffProvider.showPendingEdits(filePath, edits)
	}

	/**
	 * Accept a specific edit
	 */
	async acceptEdit(filePath: string, editId: string): Promise<void> {
		await this.diffProvider.acceptEdit(filePath, editId)
	}

	/**
	 * Reject a specific edit
	 */
	rejectEdit(filePath: string, editId: string): void {
		this.diffProvider.rejectEdit(filePath, editId)
	}

	/**
	 * Accept all pending edits
	 */
	async acceptAllEdits(filePath: string): Promise<void> {
		await this.diffProvider.acceptAllEdits(filePath)
	}

	/**
	 * Reject all pending edits
	 */
	rejectAllEdits(filePath: string): void {
		this.diffProvider.rejectAllEdits(filePath)
	}

	/**
	 * Clear pending edits for a file
	 */
	clearPendingEdits(filePath: string): void {
		this.diffProvider.clearPendingEdits(filePath)
	}

	/**
	 * Undo the last transaction
	 */
	async undo(): Promise<boolean> {
		return this.fileSystemService.undo()
	}

	/**
	 * Get transaction history
	 */
	getTransactionHistory(): any[] {
		return this.fileSystemService.getTransactionHistory()
	}

	/**
	 * Get Odoo project statistics
	 */
	getOdooStats(): any {
		return this.odooEnhancedExecutor.getOdooStats()
	}

	/**
	 * Check if the current project is an Odoo project
	 */
	private async isOdooProject(): Promise<boolean> {
		const fs = require("fs").promises
		const manifestFiles = ["__manifest__.py", "__openerp__.py"]

		for (const manifest of manifestFiles) {
			try {
				await fs.access(path.join(this.workspaceRoot, manifest))
				return true
			} catch {
				// File doesn't exist, continue checking
			}
		}

		return false
	}

	/**
	 * Get executor statistics
	 */
	getStats(): any {
		return {
			workspaceRoot: this.workspaceRoot,
			transactionHistory: this.fileSystemService.getTransactionHistory().length,
			odooStats: this.getOdooStats(),
		}
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.diffProvider.dispose()
	}
}
