import * as vscode from "vscode"
import { GhostSuggestionEditOperation, GhostSuggestionEditOperationsOffset } from "../types"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { IGhostApplicator } from "./IGhostApplicator"

/**
 * VSCode-specific implementation for applying Ghost suggestions
 * Uses VSCode WorkspaceEdit APIs for file modifications
 *
 * This class is the abstraction layer between platform-independent Ghost logic
 * and VSCode-specific APIs. It converts string URIs to vscode.Uri and handles
 * all VSCode WorkspaceEdit operations.
 */
export class VSCodeGhostApplicator implements IGhostApplicator {
	private locked: boolean = false

	/**
	 * Apply all suggestions from a GhostSuggestionsState
	 * @param suggestions The suggestions to apply
	 * @param fileUri Platform-independent file URI as string
	 */
	public async applyAll(suggestions: GhostSuggestionsState, fileUri: string): Promise<void> {
		if (this.locked) return
		this.locked = true

		// Convert string URI to vscode.Uri
		const uri = vscode.Uri.parse(fileUri)

		const { documentUri, operations } = this.getActiveFileOperations(suggestions, uri)
		if (!documentUri || operations.length === 0) {
			this.locked = false
			return
		}

		await this.applyOperations(documentUri, operations, [])
		this.locked = false
	}

	/**
	 * Apply only the selected group of suggestions
	 * @param suggestions The suggestions to apply
	 * @param fileUri Platform-independent file URI as string
	 */
	public async applySelected(suggestions: GhostSuggestionsState, fileUri: string): Promise<void> {
		if (this.locked) return
		this.locked = true

		// Convert string URI to vscode.Uri
		const uri = vscode.Uri.parse(fileUri)

		const { documentUri, operations, previousOperations } = await this.getActiveFileSelectedOperations(
			suggestions,
			uri,
		)
		if (!documentUri || operations.length === 0) {
			this.locked = false
			return
		}

		await this.applyOperations(documentUri, operations, previousOperations)
		this.locked = false
	}

	/**
	 * Check if applicator is currently locked (prevents concurrent edits)
	 */
	public isLocked(): boolean {
		return this.locked
	}

	/**
	 * Get operations for a specific file URI
	 * @param suggestions The suggestions state
	 * @param documentUri The VSCode URI of the document
	 */
	private getActiveFileOperations(suggestions: GhostSuggestionsState, documentUri: vscode.Uri) {
		const operations = suggestions.getFile(documentUri)?.getAllOperations() || []
		return { documentUri, operations }
	}

	/**
	 * Get selected operations for a specific file URI
	 * @param suggestions The suggestions state
	 * @param documentUri The VSCode URI of the document
	 */
	private async getActiveFileSelectedOperations(suggestions: GhostSuggestionsState, documentUri: vscode.Uri) {
		const suggestionsFile = suggestions.getFile(documentUri)
		if (!suggestionsFile) {
			return {
				documentUri: null,
				operations: [],
				previousOperations: [],
			}
		}
		const operations = suggestionsFile.getSelectedGroupOperations()
		const previousOperations = suggestionsFile.getSelectedGroupPreviousOperations()
		return { documentUri, operations, previousOperations }
	}

	/**
	 * Group operations into contiguous blocks by line number
	 */
	private groupOperationsIntoBlocks = <T>(ops: T[], lineKey: keyof T): T[][] => {
		if (ops.length === 0) {
			return []
		}
		const blocks: T[][] = [[ops[0]]]
		for (let i = 1; i < ops.length; i++) {
			const op = ops[i]
			const lastBlock = blocks[blocks.length - 1]
			const lastOp = lastBlock[lastBlock.length - 1]
			if (Number(op[lineKey]) === Number(lastOp[lineKey]) + 1) {
				lastBlock.push(op)
			} else if (Number(op[lineKey]) === Number(lastOp[lineKey])) {
				lastBlock.push(op)
			} else {
				blocks.push([op])
			}
		}
		return blocks
	}

