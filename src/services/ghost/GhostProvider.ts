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
import { GhostServiceSettings } from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private strategy: GhostStrategy
	private workspaceEdit: GhostWorkspaceEdit
	private suggestions: GhostSuggestionsState = new GhostSuggestionsState()
	private context: vscode.ExtensionContext
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null

	// VSCode Providers
	public codeActionProvider: GhostCodeActionProvider
	public codeLensProvider: GhostCodeLensProvider

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.strategy = new GhostStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new GhostModel()

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.codeLensProvider = new GhostCodeLensProvider()

		void this.reload()
	}

	private loadSettings() {
		return ContextProxy.instance?.getValues?.()?.ghostServiceSettings
	}

	public async reload() {
		this.settings = this.loadSettings()
		await this.model.reload(this.settings, this.providerSettingsManager)
		await this.updateGlobalContext()
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

		await this.provideCodeSuggestions({ document, range, userInput })
	}

	public async codeSuggestion() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		const document = editor.document
		const range = editor.selection.isEmpty ? undefined : editor.selection

		await this.provideCodeSuggestions({ document, range })
	}

	public async provideCodeActionQuickFix(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
	): Promise<void> {
		// Store the document in the document store
		this.getDocumentStore().storeDocument(document)
		await this.provideCodeSuggestions({ document, range })
	}

	private async enhanceContext(context: GhostSuggestionContext): Promise<GhostSuggestionContext> {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return context
		}
		// Add open files to the context
		const openFiles = vscode.workspace.textDocuments.filter((doc) => doc.uri.scheme === "file")
		return { ...context, openFiles }
	}

	private async provideCodeSuggestions(context: GhostSuggestionContext): Promise<void> {
		// Cancel any ongoing suggestions
		await this.cancelSuggestions()

		let cancelled = false
		const enhancedContext = await this.enhanceContext(context)

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

				progress.report({ message: t("kilocode:ghost.progress.analyzing") })

				// Load custom instructions
				const workspacePath = getWorkspacePath()
				const customInstructions = await addCustomInstructions("", "", workspacePath, "ghost")

				const systemPrompt = this.strategy.getSystemPrompt(customInstructions)
				const userPrompt = this.strategy.getSuggestionPrompt(enhancedContext)
				if (cancelled) {
					return
				}

				progress.report({ message: t("kilocode:ghost.progress.generating") })
				if (!this.model.loaded) {
					await this.reload()
				}
				const response = await this.model.generateResponse(systemPrompt, userPrompt)
				console.log("Ghost response:", response)
				if (cancelled) {
					return
				}

				// First parse the response into edit operations
				progress.report({ message: t("kilocode:ghost.progress.processing") })
				this.suggestions = await this.strategy.parseResponse(response, enhancedContext)

				if (cancelled) {
					this.suggestions.clear()
					await this.render()
					return
				}
				// Generate placeholder for show the suggestions
				progress.report({ message: t("kilocode:ghost.progress.showing") })
				await this.workspaceEdit.applySuggestionsPlaceholders(this.suggestions)
				await this.render()
			},
		)
	}

	private async render() {
		await this.updateGlobalContext()
		await this.displaySuggestions()
		await this.displayCodeLens()
		await this.moveCursorToSuggestion()
	}

	public async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined) {
		if (!editor) {
			return
		}
		await this.render()
	}

	private async moveCursorToSuggestion() {
		const topLine = this.getSelectedSuggestionLine()
		if (topLine === null) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		editor.selection = new vscode.Selection(topLine, 0, topLine, 0)
		editor.revealRange(new vscode.Range(topLine, 0, topLine, 0), vscode.TextEditorRevealType.InCenter)
	}

	public async displaySuggestions() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		this.decorations.displaySuggestions(this.suggestions)
	}

	private getSelectedSuggestionLine() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return null
		}
		const file = this.suggestions.getFile(editor.document.uri)
		if (!file) {
			return null
		}
		const selectedGroup = file.getSelectedGroupOperations()
		if (selectedGroup.length === 0) {
			return null
		}
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const topOperation = selectedGroup?.length ? selectedGroup[0] : null
		if (!topOperation) {
			return null
		}
		return topOperation.type === "+" ? topOperation.line + offset.removed : topOperation.line + offset.added
	}

	private async displayCodeLens() {
		const topLine = this.getSelectedSuggestionLine()
		if (topLine === null) {
			this.codeLensProvider.setSuggestionRange(undefined)
			return
		}
		this.codeLensProvider.setSuggestionRange(new vscode.Range(topLine, 0, topLine, 0))
	}

	private async updateGlobalContext() {
		const hasSuggestions = this.suggestions.hasSuggestions()
		await vscode.commands.executeCommand("setContext", "kilocode.ghost.hasSuggestions", hasSuggestions)
		await vscode.commands.executeCommand(
			"setContext",
			"kilocode.ghost.enableQuickInlineTaskKeybinding",
			this.settings?.enableQuickInlineTaskKeybinding || false,
		)
		await vscode.commands.executeCommand(
			"setContext",
			"kilocode.ghost.enableAutoInlineTaskKeybinding",
			this.settings?.enableAutoInlineTaskKeybinding || false,
		)
	}

	public hasPendingSuggestions(): boolean {
		return this.suggestions.hasSuggestions()
	}

	public async cancelSuggestions() {
		if (!this.hasPendingSuggestions() || this.workspaceEdit.isLocked()) {
			return
		}
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		this.suggestions.clear()
		await this.render()
	}

	public async applySelectedSuggestions() {
		if (!this.hasPendingSuggestions() || this.workspaceEdit.isLocked()) {
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
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		await this.workspaceEdit.applySelectedSuggestions(this.suggestions)
		suggestionsFile.deleteSelectedGroup()
		this.suggestions.validateFiles()
		await this.workspaceEdit.applySuggestionsPlaceholders(this.suggestions)
		await this.render()
	}

	public async applyAllSuggestions() {
		if (!this.hasPendingSuggestions() || this.workspaceEdit.isLocked()) {
			return
		}
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		await this.workspaceEdit.applySuggestions(this.suggestions)
		this.suggestions.clear()
		await this.render()
	}

	public async selectNextSuggestion() {
		if (!this.hasPendingSuggestions()) {
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
		if (!this.hasPendingSuggestions()) {
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
