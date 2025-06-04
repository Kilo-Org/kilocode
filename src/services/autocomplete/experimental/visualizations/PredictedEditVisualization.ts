import * as vscode from "vscode"
import { BaseVisualization } from "../BaseVisualization"
import { AutocompleteVisualizationResponse, PredictedEdit } from "../types/VisualizationData"

/**
 * Visualization that shows suggested edits at specific locations
 */
export class PredictedEditVisualization extends BaseVisualization {
	public readonly id = "predicted-edit"
	public readonly name = "Predicted Edits"
	public readonly description = "Shows suggested edits at specific locations"

	private decorationType: vscode.TextEditorDecorationType
	private currentEdits: PredictedEdit[] = []
	private editDecorations: Map<string, vscode.DecorationOptions[]> = new Map()
	private fileEditors: Map<string, vscode.TextEditor> = new Map()

	constructor() {
		super()

		// Create decoration type for predicted edits
		this.decorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
			border: "1px solid",
			borderColor: new vscode.ThemeColor("editorInfo.foreground"),
			after: {
				margin: "0 0 0 10px",
				color: new vscode.ThemeColor("editorInfo.foreground"),
				fontWeight: "bold",
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			light: {
				backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
				border: "1px solid",
				borderColor: new vscode.ThemeColor("editorInfo.foreground"),
			},
			dark: {
				backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
				border: "1px solid",
				borderColor: new vscode.ThemeColor("editorInfo.foreground"),
			},
		})
	}

	/**
	 * Called when the visualization is activated
	 */
	protected async onActivate(): Promise<void> {
		console.log(`🚀🔮 Activating ${this.name}`)
		// Register command to apply a predicted edit
		this.disposables.push(
			vscode.commands.registerCommand("kilo-code.applyPredictedEdit", this.handleApplyEditCommand.bind(this)),
		)

		// Show any existing edits
		this.updateDecorations()
	}

	/**
	 * Called when the visualization is deactivated
	 */
	protected async onDeactivate(): Promise<void> {
		console.log(`🚀🔮 Deactivating ${this.name}`)
		// Clear all decorations
		this.clearDecorations()
		this.currentEdits = []
		// Clear tracked editors
		this.fileEditors.clear()
	}

	/**
	 * Called when the visualization should update based on the current document and position
	 */
	protected async onUpdate(
		document: vscode.TextDocument,
		position: vscode.Position,
		editor?: vscode.TextEditor,
	): Promise<void> {
		console.log(`🚀🔮 ${this.name}: Update called at position ${position.line}:${position.character}`)

		// Store the provided editor or the current active editor for this file
		const editorToStore = editor || vscode.window.activeTextEditor
		if (editorToStore && editorToStore.document.uri.fsPath === document.uri.fsPath) {
			console.log(`🚀🔮 ${this.name}: Tracking editor for ${document.uri.fsPath}`)
			this.fileEditors.set(document.uri.fsPath, editorToStore)
		}

		// Nothing else to do here - we'll update when we get a response from the model
	}

	/**
	 * Called when a response is received from the model
	 */
	protected async onHandleResponse(response: AutocompleteVisualizationResponse): Promise<void> {
		console.log(`🚀🔮 ${this.name} handling response`)
		if (!response.predictedEdits || response.predictedEdits.length === 0) {
			console.log(`🚀🔮 ${this.name}: No predicted edits in response, clearing`)
			this.clearDecorations()
			this.currentEdits = []
			return
		}

		console.log(`🚀🔮 ${this.name}: Received ${response.predictedEdits.length} predicted edits`)
		// Update current edits
		this.currentEdits = response.predictedEdits

		// Update decorations
		this.updateDecorations()
	}

	/**
	 * Called when the visualization is being disposed
	 */
	protected onDispose(): void {
		console.log(`🚀🔮 ${this.name}: Disposing`)
		this.clearDecorations()
		this.decorationType.dispose()
		// Clear tracked editors
		this.fileEditors.clear()
	}

	/**
	 * Handle command to apply a predicted edit
	 */
	private async handleApplyEditCommand(edit: PredictedEdit): Promise<void> {
		console.log(`🚀🔮 ${this.name}: Applying edit to ${edit.file} lines ${edit.startLine}-${edit.endLine}`)
		try {
			// Get the file URI
			const fileUri = vscode.Uri.file(edit.file)

			// Open the document
			const document = await vscode.workspace.openTextDocument(fileUri)

			// Show the document
			const editor = await vscode.window.showTextDocument(document)

			// Create range for the edit (convert from 1-based to 0-based)
			const startLine = edit.startLine
			const endLine = edit.endLine
			const startColumn = edit.startColumn ? edit.startColumn - 1 : 0
			const endColumn = edit.endColumn ? edit.endColumn - 1 : document.lineAt(endLine).text.length

			const startPos = new vscode.Position(startLine, startColumn)
			const endPos = new vscode.Position(endLine, endColumn)
			const range = new vscode.Range(startPos, endPos)

			console.log(
				`🚀🔮 ${this.name}: Edit type: ${edit.editType}, range: ${startLine}:${startColumn}-${endLine}:${endColumn}`,
			)

			// Apply the edit
			await editor.edit((editBuilder) => {
				if (edit.editType === "delete") {
					console.log(`🚀🔮 ${this.name}: Deleting content`)
					editBuilder.delete(range)
				} else {
					console.log(`🚀🔮 ${this.name}: Replacing with new content (${edit.suggestedContent.length} chars)`)
					editBuilder.replace(range, edit.suggestedContent)
				}
			})

			// Move cursor to the end of the edit
			const newPosition = new vscode.Position(
				edit.editType === "delete" ? startLine : startLine + edit.suggestedContent.split("\n").length - 1,
				edit.editType === "delete" ? startColumn : (edit.suggestedContent.split("\n").pop() || "").length,
			)

			editor.selection = new vscode.Selection(newPosition, newPosition)

			// Reveal the position
			editor.revealRange(
				new vscode.Range(newPosition, newPosition),
				vscode.TextEditorRevealType.InCenterIfOutsideViewport,
			)

			console.log(`🚀🔮 ${this.name}: Edit successfully applied`)

			// Remove this edit from the current edits
			this.removeAppliedEdit(edit)

			// Show success message
			vscode.window.showInformationMessage(`Applied predicted edit: ${edit.reason || "Edit applied"}`)
		} catch (error) {
			console.error(`🚀🔮 ${this.name}: Error applying edit:`, error)
			vscode.window.showErrorMessage(`Failed to apply edit: ${error.message}`)
		}
	}

	/**
	 * Remove an applied edit from the current edits and update decorations
	 */
	private removeAppliedEdit(appliedEdit: PredictedEdit): void {
		console.log(`🚀🔮 ${this.name}: Removing applied edit from current edits`)

		// Find the index of the edit in the current edits array
		const editIndex = this.currentEdits.findIndex(
			(edit) =>
				edit.file === appliedEdit.file &&
				edit.startLine === appliedEdit.startLine &&
				edit.endLine === appliedEdit.endLine,
		)

		if (editIndex !== -1) {
			// Remove the edit from the array
			this.currentEdits.splice(editIndex, 1)
			console.log(
				`🚀🔮 ${this.name}: Removed edit at index ${editIndex}, ${this.currentEdits.length} edits remaining`,
			)

			// Update decorations to reflect the change
			this.updateDecorations()
		}
	}

	/**
	 * Update decorations for all editors
	 */
	private updateDecorations(): void {
		console.log(`🚀🔮 ${this.name}: Updating decorations`)
		// Clear existing decorations
		this.clearDecorations()

		// Group edits by file
		const editsByFile = new Map<string, PredictedEdit[]>()

		for (const edit of this.currentEdits) {
			const edits = editsByFile.get(edit.file) || []
			edits.push(edit)
			editsByFile.set(edit.file, edits)
		}

		console.log(`🚀🔮 ${this.name}: Grouped edits for ${editsByFile.size} files`)

		// Apply decorations for each file
		for (const [file, edits] of editsByFile.entries()) {
			console.log(`🚀🔮 ${this.name}: Applying ${edits.length} decorations for ${file}`)
			this.applyDecorationsForFile(file, edits)
		}
	}

	/**
	 * Apply decorations for a specific file
	 */
	private applyDecorationsForFile(file: string, edits: PredictedEdit[]): void {
		// Try to get the tracked editor for this file first
		let editor = this.fileEditors.get(file)

		// If no tracked editor, fall back to visible editors
		if (!editor) {
			editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === file)
		}

		if (!editor) {
			console.log(`🚀🔮 ${this.name}: No editor found for ${file}, skipping decorations`)

			// Try to open the file if we can't find an editor
			try {
				const fileUri = vscode.Uri.file(file)
				vscode.workspace.openTextDocument(fileUri).then((document) => {
					vscode.window.showTextDocument(document).then((newEditor) => {
						console.log(`🚀🔮 ${this.name}: Opened editor for ${file}, applying decorations`)
						this.fileEditors.set(file, newEditor)
						this.applyDecorationsToEditor(newEditor, edits)
					})
				})
			} catch (error) {
				console.error(`🚀🔮 ${this.name}: Error opening file ${file}:`, error)
			}

			return
		}

		this.applyDecorationsToEditor(editor, edits)
	}

	/**
	 * Apply decorations to a specific editor
	 */
	private applyDecorationsToEditor(editor: vscode.TextEditor, edits: PredictedEdit[]): void {
		console.log(
			`🚀🔮 ${this.name}: Found editor for ${editor.document.uri.fsPath}, creating ${edits.length} decorations`,
		)
		// Create decoration options
		const decorations: vscode.DecorationOptions[] = edits.map((edit) => {
			const startLine = edit.startLine
			const endLine = edit.endLine
			const startColumn = edit.startColumn ? edit.startColumn - 1 : 0
			const endColumn = edit.endColumn ? edit.endColumn - 1 : editor.document.lineAt(endLine).text.length

			// Create range for the decoration
			const range = new vscode.Range(
				new vscode.Position(startLine, startColumn),
				new vscode.Position(endLine, endColumn),
			)

			// Create hover message
			const hoverMessage = new vscode.MarkdownString()
			hoverMessage.appendMarkdown(`**Predicted edit** (${Math.round(edit.confidence * 100)}% confidence)\n\n`)

			// Show line numbers (adjusted to match VS Code's display)
			hoverMessage.appendMarkdown(`Lines: ${edit.startLine} to ${edit.endLine}\n\n`)

			if (edit.reason) {
				hoverMessage.appendMarkdown(`Reason: ${edit.reason}\n\n`)
			}

			// Show edit type
			hoverMessage.appendMarkdown(`Type: ${edit.editType}\n\n`)

			// Show suggested content
			if (edit.suggestedContent) {
				hoverMessage.appendMarkdown(`Suggested content:\n\`\`\`\n${edit.suggestedContent}\n\`\`\`\n\n`)
			}

			hoverMessage.appendMarkdown(
				`[Apply this edit](command:kilo-code.applyPredictedEdit?${encodeURIComponent(JSON.stringify(edit))})`,
			)
			hoverMessage.isTrusted = true

			// Create decoration with preview of the edit
			const renderOptions: vscode.DecorationRenderOptions = {
				after: {},
			}

			// For insert or replace, show a preview of the content
			if (edit.editType !== "delete" && edit.suggestedContent) {
				// Get the first line of the suggested content for preview
				const previewText = edit.suggestedContent.split("\n")[0]
				// Truncate if too long
				const truncatedPreview = previewText.length > 30 ? previewText.substring(0, 30) + "..." : previewText

				renderOptions.after = {
					contentText: `✨ ${truncatedPreview}`,
					color: new vscode.ThemeColor("editorInfo.foreground"),
					fontStyle: "italic",
					fontWeight: "bold",
				}
			} else {
				// For delete operations, just show an icon
				renderOptions.after = {
					contentText: "🗑️ Delete",
					fontStyle: "normal",
					fontWeight: "bold",
					color: new vscode.ThemeColor("editorInfo.foreground"),
				}
			}

			return {
				range,
				hoverMessage,
				renderOptions,
			}
		})

		// Apply decorations
		editor.setDecorations(this.decorationType, decorations)

		// Store decorations for this file
		this.editDecorations.set(editor.document.uri.fsPath, decorations)
	}

	/**
	 * Clear all decorations
	 */
	public clearDecorations(): void {
		console.log(`🚀🔮 ${this.name}: Clearing all decorations`)
		// Clear decorations in all editors (both visible and tracked)
		for (const editor of vscode.window.visibleTextEditors) {
			editor.setDecorations(this.decorationType, [])
		}

		// Also clear decorations in tracked editors that might not be visible
		for (const editor of this.fileEditors.values()) {
			editor.setDecorations(this.decorationType, [])
		}

		// Clear stored decorations
		this.editDecorations.clear()
	}
}