	/**
	 * Apply operations to a document using VSCode WorkspaceEdit API
	 * This is the core method that handles all the complex logic for applying
	 * insertions and deletions while maintaining correct line positions.
	 */
	private async applyOperations(
		documentUri: vscode.Uri,
		operations: GhostSuggestionEditOperation[],
		previousOperations: GhostSuggestionEditOperation[],
	) {
		const workspaceEdit = new vscode.WorkspaceEdit()
		if (operations.length === 0) {
			return // No operations to apply
		}

		const document = await vscode.workspace.openTextDocument(documentUri)
		if (!document) {
			console.log(`Could not open document: ${documentUri.toString()}`)
			return
		}
		// --- 1. Calculate Initial State from Previous Operations ---
		let originalLineCursor = 0
		let finalLineCursor = 0

		if (previousOperations.length > 0) {
			const prevDeletes = previousOperations.filter((op) => op.type === "-").sort((a, b) => a.line - b.line)
			const prevInserts = previousOperations.filter((op) => op.type === "+").sort((a, b) => a.line - b.line)
			let prevDelPtr = 0
			let prevInsPtr = 0

			// "Dry run" the simulation on previous operations to set the cursors accurately.
			while (prevDelPtr < prevDeletes.length || prevInsPtr < prevInserts.length) {
				const nextDelLine = prevDeletes[prevDelPtr]?.line ?? Infinity
				const nextInsLine = prevInserts[prevInsPtr]?.line ?? Infinity

				if (nextDelLine <= originalLineCursor && nextDelLine !== Infinity) {
					originalLineCursor++
					prevDelPtr++
				} else if (nextInsLine <= finalLineCursor && nextInsLine !== Infinity) {
					finalLineCursor++
					prevInsPtr++
				} else if (nextDelLine === Infinity && nextInsLine === Infinity) {
					break
				} else {
					originalLineCursor++
					finalLineCursor++
				}
			}
		}

		// --- 2. Translate and Prepare Current Operations ---
		const currentDeletes = operations.filter((op) => op.type === "-").sort((a, b) => a.line - b.line)
		const currentInserts = operations.filter((op) => op.type === "+").sort((a, b) => a.line - b.line)
		const translatedInsertOps: { originalLine: number; content: string }[] = []
		let currDelPtr = 0
		let currInsPtr = 0

		// Run the simulation for the new operations, starting from the state calculated above.
		while (currDelPtr < currentDeletes.length || currInsPtr < currentInserts.length) {
			const nextDelLine = currentDeletes[currDelPtr]?.line ?? Infinity
			const nextInsLine = currentInserts[currInsPtr]?.line ?? Infinity

			if (nextDelLine <= originalLineCursor && nextDelLine !== Infinity) {
				originalLineCursor++
				currDelPtr++
			} else if (nextInsLine <= finalLineCursor && nextInsLine !== Infinity) {
				translatedInsertOps.push({
					originalLine: originalLineCursor,
					content: currentInserts[currInsPtr].content || "",
				})
				finalLineCursor++
				currInsPtr++
			} else if (nextDelLine === Infinity && nextInsLine === Infinity) {
				break
			} else {
				originalLineCursor++
				finalLineCursor++
			}
		}

		// --- 3. Group and Apply Deletions ---
		const deleteBlocks = this.groupOperationsIntoBlocks(currentDeletes, "line")
		for (const block of deleteBlocks) {
			const firstDeleteLine = block[0].line
			const lastDeleteLine = block[block.length - 1].line
			const startPosition = new vscode.Position(firstDeleteLine, 0)
			let endPosition

			if (lastDeleteLine >= document.lineCount - 1) {
				endPosition = document.lineAt(lastDeleteLine).rangeIncludingLineBreak.end
			} else {
				endPosition = new vscode.Position(lastDeleteLine + 1, 0)
			}
			workspaceEdit.delete(documentUri, new vscode.Range(startPosition, endPosition))
		}

		// --- 4. Group and Apply Translated Insertions ---
		const insertionBlocks = this.groupOperationsIntoBlocks(translatedInsertOps, "originalLine")
		for (const block of insertionBlocks) {
			const anchorLine = block[0].originalLine
			const textToInsert = block.map((op) => op.content).join("\n") + "\n"
			workspaceEdit.insert(documentUri, new vscode.Position(anchorLine, 0), textToInsert)
		}

		await vscode.workspace.applyEdit(workspaceEdit)
	}

