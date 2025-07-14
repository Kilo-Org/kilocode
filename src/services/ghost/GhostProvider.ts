import * as vscode from "vscode"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStrategy } from "./GhostStrategy"
import { GhostModel } from "./GhostModel"
import { GhostWorkspaceEdit } from "./GhostWorkspaceEdit"
import { GhostDecorations } from "./GhostDecorations"
import { GhostSuggestionContext } from "./types"
import { t } from "../../i18n"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"
import { getWorkspacePath } from "../../utils/path"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"
import { GhostCodeLensProvider } from "./GhostCodeLensProvider"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private strategy: GhostStrategy
	private workspaceEdit: GhostWorkspaceEdit
	private suggestions: GhostSuggestionsState = new GhostSuggestionsState()
	private context: vscode.ExtensionContext

	// VSCode Providers
	public codeActionProvider: GhostCodeActionProvider
	public codeLensProvider: GhostCodeLensProvider

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.model = new GhostModel()
		this.strategy = new GhostStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.codeLensProvider = new GhostCodeLensProvider()
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

	public async codeSuggestion() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		const document = editor.document
		const range = editor.selection.isEmpty ? undefined : editor.selection

		await this.provideCodeSuggestions({
			document,
			range,
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

				console.log("Ghost response:", response)

				if (cancelled) {
					return
				}

				progress.report({
					message: t("kilocode:ghost.progress.processing"),
				})
				// First parse the response into edit operations
				this.suggestions = await this.strategy.parseResponse(response)

				if (cancelled) {
					this.suggestions.clear()
					await this.render()
					return
				}
				progress.report({
					message: t("kilocode:ghost.progress.showing"),
				})
				// Generate placeholder for show the suggestions
				await this.workspaceEdit.applySuggestionsPlaceholders(this.suggestions)
				await this.render()
			},
		)
	}

	private async render() {
		await this.updateGlobalContext()
		await this.displaySuggestions()
		await this.displayCodeLens()
	}

	public async displaySuggestions() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		this.decorations.displaySuggestions(this.suggestions)
	}

	private async displayCodeLens() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			this.codeLensProvider.setSuggestionRange(undefined)
			return
		}
		const file = this.suggestions.getFile(editor.document.uri)
		if (!file) {
			this.codeLensProvider.setSuggestionRange(undefined)
			return
		}
		const selectedGroup = file.getSelectedGroupOperations()
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const minLine = selectedGroup?.length ? selectedGroup[0].line + offset : 0
		const maxLine = selectedGroup?.length
			? selectedGroup[selectedGroup.length - 1].line + offset + 1
			: editor.document.lineCount

		this.codeLensProvider.setSuggestionRange(new vscode.Range(minLine, 0, maxLine, 0))
	}

	private async updateGlobalContext() {
		const hasSuggestions = this.suggestions.hasSuggestions()
		await vscode.commands.executeCommand("setContext", "kilocode.ghost.hasSuggestions", hasSuggestions)
	}

	public havePendingSuggestions(): boolean {
		return this.suggestions.hasSuggestions()
	}

	public async cancelSuggestions() {
		if (!this.havePendingSuggestions()) {
			return
		}
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		this.suggestions.clear()
		await this.render()
	}

	public async applySelectedSuggestions() {
		if (!this.havePendingSuggestions()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			console.log(`No suggestions found for document: ${editor.document.uri.toString()}`)
			return
		}
		if (suggestionsFile.getSelectedGroup() === null) {
			console.log("No group selected, returning")
			return
		}
		this.decorations.clearAll()
		await this.workspaceEdit.revertSelectedSuggestionsPlaceholder(this.suggestions)
		await this.workspaceEdit.applySelectedSuggestions(this.suggestions)
		suggestionsFile.deleteSelectedGroup()
		this.suggestions.validateFiles()
		await this.render()
	}

	public async applyAllSuggestions() {
		if (!this.havePendingSuggestions()) {
			return
		}
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		await this.workspaceEdit.applySuggestions(this.suggestions)
		this.suggestions.clear()
		await this.render()
	}

	public async selectNextSuggestion() {
		if (!this.havePendingSuggestions()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			console.log(`No suggestions found for document: ${editor.document.uri.toString()}`)
			return
		}
		suggestionsFile.selectNextGroup()
		await this.render()
	}

	public async selectPreviousSuggestion() {
		if (!this.havePendingSuggestions()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			console.log("No active editor found, returning")
			return
		}
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			console.log(`No suggestions found for document: ${editor.document.uri.toString()}`)
			return
		}
		suggestionsFile.selectPreviousGroup()
		await this.render()
	}
}
