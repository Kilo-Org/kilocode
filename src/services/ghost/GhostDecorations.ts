import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"
import { generateCodeSVG, SVGRenderOptions } from "./utils/SvgRenderer"
import {
	initializeHighlighter,
	getLanguageForDocument,
	type DiffLine,
	type CharacterRange,
} from "./utils/CodeHighlighter"
import { calculateTipDimensions } from "./utils/HtmlToSvgRenderer"
import { calculateCharacterDiff, type BackgroundRange } from "./utils/CharacterDiff"

interface SvgDecorationContent {
	text: string // The new content to display
	backgroundRanges: BackgroundRange[] // Character ranges to highlight
}

const DELETION_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	isWholeLine: false,
	border: "1px solid",
	borderColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

/**
 * Hybrid ghost decorations: SVG highlighting for edits/additions, simple styling for deletions
 */
export class GhostDecorations {
	private deletionDecorationType: vscode.TextEditorDecorationType
	private svgDecorationTypes: vscode.TextEditorDecorationType[] = []

	constructor() {
		this.deletionDecorationType = vscode.window.createTextEditorDecorationType(DELETION_DECORATION_OPTIONS)
		this.initializeAsync()
	}

	private async initializeAsync(): Promise<void> {
		try {
			await initializeHighlighter()
		} catch (error) {
			console.error("Failed to initialize ghost decorations:", error)
		}
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
		const backgroundRanges = calculateCharacterDiff(originalContent, newContent)
		const svgContent: SvgDecorationContent = {
			text: newContent,
			backgroundRanges: backgroundRanges,
		}

		await this.createSvgDecoration(editor, range, svgContent)
	}

	/**
	 * Display deletion operations using simple border styling (original implementation)
	 */
	private displayDeleteOperationGroup(editor: vscode.TextEditor, group: GhostSuggestionEditOperation[]): void {
		const lines = group.map((x) => x.oldLine)
		const from = Math.min(...lines)
		const to = Math.max(...lines)

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
			console.log("No active editor found, returning")
			return
		}

		const documentUri = editor.document.uri
		const suggestionsFile = suggestions.getFile(documentUri)
		if (!suggestionsFile) {
			console.log(`No suggestions found for document: ${documentUri.toString()}`)
			this.clearAll()
			return
		}
		const fileOperations = suggestions.getFile(documentUri)?.getAllOperations() || []
		if (fileOperations.length === 0) {
			console.log("No operations to display, returning")
			this.clearAll()
			return
		}

		const groups = suggestionsFile.getGroupsOperations()
		if (groups.length === 0) {
			console.log("No groups to display, returning")
			this.clearAll()
			return
		}

		const selectedGroupIndex = suggestionsFile.getSelectedGroup()
		if (selectedGroupIndex === null) {
			console.log("No group selected, returning")
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
		const svgContent: SvgDecorationContent = {
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
	 * Create SVG decoration with character-level highlighting
	 */
	private async createSvgDecoration(
		editor: vscode.TextEditor,
		range: vscode.Range,
		content: SvgDecorationContent,
	): Promise<void> {
		const language = getLanguageForDocument(editor.document)
		const { fontSize, fontFamily, lineHeight } = this.getEditorConfiguration()

		const dimensions = calculateTipDimensions(content.text, fontSize, lineHeight)
		const svgOptions: SVGRenderOptions = { fontSize, fontFamily, dimensions, lineHeight }

		// Convert BackgroundRange to CharacterRange format
		const characterRanges: CharacterRange[] = content.backgroundRanges.map((range) => ({
			start: range.start,
			end: range.end,
			type: range.type,
		}))

		const diffLines: DiffLine[] = [
			{
				type: "new",
				line: content.text,
				characterRanges: characterRanges,
			},
		]

		const svgDataUri = await generateCodeSVG(content.text, language, svgOptions, range.start.line, diffLines)

		// Create decoration with SVG
		const offsetFromTop = 0
		const marginLeft = Math.ceil(fontSize * 0.6 + 6)
		const decorationType = vscode.window.createTextEditorDecorationType({
			after: {
				contentIconPath: vscode.Uri.parse(svgDataUri),
				border: `transparent; position: absolute; z-index: 2147483647;
				filter: drop-shadow(4px 4px 0px rgba(0, 0, 0, 0.2));
				margin-top: ${-1 * offsetFromTop}px;
				margin-left: ${marginLeft}px;`,
				width: `${dimensions.width}px`,
				height: `${dimensions.height}px`,
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		})

		this.svgDecorationTypes.push(decorationType)
		editor.setDecorations(decorationType, [{ range }])
	}
	/**
	 * Get all editor configuration values in one call
	 */
	private getEditorConfiguration(): { fontSize: number; fontFamily: string; lineHeight: number } {
		const config = vscode.workspace.getConfiguration("editor")
		const fontSize = config.get<number>("fontSize") || 14
		const rawLineHeight = config.get<number>("lineHeight") || 1.5

		// VS Code lineHeight can be either:
		// - A multiplier (like 1.2) if < 8
		// - An absolute pixel value (like 18) if >= 8
		const lineHeight = rawLineHeight < 8 ? rawLineHeight : rawLineHeight / fontSize

		return {
			fontSize,
			fontFamily: config.get<string>("fontFamily") || "Consolas, 'Courier New', monospace",
			lineHeight,
		}
	}

	/**
	 * Clears all ghost decorations from the active editor.
	 */
	public clearAll(): void {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		// Clear deletion decorations
		editor.setDecorations(this.deletionDecorationType, [])

		// Clear SVG decorations
		for (const decorationType of this.svgDecorationTypes) {
			editor.setDecorations(decorationType, [])
			decorationType.dispose()
		}
		this.svgDecorationTypes = []
	}
}
