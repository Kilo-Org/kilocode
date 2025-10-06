import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"

export class GhostCursor {
	public moveToAppliedGroup(suggestions: GhostSuggestionsState) {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}

		const documentUri = editor.document.uri
		const suggestionsFile = suggestions.getFile(documentUri)
		if (!suggestionsFile) {
			console.log(`No suggestions found for document: ${documentUri.toString()}`)
			return
		}
		const groups = suggestionsFile.getGroupsOperations()
		if (groups.length === 0) {
			console.log("No groups to display, returning")
			return
		}
		const selectedGroupIndex = suggestionsFile.getSelectedGroup()
		if (selectedGroupIndex === null) {
			console.log("No group selected, returning")
			return
		}
		const group = groups[selectedGroupIndex]
		if (group.length === 0) {
			console.log("Group is empty, returning")
			return
		}

		const groupType = suggestionsFile.getGroupType(group)
		const documentLineCount = editor.document.lineCount

		if (groupType === "/" || groupType === "-") {
			const calculatedLine = Math.min(...group.map((x) => x.oldLine))
			const line = this.validateLineNumber(calculatedLine, documentLineCount)
			if (line === null) return

			const lineText = editor.document.lineAt(line).text
			const lineLength = lineText.length
			editor.selection = new vscode.Selection(line, lineLength, line, lineLength)
			editor.revealRange(
				new vscode.Range(line, lineLength, line, lineLength),
				vscode.TextEditorRevealType.InCenter,
			)
		} else if (groupType === "+") {
			const calculatedLine = Math.min(...group.map((x) => x.oldLine)) + group.length
			const line = this.validateLineNumber(calculatedLine, documentLineCount)
			if (line === null) return

			const lineText = editor.document.lineAt(line).text
			const lineLength = lineText.length
			editor.selection = new vscode.Selection(line, lineLength, line, lineLength)
			editor.revealRange(
				new vscode.Range(line, lineLength, line, lineLength),
				vscode.TextEditorRevealType.InCenter,
			)
		}
	}

	private validateLineNumber(line: number, documentLineCount: number): number | null {
		if (!Number.isFinite(line) || line < 0) {
			console.warn(`Invalid line number: ${line}, must be >= 0`)
			return null
		}
		if (line >= documentLineCount) {
			console.warn(`Line number ${line} exceeds document line count ${documentLineCount}`)
			return Math.max(0, documentLineCount - 1)
		}
		return line
	}
}
