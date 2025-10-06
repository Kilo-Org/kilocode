import * as vscode from "vscode"
import { GhostSuggestionEditOperation, GhostSuggestionEditOperationsOffset } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"

export class GhostWorkspaceEdit {
	private locked: boolean = false

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

	private getActiveFileOperations(suggestions: GhostSuggestionsState) {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return {
				documentUri: null,
				operations: [],
			}
		}
		const documentUri = editor.document.uri
		const operations = suggestions.getFile(documentUri)?.getAllOperations() || []
		return {
			documentUri,
			operations,
		}
	}

	private async getActiveFileSelectedOperations(suggestions: GhostSuggestionsState) {
		const empty = {
			documentUri: null,
			operations: [],
			previousOperations: [],
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return empty
		}
		const documentUri = editor.document.uri
		const suggestionsFile = suggestions.getFile(documentUri)
		if (!suggestionsFile) {
			return empty
		}
		const operations = suggestionsFile.getSelectedGroupOperations()
		const previousOperations = suggestionsFile.getSelectedGroupPreviousOperations()
		return {
			documentUri,
			operations,
			previousOperations,
		}
	}

	public isLocked(): boolean {
		return this.locked
	}

	public async applySuggestions(suggestions: GhostSuggestionsState) {
		if (this.locked) {
			return
		}
		this.locked = true
		const { documentUri, operations } = this.getActiveFileOperations(suggestions)
		if (!documentUri || operations.length === 0) {
			this.locked = false
			return
		}
		await this.applyOperations(documentUri, operations, [])
		this.locked = false
	}

	public async applySelectedSuggestions(suggestions: GhostSuggestionsState) {
		if (this.locked) {
			return
		}
		this.locked = true
		const { documentUri, operations, previousOperations } = await this.getActiveFileSelectedOperations(suggestions)
		if (!documentUri || operations.length === 0) {
			this.locked = false
			return
		}
		await this.applyOperations(documentUri, operations, previousOperations)
		this.locked = false
	}

	public async revertSuggestionsPlaceholder(suggestions: GhostSuggestionsState): Promise<void> {
		if (this.locked) {
			return
		}
		this.locked = true
		const { documentUri, operations } = this.getActiveFileOperations(suggestions)
		if (!documentUri || operations.length === 0) {
			this.locked = false
			return
		}
		await this.revertOperationsPlaceholder(documentUri, operations)
		this.locked = false
	}

	public async applySuggestionsPlaceholders(suggestions: GhostSuggestionsState) {
		if (this.locked) {
			return
		}
		this.locked = true
		const { documentUri, operations } = await this.getActiveFileOperations(suggestions)
		if (!documentUri || operations.length === 0) {
			this.locked = false
			return
		}
		await this.applyOperationsPlaceholders(documentUri, operations)
		this.locked = false
	}
}
