// kilocode_change - new file

import * as vscode from "vscode"
import { Disposable, ExtensionContext, TextEditorDecorationType, window, workspace } from "vscode"
import { FileSystemService } from "./file-system-service"
import { ValidationService, PendingEdit } from "./validation-service"
import { ParsedEdit } from "./edit-parser"

export interface DiffDecoration {
	decorationType: TextEditorDecorationType
	range: vscode.Range
	edit: PendingEdit
}

/**
 * Diff Provider for visualizing pending AI edits in the editor
 */
export class DiffProvider implements Disposable {
	private decorations: Map<string, DiffDecoration[]> = new Map()
	private decorationTypes!: {
		pending: TextEditorDecorationType
		accepted: TextEditorDecorationType
		rejected: TextEditorDecorationType
		acceptButton: TextEditorDecorationType
		rejectButton: TextEditorDecorationType
	}
	private disposables: Disposable[] = []

	constructor(
		private context: ExtensionContext,
		private fileSystemService: FileSystemService,
		private validationService: ValidationService,
	) {
		this.createDecorationTypes()
		this.setupEventListeners()
	}

	/**
	 * Create decoration types for different edit states
	 */
	private createDecorationTypes(): void {
		// Pending edit decoration (yellow background)
		this.decorationTypes = {
			pending: window.createTextEditorDecorationType({
				backgroundColor: "rgba(255, 255, 0, 0.2)",
				border: "1px solid rgba(255, 255, 0, 0.8)",
				after: {
					contentText: " 🤖 AI Edit",
					color: "#666",
					fontStyle: "italic",
				},
			}),
			accepted: window.createTextEditorDecorationType({
				backgroundColor: "rgba(0, 255, 0, 0.1)",
				border: "1px solid rgba(0, 255, 0, 0.6)",
				after: {
					contentText: " ✅ Accepted",
					color: "#0a0",
					fontStyle: "italic",
				},
			}),
			rejected: window.createTextEditorDecorationType({
				backgroundColor: "rgba(255, 0, 0, 0.1)",
				border: "1px solid rgba(255, 0, 0, 0.6)",
				textDecoration: "line-through",
				after: {
					contentText: " ❌ Rejected",
					color: "#a00",
					fontStyle: "italic",
				},
			}),
			acceptButton: window.createTextEditorDecorationType({
				after: {
					contentText: " ✅ Accept",
					color: "#0a0",
					backgroundColor: "rgba(0, 255, 0, 0.2)",
					border: "1px solid #0a0",
				},
			}),
			rejectButton: window.createTextEditorDecorationType({
				after: {
					contentText: " ❌ Reject",
					color: "#a00",
					backgroundColor: "rgba(255, 0, 0, 0.2)",
					border: "1px solid #a00",
				},
			}),
		}
	}

	/**
	 * Setup event listeners for editor interactions
	 */
	private setupEventListeners(): void {
		// Listen for text editor changes
		this.disposables.push(
			window.onDidChangeActiveTextEditor((editor) => {
				if (editor) {
					this.updateDecorations(editor)
				}
			}),
		)

		// Listen for document changes
		this.disposables.push(
			workspace.onDidChangeTextDocument((event) => {
				const editor = window.activeTextEditor
				if (editor && editor.document === event.document) {
					this.updateDecorations(editor)
				}
			}),
		)

		// Listen for click events on decorations
		this.disposables.push(
			window.onDidChangeTextEditorSelection((event) => {
				this.handleDecorationClick(event)
			}),
		)
	}

	/**
	 * Show pending edits in the editor
	 */
	showPendingEdits(filePath: string, edits: ParsedEdit[]): void {
		const editor = window.activeTextEditor
		if (!editor || editor.document.uri.fsPath !== filePath) {
			return
		}

		const pendingEdits: PendingEdit[] = edits.map((edit, index) => ({
			id: `edit_${Date.now()}_${index}`,
			edit,
			originalContent: "", // Will be populated when applying
			newContent: "", // Will be populated when applying
			diagnostics: [],
			status: "pending" as const,
			timestamp: Date.now(),
		}))

		// Store pending edits
		this.validationService.storePendingEdits(filePath, pendingEdits)

		// Update decorations
		this.updateDecorations(editor)
	}

