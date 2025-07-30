import crypto from "crypto"
import * as vscode from "vscode"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStrategy } from "./GhostStrategy"
import { GhostModel } from "./GhostModel"
import { GhostWorkspaceEdit } from "./GhostWorkspaceEdit"
import { GhostDecorations } from "./GhostDecorations"
import { GhostSuggestionContext } from "./types"
import { GhostStatusBar } from "./GhostStatusBar"
import { t } from "../../i18n"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"
import { getWorkspacePath } from "../../utils/path"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"
import { GhostCodeLensProvider } from "./GhostCodeLensProvider"
import { GhostServiceSettings, TelemetryEventName } from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { GhostContext } from "./GhostContext"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { experiments, EXPERIMENT_IDS } from "../../shared/experiments"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private strategy: GhostStrategy
	private workspaceEdit: GhostWorkspaceEdit
	private suggestions: GhostSuggestionsState = new GhostSuggestionsState()
	private context: vscode.ExtensionContext
	private cline: ClineProvider
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null
	private ghostContext: GhostContext

	private enabled: boolean = false
	private taskId: string | null = null

	// Status bar integration
	private statusBar: GhostStatusBar | null = null
	private sessionCost: number = 0
	private lastCompletionCost: number = 0

	// VSCode Providers
	public codeActionProvider: GhostCodeActionProvider
	public codeLensProvider: GhostCodeLensProvider

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.context = context
		this.cline = cline
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.strategy = new GhostStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new GhostModel()
		this.ghostContext = new GhostContext(this.documentStore)

		this.loadSettings()
		this.initializeStatusBar()

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.codeLensProvider = new GhostCodeLensProvider()

		// Register document event handlers
		vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, context.subscriptions)
		vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this, context.subscriptions)
		vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, context.subscriptions)

		void this.reload()
	}

	private async watcherState() {}

	/**
	 * Handle document close events to remove the document from the store and free memory
	 */
	private onDidCloseTextDocument(document: vscode.TextDocument): void {
		// Only process file documents
		if (!this.enabled || document.uri.scheme !== "file") {
			return
		}

		// Remove the document completely from the store
		this.documentStore.removeDocument(document.uri)
	}

	/**
	 * Handle document open events to parse the AST
	 */
	private async onDidOpenTextDocument(document: vscode.TextDocument): Promise<void> {
		// Only process file documents
		if (!this.enabled || document.uri.scheme !== "file") {
			return
		}

		// Store the document and parse its AST
		await this.documentStore.storeDocument({
			document,
		})
	}

	/**
	 * Handle document change events to update the AST
	 */
	private async onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent): Promise<void> {
		// Only process file documents
		if (!this.enabled || event.document.uri.scheme !== "file") {
			return
		}

		if (this.workspaceEdit.isLocked()) {
			return
		}

		// Store the updated document and parse its AST
		await this.documentStore.storeDocument({ document: event.document })
	}

	private loadSettings() {
		const state = ContextProxy.instance?.getValues?.()
		const experimentEnabled = experiments.isEnabled(state.experiments ?? {}, EXPERIMENT_IDS.INLINE_ASSIST)
		if (this.enabled && !experimentEnabled) {
			this.disable()
		}
		if (!this.enabled && experimentEnabled) {
			this.enable()
		}
		this.enabled = experimentEnabled
		return state.ghostServiceSettings
	}

	private async saveSettings() {
		if (!this.settings) {
			return
		}
		await ContextProxy.instance?.setValues?.({ ghostServiceSettings: this.settings })
		await this.cline.postStateToWebview()
	}

	public async reload() {
		this.settings = this.loadSettings()
		await this.model.reload(this.settings, this.providerSettingsManager)
		await this.updateGlobalContext()
		this.updateStatusBar()
	}

	public static initialize(context: vscode.ExtensionContext, cline: ClineProvider): GhostProvider {
		if (GhostProvider.instance) {
			throw new Error("GhostProvider is already initialized. Use getInstance() instead.")
		}
		GhostProvider.instance = new GhostProvider(context, cline)
		return GhostProvider.instance
	}

	public static getInstance(): GhostProvider {
		if (!GhostProvider.instance) {
			throw new Error("GhostProvider is not initialized. Call initialize() first.")
		}
		return GhostProvider.instance
	}

	public async promptCodeSuggestion() {
		if (!this.enabled) {
			return
		}
		this.taskId = crypto.randomUUID()

		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_QUICK_TASK, {
			taskId: this.taskId,
		})

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
		if (!this.enabled) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		this.taskId = crypto.randomUUID()
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_AUTO_TASK, {
			taskId: this.taskId,
		})

		const document = editor.document
		const range = editor.selection.isEmpty ? undefined : editor.selection

		await this.provideCodeSuggestions({ document, range })
	}

	private async provideCodeSuggestions(initialContext: GhostSuggestionContext): Promise<void> {
		// Cancel any ongoing suggestions
		await this.cancelSuggestions()

		let cancelled = false

		const context = await this.ghostContext.generate(initialContext)

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
				const userPrompt = this.strategy.getSuggestionPrompt(context)
				if (cancelled) {
					return
				}

				progress.report({ message: t("kilocode:ghost.progress.generating") })
				if (!this.model.loaded) {
					await this.reload()
				}

				const { response, cost, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens } =
					await this.model.generateResponse(systemPrompt, userPrompt)

				this.updateCostTracking(cost)

				TelemetryService.instance.captureEvent(TelemetryEventName.LLM_COMPLETION, {
					taskId: this.taskId,
					inputTokens,
					outputTokens,
					cacheWriteTokens,
					cacheReadTokens,
					cost,
					service: "INLINE_ASSIST",
				})

				if (cancelled) {
					return
				}

				// First parse the response into edit operations
				progress.report({ message: t("kilocode:ghost.progress.processing") })
				this.suggestions = await this.strategy.parseResponse(response, context)

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
		if (!this.enabled) {
			return
		}
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
		if (!this.enabled) {
			return
		}
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
		if (!this.enabled) {
			return false
		}
		return this.suggestions.hasSuggestions()
	}

	public async cancelSuggestions() {
		if (!this.hasPendingSuggestions() || this.workspaceEdit.isLocked()) {
			return
		}
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_REJECT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		this.suggestions.clear()
		await this.render()
	}

	public async applySelectedSuggestions() {
		if (!this.enabled) {
			return
		}
		if (!this.hasPendingSuggestions() || this.workspaceEdit.isLocked()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			await this.cancelSuggestions()
			return
		}
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			await this.cancelSuggestions()
			return
		}
		if (suggestionsFile.getSelectedGroup() === null) {
			await this.cancelSuggestions()
			return
		}
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_ACCEPT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		await this.workspaceEdit.applySelectedSuggestions(this.suggestions)
		suggestionsFile.deleteSelectedGroup()
		this.suggestions.validateFiles()
		await this.workspaceEdit.applySuggestionsPlaceholders(this.suggestions)
		await this.render()
	}

	public async applyAllSuggestions() {
		if (!this.enabled) {
			return
		}
		if (!this.hasPendingSuggestions() || this.workspaceEdit.isLocked()) {
			return
		}
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_ACCEPT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.decorations.clearAll()
		await this.workspaceEdit.revertSuggestionsPlaceholder(this.suggestions)
		await this.workspaceEdit.applySuggestions(this.suggestions)
		this.suggestions.clear()
		await this.render()
	}

	public async selectNextSuggestion() {
		if (!this.enabled) {
			return
		}
		if (!this.hasPendingSuggestions()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			await this.cancelSuggestions()
			return
		}
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			await this.cancelSuggestions()
			return
		}
		suggestionsFile.selectNextGroup()
		await this.render()
	}

	public async selectPreviousSuggestion() {
		if (!this.enabled) {
			return
		}
		if (!this.hasPendingSuggestions()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			await this.cancelSuggestions()
			return
		}
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			await this.cancelSuggestions()
			return
		}
		suggestionsFile.selectPreviousGroup()
		await this.render()
	}

	private initializeStatusBar() {
		if (!this.enabled) {
			return
		}
		this.statusBar = new GhostStatusBar({
			enabled: false,
			model: "loading...",
			hasValidToken: false,
			totalSessionCost: 0,
			lastCompletionCost: 0,
		})
	}

	private getCurrentModelName(): string {
		if (!this.model.loaded) {
			return "loading..."
		}
		return this.model.getModelName() ?? "unknown"
	}

	private hasValidApiToken(): boolean {
		return this.model.loaded && this.model.hasValidCredentials()
	}

	private updateCostTracking(cost: number) {
		this.lastCompletionCost = cost
		this.sessionCost += cost
		this.updateStatusBar()
	}

	private updateStatusBar() {
		if (!this.statusBar) {
			this.initializeStatusBar()
		}

		this.statusBar?.update({
			enabled: true,
			model: this.getCurrentModelName(),
			hasValidToken: this.hasValidApiToken(),
			totalSessionCost: this.sessionCost,
			lastCompletionCost: this.lastCompletionCost,
		})
	}

	private disposeStatusBar() {
		this.statusBar?.dispose()
		this.statusBar = null
	}

	public dispose() {
		this.disposeStatusBar()
	}

	public async disable() {
		this.settings = {
			...this.settings,
			enableAutoInlineTaskKeybinding: false,
			enableQuickInlineTaskKeybinding: false,
		}
		this.disposeStatusBar()
		await this.cancelSuggestions()
		await this.saveSettings()
		await this.updateGlobalContext()
	}

	public async enable() {
		this.settings = {
			...this.settings,
			enableAutoInlineTaskKeybinding: true,
			enableQuickInlineTaskKeybinding: true,
		}
		this.updateStatusBar()
		await this.saveSettings()
		await this.updateGlobalContext()
	}

	public async showIncompatibilityExtensionPopup() {
		const message = t("kilocode:ghost.incompatibilityExtensionPopup.message")
		const disableCopilot = t("kilocode:ghost.incompatibilityExtensionPopup.disableCopilot")
		const disableInlineAssist = t("kilocode:ghost.incompatibilityExtensionPopup.disableInlineAssist")
		const response = await vscode.window.showErrorMessage(message, disableCopilot, disableInlineAssist)

		if (response === disableCopilot) {
			await vscode.commands.executeCommand<any>("github.copilot.completions.disable")
		} else if (response === disableInlineAssist) {
			await vscode.commands.executeCommand<any>("kilo-code.ghost.disable")
		}
	}
}
