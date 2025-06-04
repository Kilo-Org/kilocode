import * as vscode from "vscode"
import { BaseVisualization } from "../BaseVisualization"
import { AutocompleteVisualizationResponse, RelatedFileEdit } from "../types/VisualizationData"

/**
 * Visualization that shows suggested edits in related files
 */
export class RelatedFileVisualization extends BaseVisualization {
	public readonly id = "related-file"
	public readonly name = "Related File Suggestions"
	public readonly description = "Shows files that might need related changes"

	private statusBarItem: vscode.StatusBarItem
	private currentRelatedFiles: RelatedFileEdit[] = []

	constructor() {
		super()

		// Create status bar item for related files
		this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98)
		this.statusBarItem.text = "$(references) Related Files"
		this.statusBarItem.tooltip = "No related file suggestions"
		this.statusBarItem.command = "kilo-code.showRelatedFiles"
	}

	/**
	 * Called when the visualization is activated
	 */
	protected async onActivate(): Promise<void> {
		// Register command to show related files
		this.disposables.push(
			vscode.commands.registerCommand(
				"kilo-code.showRelatedFiles",
				this.handleShowRelatedFilesCommand.bind(this),
			),
		)

		// Show status bar item
		this.statusBarItem.show()
	}

	/**
	 * Called when the visualization is deactivated
	 */
	protected async onDeactivate(): Promise<void> {
		console.log(`🚀🔮 Deactivating ${this.name}`)
		// Hide status bar item
		this.statusBarItem.hide()
		this.currentRelatedFiles = []
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
		// Nothing to do here - we'll update when we get a response from the model
	}

	/**
	 * Called when a response is received from the model
	 */
	protected async onHandleResponse(response: AutocompleteVisualizationResponse): Promise<void> {
		console.log(`🚀🔮 ${this.name} handling response`)
		if (!response.relatedFiles || response.relatedFiles.length === 0) {
			console.log(`🚀🔮 ${this.name}: No related files in response`)
			this.statusBarItem.text = "$(references) Related Files"
			this.statusBarItem.tooltip = "No related file suggestions"
			this.currentRelatedFiles = []
			return
		}

		console.log(`🚀🔮 ${this.name}: Received ${response.relatedFiles.length} related files`)
		// Update current related files
		this.currentRelatedFiles = response.relatedFiles

		// Update status bar item
		const count = this.currentRelatedFiles.length
		this.statusBarItem.text = `$(references) Related Files (${count})`
		this.statusBarItem.tooltip = `${count} related file(s) might need changes\nClick to view`
	}

	/**
	 * Called when the visualization is being disposed
	 */
	protected onDispose(): void {
		console.log(`🚀🔮 ${this.name}: Disposing`)
		this.statusBarItem.dispose()
	}

	/**
	 * Clear all decorations and reset status
	 */
	public clearDecorations(): void {
		console.log(`🚀🔮 ${this.name}: Clearing all decorations`)
		this.currentRelatedFiles = []
		this.statusBarItem.text = "$(references) Related Files"
		this.statusBarItem.tooltip = "No related file suggestions"
	}

	/**
	 * Handle command to show related files
	 */
	private async handleShowRelatedFilesCommand(): Promise<void> {
		if (this.currentRelatedFiles.length === 0) {
			vscode.window.showInformationMessage("No related file suggestions available")
			return
		}

		// Create quick pick items for each related file
		const items = this.currentRelatedFiles.map((relatedFile) => {
			const editCount = relatedFile.edits.length
			return {
				label: `$(file) ${relatedFile.file}`,
				description: `${editCount} suggested edit${editCount === 1 ? "" : "s"} (${Math.round(relatedFile.priority * 100)}% priority)`,
				detail: relatedFile.reason || "Related file that might need changes",
				relatedFile,
			}
		})

		// Show quick pick
		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: "Select a related file to view suggested edits",
			matchOnDescription: true,
			matchOnDetail: true,
		})

		if (!selected) {
			return
		}

		// Show edits for the selected file
		await this.showEditsForFile(selected.relatedFile)
	}

	/**
	 * Show edits for a specific file
	 */
	private async showEditsForFile(relatedFile: RelatedFileEdit): Promise<void> {
		try {
			// Get the file URI
			const fileUri = vscode.Uri.file(relatedFile.file)

			// Open the document
			const document = await vscode.workspace.openTextDocument(fileUri)

			// Show the document
			await vscode.window.showTextDocument(document)

			// Create quick pick items for each edit
			const items = relatedFile.edits.map((edit) => {
				return {
					label: `Line ${edit.startLine}: ${edit.editType}`,
					description: edit.reason || `${edit.editType} at line ${edit.startLine}`,
					detail:
						edit.suggestedContent.length > 50
							? `${edit.suggestedContent.substring(0, 50)}...`
							: edit.suggestedContent,
					edit,
				}
			})

			// Show quick pick
			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: "Select an edit to apply",
				matchOnDescription: true,
				matchOnDetail: true,
			})

			if (!selected) {
				return
			}

			// Apply the selected edit
			await vscode.commands.executeCommand("kilo-code.applyPredictedEdit", selected.edit)
		} catch (error) {
			console.error("Error showing edits for file:", error)
			vscode.window.showErrorMessage(`Failed to show edits: ${error.message}`)
		}
	}
}
