import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"

const ADDITION_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	after: {
		color: new vscode.ThemeColor("editor.foreground"),
		backgroundColor: new vscode.ThemeColor("editor.background"),
		border: "1px solid",
		borderColor: new vscode.ThemeColor("editorGutter.addedBackground"),
	},
	isWholeLine: false,
	borderColor: new vscode.ThemeColor("editorGutter.addedBackground"),
	overviewRulerColor: new vscode.ThemeColor("editorGutter.addedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

const DELETION_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	isWholeLine: false,
	color: new vscode.ThemeColor("editor.background"),
	backgroundColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

const EDIT_DECORATION_OPTIONS: vscode.DecorationRenderOptions = {
	after: {
		// CSS INJECT
		textDecoration:
			"none; display: block; position: absolute; top: 100%; left: 20px; width: max-content; z-index: 100; box-shadow: 0 1px 3px rgba(255, 255, 255, 0.12), 0 1px 2px rgba(255, 255, 255, 0.24); padding: 0.2em;",
		color: new vscode.ThemeColor("editor.foreground"),
		backgroundColor: new vscode.ThemeColor("editor.background"),
		border: "1px solid",
		borderColor: new vscode.ThemeColor("editorGutter.addedBackground"),
	},
	textDecoration: "none; position: relative;",
	isWholeLine: false,
	border: "1px solid",
	borderColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerColor: new vscode.ThemeColor("editorGutter.deletedBackground"),
	overviewRulerLane: vscode.OverviewRulerLane.Right,
}

export class GhostDecorations {
	private additionDecorationType: vscode.TextEditorDecorationType
	private deletionDecorationType: vscode.TextEditorDecorationType
	private editionDecorationType: vscode.TextEditorDecorationType

	constructor() {
		this.additionDecorationType = vscode.window.createTextEditorDecorationType(ADDITION_DECORATION_OPTIONS)
		this.deletionDecorationType = vscode.window.createTextEditorDecorationType(DELETION_DECORATION_OPTIONS)
		this.editionDecorationType = vscode.window.createTextEditorDecorationType(EDIT_DECORATION_OPTIONS)
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
		editor.setDecorations(this.editionDecorationType, [])
	}

	// TODO: Split the differences between the contents and show each range individually
	private displayEditOpertionGroup = (editor: vscode.TextEditor, group: GhostSuggestionEditOperation[]) => {
		const line = Math.min(...group.map((x) => x.oldLine))

		const nextLineInfo = editor.document.lineAt(line)
		const range = nextLineInfo.range

		const newContent = group.find((x) => x.type === "+")?.content || ""

		const leadingWhitespace = newContent.match(/^\s*/)?.[0] ?? ""
		const preservedWhitespace = leadingWhitespace.replace(/ /g, "\u00A0")
		const trimmedContent = newContent.trimStart()

		const contentText = preservedWhitespace + trimmedContent

		const renderOptions: vscode.DecorationRenderOptions = { ...EDIT_DECORATION_OPTIONS }
		renderOptions.after = {
			...renderOptions.after,
			contentText: `${contentText}`,
		}

		// Apply the decorations directly
		editor.setDecorations(this.additionDecorationType, [])
		editor.setDecorations(this.deletionDecorationType, [])
		editor.setDecorations(this.editionDecorationType, [
			{
				range,
				renderOptions,
			},
		])
	}

	private displayDeleteOperationGroup = (editor: vscode.TextEditor, group: GhostSuggestionEditOperation[]) => {
		const lines = group.map((x) => x.oldLine)
		const from = Math.min(...lines)
		const to = Math.max(...lines)

		const start = editor.document.lineAt(from).range.start
		const end = editor.document.lineAt(to).range.end
		const range = new vscode.Range(start, end)

		editor.setDecorations(this.additionDecorationType, [])
		editor.setDecorations(this.editionDecorationType, [])
		editor.setDecorations(this.deletionDecorationType, [
			{
				range,
			},
		])
	}

	private getCssInjectionForEdit = (content: string) => {
		let filteredContent = content
		if (filteredContent === "") {
			filteredContent = "[↵]"
		}
		filteredContent = filteredContent.replaceAll(`"`, `\\"`)
		filteredContent = filteredContent.replaceAll(`'`, `\\'`)
		filteredContent = filteredContent.replaceAll(`;`, `\\;`)

		console.log(content)

		return `none; display: block; position: absolute; top: 0px; left: 0px; width: max-content; z-index: 100; white-space: pre-wrap; content: "${filteredContent}"; box-shadow: 0 1px 3px rgba(255, 255, 255, 0.12), 0 1px 2px rgba(255, 255, 255, 0.24); padding: 0.2em;`
	}

	private displayAdditionsOperationGroup = (editor: vscode.TextEditor, group: GhostSuggestionEditOperation[]) => {
		const line = Math.min(...group.map((x) => x.oldLine))

		const nextLineInfo = editor.document.lineAt(line)
		const range = nextLineInfo.range

		let content = group
			.sort((a, b) => a.line - b.line)
			.map((x) => x.content)
			.join(`\\A`)

		const renderOptions: vscode.DecorationRenderOptions = { ...ADDITION_DECORATION_OPTIONS }
		renderOptions.after = {
			...renderOptions.after,
			textDecoration: this.getCssInjectionForEdit(content),
		}

		// Apply the decorations directly
		editor.setDecorations(this.deletionDecorationType, [])
		editor.setDecorations(this.editionDecorationType, [])
		editor.setDecorations(this.additionDecorationType, [
			{
				range,
				renderOptions,
			},
		])
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

		console.log("selectedGroup", selectedGroup)
		console.log("groupType", groupType)

		if (groupType === "/") {
			this.displayEditOpertionGroup(editor, selectedGroup)
		} else if (groupType === "-") {
			this.displayDeleteOperationGroup(editor, selectedGroup)
		} else if (groupType === "+") {
			this.displayAdditionsOperationGroup(editor, selectedGroup)
		} else {
			this.clearAll()
		}
	}
}
