import * as vscode from "vscode"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStrategy } from "./GhostStrategy"
import { GhostModel } from "./GhostModel"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private documentStore: GhostDocumentStore
	private strategy: GhostStrategy
	private model: GhostModel

	private constructor() {
		this.documentStore = new GhostDocumentStore()
		this.strategy = new GhostStrategy()
		this.model = new GhostModel()
		// VSCode Providers
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

	public static async provideCodeSuggestions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection) {
		// Store the document in the document store
		this.getDocumentStore().storeDocument(document)

		const systemPrompt = this.getInstance().strategy.getSystemPrompt()
		const userPrompt = this.getInstance().strategy.getSuggestionPrompt(document, range)

		const response = await this.getInstance().model.generateResponse(systemPrompt, userPrompt)

		console.log("System Prompt:", systemPrompt)
		console.log("User Prompt:", userPrompt)
		console.log("Response from Ghost:", response)

		const workspaceEdit = this.getInstance().strategy.parseResponse(response)

		return workspaceEdit
	}
}