	/**
	 * Update decorations in the editor
	 */
	private updateDecorations(editor: vscode.TextEditor): void {
		const filePath = editor.document.uri.fsPath
		const pendingEdits = this.validationService.getPendingEdits(filePath)

		// Clear existing decorations
		this.clearDecorations(editor)

		// Group edits by status
		const pendingEditsList = pendingEdits.filter((e) => e.status === "pending")
		const acceptedEditsList = pendingEdits.filter((e) => e.status === "accepted")
		const rejectedEditsList = pendingEdits.filter((e) => e.status === "rejected")

		// Apply decorations
		this.applyEditDecorations(editor, pendingEditsList, this.decorationTypes.pending)
		this.applyEditDecorations(editor, acceptedEditsList, this.decorationTypes.accepted)
		this.applyEditDecorations(editor, rejectedEditsList, this.decorationTypes.rejected)

		// Add action buttons for pending edits
		this.addActionButtons(editor, pendingEditsList)
	}

	/**
	 * Apply edit decorations
	 */
	private applyEditDecorations(
		editor: vscode.TextEditor,
		edits: PendingEdit[],
		decorationType: TextEditorDecorationType,
	): void {
		const decorations: vscode.DecorationOptions[] = []

		for (const pendingEdit of edits) {
			const ranges = this.getEditRanges(editor.document, pendingEdit.edit)

			for (const range of ranges) {
				decorations.push({
					range,
					hoverMessage: new vscode.MarkdownString(
						`**AI Edit** (${pendingEdit.edit.type})\n\n` +
							`Status: ${pendingEdit.status}\n` +
							`ID: ${pendingEdit.id}`,
					),
				})
			}
		}

		editor.setDecorations(decorationType, decorations)
	}

	/**
	 * Add action buttons for pending edits
	 */
	private addActionButtons(editor: vscode.TextEditor, pendingEdits: PendingEdit[]): void {
		const acceptDecorations: vscode.DecorationOptions[] = []
		const rejectDecorations: vscode.DecorationOptions[] = []

		for (const pendingEdit of pendingEdits) {
			const ranges = this.getEditRanges(editor.document, pendingEdit.edit)

			for (const range of ranges) {
				// Add accept button at the end of the edit
				acceptDecorations.push({
					range: new vscode.Range(range.end, range.end),
					hoverMessage: new vscode.MarkdownString("Accept this AI edit"),
				})

				// Add reject button after accept button
				rejectDecorations.push({
					range: new vscode.Range(range.end, range.end),
					hoverMessage: new vscode.MarkdownString("Reject this AI edit"),
				})
			}
		}

		editor.setDecorations(this.decorationTypes.acceptButton, acceptDecorations)
		editor.setDecorations(this.decorationTypes.rejectButton, rejectDecorations)
	}

	/**
	 * Get ranges for an edit
	 */
	private getEditRanges(document: vscode.TextDocument, edit: ParsedEdit): vscode.Range[] {
		const ranges: vscode.Range[] = []

		switch (edit.type) {
			case "search_replace":
				if (edit.search) {
					const content = document.getText()
					const searchIndex = content.indexOf(edit.search)
					if (searchIndex !== -1) {
						const startPos = document.positionAt(searchIndex)
						const endPos = document.positionAt(searchIndex + edit.search.length)
						ranges.push(new vscode.Range(startPos, endPos))
					}
				}
				break

			case "insert":
				if (edit.anchor) {
					const content = document.getText()
					const anchorIndex = content.indexOf(edit.anchor)
					if (anchorIndex !== -1) {
						const anchorPos = document.positionAt(anchorIndex)
						if (edit.position === "before") {
							ranges.push(new vscode.Range(anchorPos, anchorPos))
						} else {
							const endAnchorPos = document.positionAt(anchorIndex + edit.anchor.length)
							ranges.push(new vscode.Range(endAnchorPos, endAnchorPos))
						}
					}
				}
				break

			case "delete":
				if (edit.search) {
					const content = document.getText()
					const searchIndex = content.indexOf(edit.search)
					if (searchIndex !== -1) {
						const startPos = document.positionAt(searchIndex)
						const endPos = document.positionAt(searchIndex + edit.search.length)
						ranges.push(new vscode.Range(startPos, endPos))
					}
				}
				break
		}

		return ranges
	}

