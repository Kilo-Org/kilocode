import * as vscode from "vscode"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStrategy } from "./GhostStrategy"
import { GhostModel } from "./GhostModel"
import { GhostWorkspaceEdit } from "./GhostWorkspaceEdit"
import { GhostDecorations } from "./GhostDecorations"
import { GhostSuggestionContext, GhostSuggestionEditOperation } from "./types"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private strategy: GhostStrategy
	private workspaceEdit: GhostWorkspaceEdit
	private pendingSuggestions: GhostSuggestionEditOperation[] = []

	private constructor() {
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.model = new GhostModel()
		this.strategy = new GhostStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
	}

	public static getInstance(): GhostProvider {
		if (!GhostProvider.instance) {
			GhostProvider.instance = new GhostProvider()
		}
		return GhostProvider.instance
	}

	public getDocumentStore() {
		return this.documentStore
	}

	public async promptCodeSuggestion() {
		const userInput = await vscode.window.showInputBox({
			prompt: "Kilo Code - Code Suggestion",
			placeHolder: "e.g., 'refactor this function to be more efficient'",
		})

		if (!userInput) {
			return
		}

		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		const document = editor.document
		const range = editor.selection.isEmpty ? undefined : editor.selection

		await this.provideCodeSuggestions({
			document,
			range,
			userInput,
		})
	}

	public async provideCodeActionQuickFix(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
	): Promise<void> {
		// Store the document in the document store
		this.getDocumentStore().storeDocument(document)
		await this.provideCodeSuggestions({
			document,
			range,
		})
	}

	private async provideCodeSuggestions(context: GhostSuggestionContext): Promise<void> {
		let cancelled = false

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Kilo Code",
				cancellable: true,
			},
			async (progress, progressToken) => {
				progressToken.onCancellationRequested(() => {
					cancelled = true
				})

				progress.report({
					message: "Analyzing your code...",
				})
				const systemPrompt = this.strategy.getSystemPrompt()
				const userPrompt = this.strategy.getSuggestionPrompt(context)

				if (cancelled) {
					return
				}
				progress.report({
					message: "Generating code suggestions...",
				})

				const response = await this.model.generateResponse(systemPrompt, userPrompt)

				if (cancelled) {
					return
				}

				progress.report({
					message: "Processing code suggestions...",
				})
				// First parse the response into edit operations
				const operations = await this.strategy.parseResponse(response)
				this.pendingSuggestions = operations

				console.log("operations", operations)

				if (cancelled) {
					this.pendingSuggestions = []
					return
				}

				progress.report({
					message: "Showing code suggestions...",
				})
				// Generate placeholder for show the suggestions
				await this.workspaceEdit.applyOperationsPlaceholders(operations)
				// Display the suggestions in the active editor
				await this.displaySuggestions()
			},
		)
	}

	public async displaySuggestions() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}

		const operations = this.pendingSuggestions
		this.decorations.displaySuggestions(operations)
	}

	public isCancelSuggestionsEnabled(): boolean {
		return this.pendingSuggestions.length > 0
	}

	public async cancelSuggestions() {
		const pendingSuggestions = [...this.pendingSuggestions]
		if (pendingSuggestions.length === 0) {
			return
		}
		// Clear the decorations in the active editor
		this.decorations.clearAll()

		await this.workspaceEdit.revertOperationsPlaceHolder(pendingSuggestions)

		// Clear the pending suggestions
		this.pendingSuggestions = []
	}

	public isApplyAllSuggestionsEnabled(): boolean {
		return this.pendingSuggestions.length > 0
	}

	public async applyAllSuggestions() {
		const pendingSuggestions = [...this.pendingSuggestions]
		if (pendingSuggestions.length === 0) {
			return
		}
		await this.cancelSuggestions()
		await this.workspaceEdit.applyOperations(pendingSuggestions)
	}
}