	/**
	 * Revert placeholder operations (used for temporary visual feedback)
	 */
	private async revertOperationsPlaceholder(documentUri: vscode.Uri, operations: GhostSuggestionEditOperation[]) {
		const workspaceEdit = new vscode.WorkspaceEdit()
		let deletedLines: number = 0
		for (const op of operations) {
			if (op.type === "-") {
				deletedLines++
			}
			if (op.type === "+") {
				const startPosition = new vscode.Position(op.line + deletedLines, 0)
				const endPosition = new vscode.Position(op.line + deletedLines + 1, 0)
				const range = new vscode.Range(startPosition, endPosition)
				workspaceEdit.delete(documentUri, range)
			}
		}
		await vscode.workspace.applyEdit(workspaceEdit)
	}

	/**
	 * Apply placeholder operations (used for temporary visual feedback)
	 */
	private async applyOperationsPlaceholders(documentUri: vscode.Uri, operations: GhostSuggestionEditOperation[]) {
		const workspaceEdit = new vscode.WorkspaceEdit()
		const document = await vscode.workspace.openTextDocument(documentUri)
		if (!document) {
			console.log(`Could not open document: ${documentUri.toString()}`)
			return
		}

		let lineOffset = 0
		for (const op of operations) {
			// Calculate the equivalent line in the *original* document.
			const originalLine = op.line - lineOffset

			// A quick guard against invalid operations.
			if (originalLine < 0) {
				continue
			}

			if (op.type === "+") {
				const position = new vscode.Position(originalLine, 0)
				const textToInsert = "\n"
				workspaceEdit.insert(documentUri, position, textToInsert)
				lineOffset++
			}

			if (op.type === "-") {
				// Guard against deleting a line that doesn't exist.
				if (originalLine >= document.lineCount) {
					continue
				}
				lineOffset--
			}
		}

		await vscode.workspace.applyEdit(workspaceEdit)
	}

	/**
	 * Public method to revert suggestion placeholders
	 * Used by GhostProvider for visual feedback management
	 */
	public async revertSuggestionsPlaceholder(suggestions: GhostSuggestionsState): Promise<void> {
		if (this.locked) {
			return
		}
		this.locked = true

		const editor = vscode.window.activeTextEditor
		if (!editor) {
			this.locked = false
			return
		}

		const documentUri = editor.document.uri
		const operations = suggestions.getFile(documentUri)?.getAllOperations() || []

		if (operations.length === 0) {
			this.locked = false
			return
		}

		await this.revertOperationsPlaceholder(documentUri, operations)
		this.locked = false
	}

	/**
	 * Public method to apply suggestion placeholders
	 * Used by GhostProvider for visual feedback management
	 */
	public async applySuggestionsPlaceholders(suggestions: GhostSuggestionsState) {
		if (this.locked) {
			return
		}
		this.locked = true

		const editor = vscode.window.activeTextEditor
		if (!editor) {
			this.locked = false
			return
		}

		const documentUri = editor.document.uri
		const operations = suggestions.getFile(documentUri)?.getAllOperations() || []

		if (operations.length === 0) {
			this.locked = false
			return
		}

		await this.applyOperationsPlaceholders(documentUri, operations)
		this.locked = false
	}
}
