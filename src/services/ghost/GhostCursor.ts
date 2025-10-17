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
		const groupType = suggestionsFile.getGroupType(group)

		if (groupType === "/" || groupType === "-") {
			const line = Math.min(...group.map((x) => x.oldLine))
			const lineText = editor.document.lineAt(line).text
			const lineLength = lineText.length
			editor.selection = new vscode.Selection(line, lineLength, line, lineLength)
			editor.revealRange(
				new vscode.Range(line, lineLength, line, lineLength),
				vscode.TextEditorRevealType.InCenter,
			)
		} else if (groupType === "+") {
			const line = Math.min(...group.map((x) => x.oldLine)) + group.length
			const lineText = editor.document.lineAt(line).text
			const lineLength = lineText.length
			editor.selection = new vscode.Selection(line, lineLength, line, lineLength)
			editor.revealRange(
				new vscode.Range(line, lineLength, line, lineLength),
				vscode.TextEditorRevealType.InCenter,
			)
		}
	}
}
