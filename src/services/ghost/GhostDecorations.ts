import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"

const ADDITION_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	after: {
		margin: "0 0 0 0.1em",
		color: new vscode.ThemeColor("editor.background"),
		backgroundColor: new vscode.ThemeColor("editorGutter.addedBackground"),
	},
	opacity: "0.8",
	isWholeLine: false,
	overviewRulerColor: new vscode.ThemeColor("editorGutter.addedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

const ADDITION_ACTIVE_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	...ADDITION_DECORATION_OPTIONS,
	after: {
		...ADDITION_DECORATION_OPTIONS.after,
		borderColor: new vscode.ThemeColor("editorGutter.addedSecondaryBackground"),
		border: "1px solid",
		fontWeight: "bold",
	},
}

const DELETION_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	isWholeLine: false,
	color: new vscode.ThemeColor("editor.background"),
	backgroundColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	opacity: "0.8",
	overviewRulerColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

const DELETION_ACTIVE_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	...DELETION_DECORATION_OPTIONS,
	borderColor: new vscode.ThemeColor("editorGutter.deletedSecondaryBackground"),
	borderStyle: "solid",
	borderWidth: "1px",
	fontWeight: "bold",
}

export class GhostDecorations {
	private additionDecorationType: vscode.TextEditorDecorationType
	private deletionDecorationType: vscode.TextEditorDecorationType
	private deletionActiveDecorationType: vscode.TextEditorDecorationType

	constructor() {
		this.additionDecorationType = vscode.window.createTextEditorDecorationType(ADDITION_DECORATION_OPTIONS)
		this.deletionDecorationType = vscode.window.createTextEditorDecorationType(DELETION_DECORATION_OPTIONS)
		this.deletionActiveDecorationType = vscode.window.createTextEditorDecorationType(
			DELETION_ACTIVE_DECORATION_OPTIONS,
		)
	}

	/**
	 * Displays the ghost suggestions in the active text editor based on the provided operations.
	 * @param operations An array of edit operations to visualize.
	 */
	public displaySuggestions(suggestions: GhostSuggestionsState): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}

		const additionDecorations: vscode.DecorationOptions[] = []
		const deletionDecorations: vscode.DecorationOptions[] = []
		const deletionActiveDecorations: vscode.DecorationOptions[] = []

		const documentUri = editor.document.uri
		const suggestionsFile = suggestions.getFile(documentUri)
		if (!suggestionsFile) {
			console.log(`No suggestions found for document: ${documentUri.toString()}`)
			return
		}
		const fileOperations = suggestions.getFile(documentUri)?.getAllOperations() || []
		if (fileOperations.length === 0) {
			console.log("No operations to display, returning")
			return
		}
		let linesAdded = 0
		let linesRemoved = 0

		const groups = suggestionsFile.getGroupsOperations()
		if (groups.length === 0) {
			console.log("No groups to display, returning")
			return
		}

		for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
			const operations = groups[groupIndex]
			const selected = groupIndex === suggestionsFile.getSelectedGroup()
			for (const op of operations) {
				if (op.type === "+") {
					const anchorLine = op.line + linesRemoved
					if (anchorLine < 0 || anchorLine >= editor.document.lineCount) {
						continue
					}

					const nextLineInfo = editor.document.lineAt(anchorLine)
					const position = nextLineInfo.range.start
					const range = new vscode.Range(position, position)

					// Whitespace in `contentText` collapses. To preserve indentation,
					// replace leading spaces with non-breaking space characters.
					const leadingWhitespace = op.content.match(/^\s*/)?.[0] ?? ""
					const preservedWhitespace = leadingWhitespace.replace(/ /g, "\u00A0")
					const trimmedContent = op.content.trimStart()

					// Make the ghost text more visible with a clear prefix and formatting
					// Split the content by newlines to handle multi-line additions properly
					const contentText = preservedWhitespace + trimmedContent

					const renderOptions: vscode.DecorationRenderOptions = selected
						? { ...ADDITION_ACTIVE_DECORATION_OPTIONS }
						: { ...ADDITION_DECORATION_OPTIONS }

					renderOptions.after = {
						...renderOptions.after,
						contentText: `${contentText}`,
					}

					additionDecorations.push({
						range,
						renderOptions,
					})
					linesAdded++
				}

				if (op.type === "-") {
					const anchorLine = op.line + linesAdded
					if (anchorLine < 0 || anchorLine >= editor.document.lineCount) {
						continue
					}
					const range = editor.document.lineAt(anchorLine).range

					if (selected) {
						deletionActiveDecorations.push({
							range,
						})
					} else {
						deletionDecorations.push({
							range,
						})
					}

					linesRemoved++
				}
			}
		}

		// Apply the decorations directly
		editor.setDecorations(this.additionDecorationType, additionDecorations)
		editor.setDecorations(this.deletionDecorationType, deletionDecorations)
		editor.setDecorations(this.deletionActiveDecorationType, deletionActiveDecorations)
	}

	/**
	 * Clears all ghost decorations from the active editor.
	 */
	public clearAll(): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		editor.setDecorations(this.additionDecorationType, [])
		editor.setDecorations(this.deletionDecorationType, [])
		editor.setDecorations(this.deletionActiveDecorationType, [])
	}
}
