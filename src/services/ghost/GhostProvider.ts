import * as vscode from "vscode"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStrategy } from "./GhostStrategy"
import { GhostModel } from "./GhostModel"
import { GhostWorkspaceEdit } from "./GhostWorkspaceEdit"
import { GhostDecorations } from "./GhostDecorations"
import { GhostSuggestionContext, GhostSuggestionEditOperation } from "./types"
import { t } from "../../i18n"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"
import { getWorkspacePath } from "../../utils/path"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private strategy: GhostStrategy
	private workspaceEdit: GhostWorkspaceEdit
	private pendingSuggestions: GhostSuggestionEditOperation[] = []
	private context: vscode.ExtensionContext

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.model = new GhostModel()
		this.strategy = new GhostStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
	}

	public static getInstance(context?: vscode.ExtensionContext): GhostProvider {
		if (!GhostProvider.instance) {
			if (!context) {
				throw new Error("ExtensionContext is required for first initialization of GhostProvider")
			}
			GhostProvider.instance = new GhostProvider(context)
		}
		return GhostProvider.instance
	}

	public getDocumentStore() {
		return this.documentStore
	}

	public async promptCodeSuggestion() {
		const userInput = await vscode.window.showInputBox({
			prompt: t("kilocode:ghost.input.title"),
			placeHolder: t("kilocode:ghost.input.placeholder"),
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
				title: t("kilocode:ghost.progress.title"),
				cancellable: true,
			},
			async (progress, progressToken) => {
				progressToken.onCancellationRequested(() => {
					cancelled = true
				})

				progress.report({
					message: t("kilocode:ghost.progress.analyzing"),
				})

				// Load custom instructions
				const workspacePath = getWorkspacePath()
				const customInstructions = await addCustomInstructions("", "", workspacePath, "ghost")

				const systemPrompt = this.strategy.getSystemPrompt(customInstructions)
				const userPrompt = this.strategy.getSuggestionPrompt(context)

				if (cancelled) {
					return
				}
				progress.report({
					message: t("kilocode:ghost.progress.generating"),
				})

				const response = await this.model.generateResponse(systemPrompt, userPrompt)

				if (cancelled) {
					return
				}

				progress.report({
					message: t("kilocode:ghost.progress.processing"),
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
					message: t("kilocode:ghost.progress.showing"),
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
