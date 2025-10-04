import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"
import { calculateDiff, type BackgroundRange } from "./utils/CharacterDiff"
import { createSVGDecorationType, type SVGDecorationContent } from "./utils/createSVGDecorationType"

export const DELETION_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	isWholeLine: false,
	border: "1px solid",
	borderColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

/**
 * Hybrid ghost decorations: SVG highlighting for edits/additions, simple styling for deletions
 * Acts as an orchestrator using createSVGDecorationType utility
 */
export class GhostDecorations {
	private deletionDecorationType: vscode.TextEditorDecorationType
	private codeEditDecorationTypes: vscode.TextEditorDecorationType[] = []

	constructor() {
		this.deletionDecorationType = vscode.window.createTextEditorDecorationType(DELETION_DECORATION_OPTIONS)
	}

	/**
	 * Display edit operations using SVG decorations
	 */
	private async displayEditOperationGroup(
		editor: vscode.TextEditor,
		group: GhostSuggestionEditOperation[],
	): Promise<void> {
		const line = Math.min(...group.map((x) => x.oldLine))
		const range = this.calculateRangeForOperations(editor, line)

		const newContent = group.find((x) => x.type === "+")?.content || ""
		if (!newContent.trim()) {
			return
		}

		const originalContent = line < editor.document.lineCount ? editor.document.lineAt(line).text : ""
		const backgroundRanges = calculateDiff(originalContent, newContent)

		const svgContent: SVGDecorationContent = {
			text: newContent,
			backgroundRanges: backgroundRanges,
		}

		await this.createSvgDecoration(editor, range, svgContent)
	}

	/**
	 * Display deletion operations using simple border styling
	 */
	private displayDeleteOperationGroup(editor: vscode.TextEditor, group: GhostSuggestionEditOperation[]): void {
		const lines = group.map((x) => x.oldLine)
		const from = Math.min(...lines)
		const to = Math.max(...lines)

		// Safety check: ensure line numbers are within document bounds
		const maxLine = editor.document.lineCount - 1
		if (from < 0 || from > maxLine || to < 0 || to > maxLine) {
			console.warn(`Invalid line numbers for delete decoration: from=${from}, to=${to}, maxLine=${maxLine}`)
			return
		}

		const start = editor.document.lineAt(from).range.start
		const end = editor.document.lineAt(to).range.end
		const range = new vscode.Range(start, end)

		editor.setDecorations(this.deletionDecorationType, [{ range }])
	}

	/**
	 * Display suggestions using hybrid approach: SVG for edits/additions, simple styling for deletions
	 */
	public async displaySuggestions(suggestions: GhostSuggestionsState): Promise<void> {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		const documentUri = editor.document.uri
		const suggestionsFile = suggestions.getFile(documentUri)
		if (!suggestionsFile) {
			this.clearAll()
			return
		}
		const fileOperations = suggestions.getFile(documentUri)?.getAllOperations() || []
		if (fileOperations.length === 0) {
			this.clearAll()
			return
		}

		const groups = suggestionsFile.getGroupsOperations()
		if (groups.length === 0) {
			this.clearAll()
			return
		}

		const selectedGroupIndex = suggestionsFile.getSelectedGroup()
		if (selectedGroupIndex === null) {
			this.clearAll()
			return
		}
		const selectedGroup = groups[selectedGroupIndex]
		const groupType = suggestionsFile.getGroupType(selectedGroup)

		// Clear previous decorations
		this.clearAll()

		// Route to appropriate display method
		if (groupType === "/") {
			await this.displayEditOperationGroup(editor, selectedGroup)
		} else if (groupType === "-") {
			this.displayDeleteOperationGroup(editor, selectedGroup)
		} else if (groupType === "+") {
			await this.displayAdditionsOperationGroup(editor, selectedGroup)
		}
	}

	/**
	 * Display addition operations using SVG decorations
	 */
	private async displayAdditionsOperationGroup(
		editor: vscode.TextEditor,
		group: GhostSuggestionEditOperation[],
	): Promise<void> {
		const line = Math.min(...group.map((x) => x.oldLine))
		const range = this.calculateRangeForOperations(editor, line)

		const content = group
			.sort((a, b) => a.line - b.line)
			.map((x) => x.content)
			.join("\n")
		if (!content.trim()) {
			return
		}

		// For additions, all content is new/modified (highlight entire content)
		const backgroundRanges: BackgroundRange[] = [{ start: 0, end: content.length, type: "modified" }]
		const svgContent: SVGDecorationContent = {
			text: content,
			backgroundRanges: backgroundRanges,
		}

		await this.createSvgDecoration(editor, range, svgContent)
	}

	/**
	 * Calculate range for operations, handling end-of-document gracefully
	 */
	private calculateRangeForOperations(editor: vscode.TextEditor, line: number): vscode.Range {
		if (line >= editor.document.lineCount) {
			// If the line is beyond the document, use the last line of the document
			const lastLineIndex = Math.max(0, editor.document.lineCount - 1)
			const lastLineInfo = editor.document.lineAt(lastLineIndex)
			return new vscode.Range(lastLineInfo.range.end, lastLineInfo.range.end)
		} else {
			const nextLineInfo = editor.document.lineAt(line)
			return nextLineInfo.range
		}
	}

	/**
	 * Create SVG decoration using the createSVGDecorationType utility
	 */
	private async createSvgDecoration(
		editor: vscode.TextEditor,
		range: vscode.Range,
		content: SVGDecorationContent,
	): Promise<void> {
		const decorationType = await createSVGDecorationType(content, editor.document)
		this.codeEditDecorationTypes.push(decorationType)
		editor.setDecorations(decorationType, [{ range }])
	}

	/**
	 * Clears all ghost decorations from the active editor.
	 */
	public clearAll(): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		editor.setDecorations(this.deletionDecorationType, [])

		for (const decorationType of this.codeEditDecorationTypes) {
			decorationType.dispose()
		}
		this.codeEditDecorationTypes = []
	}
}
