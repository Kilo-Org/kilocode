import * as vscode from "vscode"
import { GhostSuggestionEditOperation } from "./types"

export class GhostDecorations {
	private additionDecorationType: vscode.TextEditorDecorationType
	private deletionDecorationType: vscode.TextEditorDecorationType

	constructor() {
		this.additionDecorationType = vscode.window.createTextEditorDecorationType({
			after: {
				margin: "0 0 0 0.1em",
				color: new vscode.ThemeColor("editorInlayHint.foreground"),
			},
			isWholeLine: true,
			overviewRulerColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
			overviewRulerLane: vscode.OverviewRulerLane.Right,
		})

		this.deletionDecorationType = vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			textDecoration: "line-through",
			color: new vscode.ThemeColor("editorInlayHint.foreground"),
			opacity: "0.8",
			overviewRulerColor: new vscode.ThemeColor("diffEditor.removedTextBackground"),
			overviewRulerLane: vscode.OverviewRulerLane.Right,
		})
	}

	/**
	 * Displays the ghost suggestions in the active text editor based on the provided operations.
	 * @param operations An array of edit operations to visualize.
	 */
	public displaySuggestions(operations: GhostSuggestionEditOperation[]): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}

		const additionDecorations: vscode.DecorationOptions[] = []
		const deletionDecorations: vscode.DecorationOptions[] = []

		const documentUri = editor.document.uri
		const fileOperations = operations
			.filter((op) => op.fileUri.toString() === documentUri.toString())
			.sort((a, b) => a.line - b.line)

		let linesAdded = 0
		let linesRemoved = 0

		for (const op of fileOperations) {
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

				additionDecorations.push({
					range,
					renderOptions: {
						after: {
							contentText: `${contentText}`,
						},
					},
				})
				linesAdded++
			}

			if (op.type === "-") {
				const anchorLine = op.line + linesAdded
				if (anchorLine < 0 || anchorLine >= editor.document.lineCount) {
					continue
				}
				const range = editor.document.lineAt(anchorLine).range
				deletionDecorations.push({ range })
				linesRemoved++
			}
		}

		// Apply the decorations directly
		editor.setDecorations(this.additionDecorationType, additionDecorations)
		editor.setDecorations(this.deletionDecorationType, deletionDecorations)
	}

	/**
	 * Clears all ghost decorations from the active editor.
	 */
	public clearAll(): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		// To clear decorations, set them to an empty array. [1, 7]
		editor.setDecorations(this.additionDecorationType, [])
		editor.setDecorations(this.deletionDecorationType, [])
	}
}
