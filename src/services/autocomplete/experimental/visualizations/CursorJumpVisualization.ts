import * as vscode from "vscode"
import { BaseVisualization } from "../BaseVisualization"
import { AutocompleteVisualizationResponse, CursorJumpLocation } from "../types/VisualizationData"

/**
 * Visualization that shows potential positions where the cursor might want to jump next
 */
export class CursorJumpVisualization extends BaseVisualization {
	public readonly id = "cursor-jump"
	public readonly name = "Cursor Jump Predictions"
	public readonly description = "Shows potential positions where the cursor might want to jump next"

	private decorationType: vscode.TextEditorDecorationType
	private currentJumps: CursorJumpLocation[] = []
	private jumpDecorations: Map<string, vscode.DecorationOptions[]> = new Map()
	private fileEditors: Map<string, vscode.TextEditor> = new Map()

	constructor() {
		super()

		// Create decoration type for cursor jumps
		this.decorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
			border: "1px dashed",
			borderColor: new vscode.ThemeColor("editor.findMatchHighlightBorder"),
			after: {
				margin: "0 0 0 10px",
				color: new vscode.ThemeColor("editorGhostText.foreground"),
			},
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
		})
	}

	/**
	 * Called when the visualization is activated
	 */
	protected async onActivate(): Promise<void> {
		console.log(`🚀🔮 Activating ${this.name}`)
		// Register command to jump to a predicted location
		this.disposables.push(
			vscode.commands.registerCommand("kilo-code.jumpToPredictedLocation", this.handleJumpCommand.bind(this)),
		)

		// Show any existing jumps
		this.updateDecorations()
	}

	/**
	 * Called when the visualization is deactivated
	 */
	protected async onDeactivate(): Promise<void> {
		console.log(`🚀🔮 Deactivating ${this.name}`)
		// Clear all decorations
		this.clearDecorations()
		this.currentJumps = []
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
		if (!response.cursorJumps || response.cursorJumps.length === 0) {
			console.log(`🚀🔮 ${this.name}: No cursor jumps in response, clearing`)
			this.clearDecorations()
			this.currentJumps = []
			return
		}

		console.log(`🚀🔮 ${this.name}: Received ${response.cursorJumps.length} cursor jumps`)
		// Update current jumps
		this.currentJumps = response.cursorJumps

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
	 * Handle command to jump to a predicted location
	 */
	private async handleJumpCommand(jump: CursorJumpLocation): Promise<void> {
		console.log(`🚀🔮 ${this.name}: Jumping to location ${jump.file}:${jump.line}:${jump.column}`)
		try {
			// Get the file URI
			const fileUri = vscode.Uri.file(jump.file)

			// Open the document
			const document = await vscode.workspace.openTextDocument(fileUri)

			// Show the document
			const editor = await vscode.window.showTextDocument(document)

			// Create position (convert from 1-based to 0-based)
			const position = new vscode.Position(jump.line - 1, jump.column - 1)

			// Move cursor to position
			editor.selection = new vscode.Selection(position, position)

			// Reveal the position
			editor.revealRange(
				new vscode.Range(position, position),
				vscode.TextEditorRevealType.InCenterIfOutsideViewport,
			)
			console.log(`🚀🔮 ${this.name}: Successfully jumped to location`)
		} catch (error) {
			console.error(`🚀🔮 ${this.name}: Error jumping to location:`, error)
			vscode.window.showErrorMessage(`Failed to jump to location: ${error.message}`)
		}
	}

	/**
	 * Update decorations for all editors
	 */
	private updateDecorations(): void {
		console.log(`🚀🔮 ${this.name}: Updating decorations`)
		// Clear existing decorations
		this.clearDecorations()

		// Group jumps by file
		const jumpsByFile = new Map<string, CursorJumpLocation[]>()

		for (const jump of this.currentJumps) {
			const jumps = jumpsByFile.get(jump.file) || []
			jumps.push(jump)
			jumpsByFile.set(jump.file, jumps)
		}

		console.log(`🚀🔮 ${this.name}: Grouped jumps for ${jumpsByFile.size} files`)

		// Apply decorations for each file
		for (const [file, jumps] of jumpsByFile.entries()) {
			console.log(`🚀🔮 ${this.name}: Applying ${jumps.length} decorations for ${file}`)
			this.applyDecorationsForFile(file, jumps)
		}
	}

	/**
	 * Apply decorations for a specific file
	 */
	private applyDecorationsForFile(file: string, jumps: CursorJumpLocation[]): void {
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
						this.applyDecorationsToEditor(newEditor, jumps)
					})
				})
			} catch (error) {
				console.error(`🚀🔮 ${this.name}: Error opening file ${file}:`, error)
			}

			return
		}

		this.applyDecorationsToEditor(editor, jumps)
	}

	/**
	 * Apply decorations to a specific editor
	 */
	private applyDecorationsToEditor(editor: vscode.TextEditor, jumps: CursorJumpLocation[]): void {
		console.log(
			`🚀🔮 ${this.name}: Found editor for ${editor.document.uri.fsPath}, creating ${jumps.length} decorations`,
		)

		// Create decoration options
		const decorations: vscode.DecorationOptions[] = jumps.map((jump) => {
			// Convert from 1-based to 0-based
			const line = jump.line - 1
			const column = jump.column - 1

			// Create range for the decoration
			const position = new vscode.Position(line, column)
			const range = new vscode.Range(position, position)

			// Create hover message
			const hoverMessage = new vscode.MarkdownString()
			hoverMessage.appendMarkdown(
				`**Predicted cursor jump** (${Math.round(jump.confidence * 100)}% confidence)\n\n`,
			)

			// Show line number (adjusted to match VS Code's display)
			hoverMessage.appendMarkdown(`Line: ${jump.line}\n\n`)

			if (jump.reason) {
				hoverMessage.appendMarkdown(`Reason: ${jump.reason}\n\n`)
			}

			if (jump.preview) {
				hoverMessage.appendMarkdown(`Preview: \`${jump.preview}\`\n\n`)
			}

			hoverMessage.appendMarkdown(
				`[Jump to this location](command:kilo-code.jumpToPredictedLocation?${encodeURIComponent(JSON.stringify(jump))})`,
			)
			hoverMessage.isTrusted = true

			// Create decoration
			return {
				range,
				hoverMessage,
				renderOptions: {
					after: {
						contentText: "⮕",
						fontStyle: "normal",
					},
				},
			}
		})

		// Apply decorations
		editor.setDecorations(this.decorationType, decorations)

		// Store decorations for this file
		this.jumpDecorations.set(editor.document.uri.fsPath, decorations)
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
		this.jumpDecorations.clear()
	}
}
