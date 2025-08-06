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
import { GhostCursorAnimation } from "./GhostCursorAnimation"

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
	private cursor: GhostCursorAnimation

	private enabled: boolean = false
	private taskId: string | null = null
	private isProcessing: boolean = false
	private isRequestCancelled: boolean = false

	// Status bar integration
	private statusBar: GhostStatusBar | null = null
	private sessionCost: number = 0
	private lastCompletionCost: number = 0

	// Auto-trigger timer management
	private autoTriggerTimer: NodeJS.Timeout | null = null
	private lastTextChangeTime: number = 0

	// VSCode Providers
	public codeActionProvider: GhostCodeActionProvider
	public codeLensProvider: GhostCodeLensProvider

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.context = context
		this.cline = cline

		// Register Internal Components
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.strategy = new GhostStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new GhostModel()
		this.ghostContext = new GhostContext(this.documentStore)
		this.cursor = new GhostCursorAnimation(context)

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.codeLensProvider = new GhostCodeLensProvider()

		// Register document event handlers
		vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, context.subscriptions)
		vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this, context.subscriptions)
		vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, context.subscriptions)
		vscode.window.onDidChangeTextEditorSelection(this.onDidChangeTextEditorSelection, this, context.subscriptions)
		vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, context.subscriptions)

		void this.reload()
	}

	// Singleton Management
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

	// Settings Management
	private loadExperimentStatus() {
		const state = ContextProxy.instance?.getValues?.()
		return experiments.isEnabled(state.experiments ?? {}, EXPERIMENT_IDS.INLINE_ASSIST)
	}

	private loadSettings() {
		const state = ContextProxy.instance?.getValues?.()
		return state.ghostServiceSettings
	}

	private async saveSettings() {
		if (!this.settings) {
			return
		}
		await ContextProxy.instance?.setValues?.({ ghostServiceSettings: this.settings })
		await this.cline.postStateToWebview
	}

	private async load() {
		this.settings = this.loadSettings()
		await this.model.reload(this.settings, this.providerSettingsManager)
		await this.updateGlobalContext()
		this.updateStatusBar()
	}

	private async unload() {
		this.clearAutoTriggerTimer()
		this.disposeStatusBar()
		await this.cancelSuggestions()
	}

	public async disable() {
		this.settings = {
			...this.settings,
			enableAutoTrigger: false,
			enableSmartInlineTaskKeybinding: false,
			enableQuickInlineTaskKeybinding: false,
		}
		await this.saveSettings()
		await this.reload()
	}

	public async enable() {
		this.settings = {
			...this.settings,
			enableAutoTrigger: true,
			enableSmartInlineTaskKeybinding: true,
			enableQuickInlineTaskKeybinding: true,
		}
		await this.saveSettings()
		await this.reload()
	}

	public async reload() {
		const enabled = this.loadExperimentStatus()
		if (this.enabled && !enabled) {
			this.enabled = enabled
			await this.unload()
			return
		}
		this.enabled = enabled
		if (this.enabled) {
			await this.load()
		}
		return
	}

	// VsCode Event Handlers
	private onDidCloseTextDocument(document: vscode.TextDocument): void {
		if (!this.enabled || document.uri.scheme !== "file") {
			return
		}
		this.documentStore.removeDocument(document.uri)
	}

	private async onDidOpenTextDocument(document: vscode.TextDocument): Promise<void> {
		if (!this.enabled || document.uri.scheme !== "file") {
			return
		}
		await this.documentStore.storeDocument({
			document,
		})
	}

	private async onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent): Promise<void> {
		if (!this.enabled || event.document.uri.scheme !== "file") {
			return
		}
		if (this.workspaceEdit.isLocked()) {
			return
		}
		await this.documentStore.storeDocument({ document: event.document })
		this.lastTextChangeTime = Date.now()
		this.handleTypingEvent(event)
	}

	private async onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
		if (!this.enabled) {
			return
		}
		this.cursor.update()
		const timeSinceLastTextChange = Date.now() - this.lastTextChangeTime
		const isSelectionChangeFromTyping = timeSinceLastTextChange < 50
		if (!isSelectionChangeFromTyping) {
			this.clearAutoTriggerTimer()
		}
	}

	private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined) {
		if (!this.enabled || !editor) {
			return
		}
		this.clearAutoTriggerTimer()
		await this.render()
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
		this.startRequesting()
		this.isRequestCancelled = false

		const context = await this.ghostContext.generate(initialContext)
		// Load custom instructions
		const workspacePath = getWorkspacePath()
		const customInstructions = await addCustomInstructions("", "", workspacePath, "ghost")

		const systemPrompt = this.strategy.getSystemPrompt(customInstructions)
		const userPrompt = this.strategy.getSuggestionPrompt(context)
		if (this.isRequestCancelled) {
			return
		}

		if (!this.model.loaded) {
			this.stopProcessing()
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

		if (this.isRequestCancelled) {
			return
		}

		// First parse the response into edit operations
		this.suggestions = await this.strategy.parseResponse(response, context)
		if (this.isRequestCancelled) {
			this.suggestions.clear()
			await this.render()
			return
		}
		// Generate placeholder for show the suggestions
		this.stopProcessing()
		await this.workspaceEdit.applySuggestionsPlaceholders(this.suggestions)
		await this.render()
	}

	private async render() {
		await this.updateGlobalContext()
		await this.displaySuggestions()
		await this.displayCodeLens()
		await this.moveCursorToSuggestion()
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
		// Get the text of the line to find its length
		const lineText = editor.document.lineAt(topLine).text
		const lineLength = lineText.length

		// Move cursor to the end of the line
		editor.selection = new vscode.Selection(topLine, lineLength, topLine, lineLength)
		editor.revealRange(
			new vscode.Range(topLine, lineLength, topLine, lineLength),
			vscode.TextEditorRevealType.InCenter,
		)
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
		await vscode.commands.executeCommand("setContext", "kilocode.ghost.isProcessing", this.isProcessing)
		await vscode.commands.executeCommand(
			"setContext",
			"kilocode.ghost.enableQuickInlineTaskKeybinding",
			this.settings?.enableQuickInlineTaskKeybinding || false,
		)
		await vscode.commands.executeCommand(
			"setContext",
			"kilocode.ghost.enableSmartInlineTaskKeybinding",
			this.settings?.enableSmartInlineTaskKeybinding || false,
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

		this.clearAutoTriggerTimer()
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

		this.clearAutoTriggerTimer()
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

		this.clearAutoTriggerTimer()
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

	private startRequesting() {
		this.cursor.active()
		this.isProcessing = true
		this.updateGlobalContext()
	}

	private startProcessing() {
		this.cursor.wait()
		this.isProcessing = true
		this.updateGlobalContext()
	}

	private stopProcessing() {
		this.cursor.hide()
		this.isProcessing = false
		this.updateGlobalContext()
	}

	public cancelRequest() {
		this.stopProcessing()
		this.isRequestCancelled = true
		if (this.autoTriggerTimer) {
			this.clearAutoTriggerTimer()
		}
	}

	/**
	 * Handle typing events for auto-trigger functionality
	 */
	private handleTypingEvent(event: vscode.TextDocumentChangeEvent): void {
		// Cancel existing suggestions when user starts typing
		if (this.hasPendingSuggestions()) {
			void this.cancelSuggestions()
			return
		}

		// Skip if auto-trigger is not enabled
		if (!this.isAutoTriggerEnabled()) {
			return
		}

		// Clear any existing timer
		this.clearAutoTriggerTimer()
		this.startProcessing()
		// Start a new timer
		const delay = (this.settings?.autoTriggerDelay || 3) * 1000
		this.autoTriggerTimer = setTimeout(() => {
			this.onAutoTriggerTimeout()
		}, delay)
	}

	/**
	 * Clear the auto-trigger timer
	 */
	private clearAutoTriggerTimer(): void {
		this.stopProcessing()
		if (this.autoTriggerTimer) {
			clearTimeout(this.autoTriggerTimer)
			this.autoTriggerTimer = null
		}
	}

	/**
	 * Check if auto-trigger is enabled in settings
	 */
	private isAutoTriggerEnabled(): boolean {
		return this.settings?.enableAutoTrigger === true
	}

	/**
	 * Handle auto-trigger timeout - triggers code suggestion automatically
	 */
	private async onAutoTriggerTimeout(): Promise<void> {
		// Reset typing state
		this.autoTriggerTimer = null

		// Double-check that we should still trigger
		if (!this.enabled || !this.isAutoTriggerEnabled() || this.hasPendingSuggestions()) {
			return
		}

		// Get the active editor
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		// Trigger code suggestion automatically
		await this.codeSuggestion()
	}
}