	/**
	 * Handle decoration click events
	 */
	private handleDecorationClick(event: vscode.TextEditorSelectionChangeEvent): void {
		const editor = event.textEditor
		const selection = event.selections[0]

		if (!selection || selection.isEmpty) {
			return
		}

		const filePath = editor.document.uri.fsPath
		const pendingEdits = this.validationService.getPendingEdits(filePath)

		// Check if click is on an action button
		for (const pendingEdit of pendingEdits.filter((e) => e.status === "pending")) {
			const ranges = this.getEditRanges(editor.document, pendingEdit.edit)

			for (const range of ranges) {
				// Check if click is near the end of the range (where buttons are)
				const buttonRange = new vscode.Range(range.end.translate(0, -1), range.end.translate(0, 10))

				if (buttonRange.contains(selection)) {
					// Determine which button was clicked based on position
					const clickPosition = selection.start
					const relativePosition = clickPosition.character - range.end.character

					if (relativePosition >= 0 && relativePosition <= 5) {
						// Accept button clicked
						this.acceptEdit(filePath, pendingEdit.id)
					} else if (relativePosition >= 6 && relativePosition <= 11) {
						// Reject button clicked
						this.rejectEdit(filePath, pendingEdit.id)
					}
					break
				}
			}
		}
	}

	/**
	 * Accept an edit
	 */
	async acceptEdit(filePath: string, editId: string): Promise<void> {
		try {
			const pendingEdits = this.validationService.getPendingEdits(filePath)
			const edit = pendingEdits.find((e) => e.id === editId)

			if (!edit) {
				vscode.window.showErrorMessage(`Edit not found: ${editId}`)
				return
			}

			// Apply the edit
			await this.fileSystemService.applyEdits([edit.edit])

			// Update status
			this.validationService.updateEditStatus(filePath, editId, "accepted")

			// Refresh decorations
			const editor = window.activeTextEditor
			if (editor && editor.document.uri.fsPath === filePath) {
				this.updateDecorations(editor)
			}

			vscode.window.showInformationMessage("Edit accepted and applied successfully")
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to accept edit: ${error}`)
		}
	}

	/**
	 * Reject an edit
	 */
	rejectEdit(filePath: string, editId: string): void {
		try {
			// Update status
			this.validationService.updateEditStatus(filePath, editId, "rejected")

			// Refresh decorations
			const editor = window.activeTextEditor
			if (editor && editor.document.uri.fsPath === filePath) {
				this.updateDecorations(editor)
			}

			vscode.window.showInformationMessage("Edit rejected")
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to reject edit: ${error}`)
		}
	}

	/**
	 * Accept all pending edits
	 */
	async acceptAllEdits(filePath: string): Promise<void> {
		try {
			const pendingEdits = this.validationService.getPendingEdits(filePath)
			const pendingEditsList = pendingEdits.filter((e) => e.status === "pending")

			if (pendingEditsList.length === 0) {
				vscode.window.showInformationMessage("No pending edits to accept")
				return
			}

			// Apply all edits
			await this.fileSystemService.applyEdits(pendingEditsList.map((e) => e.edit))

			// Update status
			for (const edit of pendingEditsList) {
				this.validationService.updateEditStatus(filePath, edit.id, "accepted")
			}

			// Refresh decorations
			const editor = window.activeTextEditor
			if (editor && editor.document.uri.fsPath === filePath) {
				this.updateDecorations(editor)
			}

			vscode.window.showInformationMessage(`Accepted ${pendingEditsList.length} edits`)
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to accept all edits: ${error}`)
		}
	}

	/**
	 * Reject all pending edits
	 */
	rejectAllEdits(filePath: string): void {
		try {
			const pendingEdits = this.validationService.getPendingEdits(filePath)
			const pendingEditsList = pendingEdits.filter((e) => e.status === "pending")

			if (pendingEditsList.length === 0) {
				vscode.window.showInformationMessage("No pending edits to reject")
				return
			}

			// Update status
			for (const edit of pendingEditsList) {
				this.validationService.updateEditStatus(filePath, edit.id, "rejected")
			}

			// Refresh decorations
			const editor = window.activeTextEditor
			if (editor && editor.document.uri.fsPath === filePath) {
				this.updateDecorations(editor)
			}

			vscode.window.showInformationMessage(`Rejected ${pendingEditsList.length} edits`)
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to reject all edits: ${error}`)
		}
	}

	/**
	 * Clear all decorations
	 */
	private clearDecorations(editor: vscode.TextEditor): void {
		for (const decorationType of Object.values(this.decorationTypes)) {
			editor.setDecorations(decorationType, [])
		}
	}

	/**
	 * Clear pending edits for a file
	 */
	clearPendingEdits(filePath: string): void {
		this.validationService.clearPendingEdits(filePath)

		const editor = window.activeTextEditor
		if (editor && editor.document.uri.fsPath === filePath) {
			this.clearDecorations(editor)
		}
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		for (const decorationType of Object.values(this.decorationTypes)) {
			decorationType.dispose()
		}

		for (const disposable of this.disposables) {
			disposable.dispose()
		}

		this.decorations.clear()
	}
}
