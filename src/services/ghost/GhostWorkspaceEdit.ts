import * as vscode from "vscode"
import { GhostSuggestionEditOperation } from "./types"

export class GhostWorkspaceEdit {
	public async applyOperations(operations: GhostSuggestionEditOperation[]) {
		const editor = vscode.window.activeTextEditor

		if (!editor) {
			console.log("No active editor found, returning.")
			return
		}

		const documentUri = editor.document.uri
		const workspaceEdit = new vscode.WorkspaceEdit()

		const deleteOps = operations.filter((op) => op.type === "-").sort((a, b) => a.line - b.line)
		const insertOps = operations.filter((op) => op.type === "+").sort((a, b) => a.line - b.line)

		let delPtr = 0
		let insPtr = 0
		let lineOffset = 0

		while (delPtr < deleteOps.length || insPtr < insertOps.length) {
			const nextDeleteOriginalLine = deleteOps[delPtr]?.line ?? Infinity
			const nextInsertOriginalLine = (insertOps[insPtr]?.line ?? Infinity) - lineOffset

			if (nextDeleteOriginalLine <= nextInsertOriginalLine) {
				// Process the deletion next
				const op = deleteOps[delPtr]
				const range = editor.document.lineAt(op.line).rangeIncludingLineBreak
				workspaceEdit.delete(documentUri, range)

				lineOffset--
				delPtr++
			} else {
				// Process the insertion next
				const op = insertOps[insPtr]
				const position = new vscode.Position(nextInsertOriginalLine, 0)
				const textToInsert = (op.content || "") + "\n"
				workspaceEdit.insert(documentUri, position, textToInsert)

				lineOffset++
				insPtr++
			}
		}

		await vscode.workspace.applyEdit(workspaceEdit)
	}

	public async revertOperationsPlaceHolder(operations: GhostSuggestionEditOperation[]): Promise<void> {
		let workspaceEdit = new vscode.WorkspaceEdit()
		const editor = vscode.window.activeTextEditor

		if (!editor) {
			console.log("No active editor found, returning")
			return
		}

		// Filter Operations of the current file
		const filteredOperations = operations
			.filter((op) => op.fileUri.toString() === editor.document.uri.toString())
			.sort((a, b) => a.line - b.line)

		let deletedLines: number = 0
		for (const op of filteredOperations) {
			if (op.type === "-") {
				deletedLines++
			}
			if (op.type === "+") {
				const startPosition = new vscode.Position(op.line + deletedLines, 0)
				const endPosition = new vscode.Position(op.line + deletedLines + 1, 0)
				const range = new vscode.Range(startPosition, endPosition)
				workspaceEdit.delete(op.fileUri, range)
			}
		}
		await vscode.workspace.applyEdit(workspaceEdit)
	}

	public async applyOperationsPlaceholders(operations: GhostSuggestionEditOperation[]) {
		const editor = vscode.window.activeTextEditor
		const workspaceEdit = new vscode.WorkspaceEdit()
		if (!editor) {
			console.log("No active editor found, returning.")
			return
		}

		const documentUri = editor.document.uri
		const fileOperations = operations
			.filter((op) => op.fileUri.toString() === documentUri.toString())
			.sort((a, b) => a.line - b.line)

		let lineOffset = 0
		for (const op of fileOperations) {
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
				if (originalLine >= editor.document.lineCount) {
					continue
				}
				lineOffset--
			}
		}
		await vscode.workspace.applyEdit(workspaceEdit)
	}
}
