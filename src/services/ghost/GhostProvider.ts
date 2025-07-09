import * as vscode from "vscode"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStrategy } from "./GhostStrategy"
import { GhostModel } from "./GhostModel"
import { GhostWorkspaceEdit } from "./GhostWorkspaceEdit"
import { GhostDecorations } from "./GhostDecorations"
import { GhostSuggestionEditOperation } from "./types"

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

	public static getDocumentStore() {
		return this.getInstance().documentStore
	}

	public static async provideCodeSuggestions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
	): Promise<void> {
		// Store the document in the document store
		this.getDocumentStore().storeDocument(document)

		const systemPrompt = this.getInstance().strategy.getSystemPrompt()
		const userPrompt = this.getInstance().strategy.getSuggestionPrompt(document, range)

		const response = await this.getInstance().model.generateResponse(systemPrompt, userPrompt)

		console.log("LLM Response", response)

		// First parse the response into edit operations
		const operations = this.getInstance().strategy.parseResponse(response)

		this.getInstance().pendingSuggestions = operations

		// Generate placeholder for show the suggestions
		await this.getInstance().workspaceEdit.applyOperationsPlaceholders(operations)

		// Display the suggestions in the active editor
		await this.displaySuggestions()
	}

	public static async displaySuggestions() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}

		const operations = this.getInstance().pendingSuggestions
		this.getInstance().decorations.displaySuggestions(operations)
	}

	public static isCancelSuggestionsEnabled(): boolean {
		return this.getInstance().pendingSuggestions.length > 0
	}

	public static async cancelSuggestions() {
		const pendingSuggestions = [...this.getInstance().pendingSuggestions]
		if (pendingSuggestions.length === 0) {
			return
		}
		// Clear the decorations in the active editor
		this.getInstance().decorations.clearAll()

		await this.getInstance().workspaceEdit.revertOperationsPlaceHolder(pendingSuggestions)

		// Clear the pending suggestions
		this.getInstance().pendingSuggestions = []
	}

	public static isApplyAllSuggestionsEnabled(): boolean {
		return this.getInstance().pendingSuggestions.length > 0
	}

	public static async applyAllSuggestions() {
		const pendingSuggestions = [...this.getInstance().pendingSuggestions]
		if (pendingSuggestions.length === 0) {
			return
		}
		await this.cancelSuggestions()
		await this.getInstance().workspaceEdit.applyOperations(pendingSuggestions)
	}
}
