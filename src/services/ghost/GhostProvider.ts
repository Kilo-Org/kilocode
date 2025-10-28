import crypto from "crypto"
import * as vscode from "vscode"
import { t } from "../../i18n"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { parseGhostResponse } from "./classic-auto-complete/GhostStreamingParser"
import { AutoTriggerStrategy } from "./classic-auto-complete/AutoTriggerStrategy"
import { GhostModel } from "./GhostModel"
import { GhostSuggestionContext, contextToAutocompleteInput, extractPrefixSuffix } from "./types"
import { GhostStatusBar } from "./GhostStatusBar"
import { GhostSuggestionsState } from "./classic-auto-complete/GhostSuggestions"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"
import { GhostInlineCompletionProvider } from "./classic-auto-complete/GhostInlineCompletionProvider"
import { GhostServiceSettings, TelemetryEventName } from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { GhostContext } from "./GhostContext"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { GhostGutterAnimation } from "./GhostGutterAnimation"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { normalizeAutoTriggerDelayToMs } from "./utils/autocompleteDelayUtils"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private autoTriggerStrategy: AutoTriggerStrategy
	private suggestions: GhostSuggestionsState = new GhostSuggestionsState()
	private cline: ClineProvider
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null
	private ghostContext: GhostContext
	private cursorAnimation: GhostGutterAnimation

	private enabled: boolean = true
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
	public inlineCompletionProvider: GhostInlineCompletionProvider

	private ignoreController?: Promise<RooIgnoreController>

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.cline = cline

		// Register Internal Components
		this.documentStore = new GhostDocumentStore()
		this.autoTriggerStrategy = new AutoTriggerStrategy()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new GhostModel()
		this.ghostContext = new GhostContext(this.documentStore)
		this.cursorAnimation = new GhostGutterAnimation(context)

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.inlineCompletionProvider = new GhostInlineCompletionProvider()

		// Register document event handlers
		vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, context.subscriptions)
		vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this, context.subscriptions)
		vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, context.subscriptions)
		vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this, context.subscriptions)
		vscode.window.onDidChangeTextEditorSelection(this.onDidChangeTextEditorSelection, this, context.subscriptions)
		vscode.window.onDidChangeActiveTextEditor(this.onDidChangeActiveTextEditor, this, context.subscriptions)

		void this.load()

		// Initialize cursor animation with settings after load
		this.cursorAnimation.updateSettings(this.settings || undefined)
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
	private loadSettings() {
		const state = ContextProxy.instance?.getValues?.()
		return state.ghostServiceSettings
	}

	private async saveSettings() {
		if (!this.settings) {
			return
		}
		const settingsWithModelInfo = {
			...this.settings,
			provider: this.getCurrentProviderName(),
			model: this.getCurrentModelName(),
		}
		await ContextProxy.instance?.setValues?.({ ghostServiceSettings: settingsWithModelInfo })
		await this.cline.postStateToWebview()
	}

	public async load() {
		this.settings = this.loadSettings()
		await this.model.reload(this.providerSettingsManager)
		this.cursorAnimation.updateSettings(this.settings || undefined)
		await this.updateGlobalContext()
		this.updateStatusBar()
		await this.saveSettings()
	}

	public async disable() {
		this.settings = {
			...this.settings,
			enableAutoTrigger: false,
			enableSmartInlineTaskKeybinding: false,
			enableQuickInlineTaskKeybinding: false,
			showGutterAnimation: true,
		}
		await this.saveSettings()
		await this.load()
	}

	public async enable() {
		this.settings = {
			...this.settings,
			enableAutoTrigger: true,
			enableSmartInlineTaskKeybinding: true,
			enableQuickInlineTaskKeybinding: true,
			showGutterAnimation: true,
		}
		await this.saveSettings()
		await this.load()
	}

	// VsCode Event Handlers
	private onDidCloseTextDocument(document: vscode.TextDocument): void {
		if (!this.enabled || document.uri.scheme !== "file") {
			return
		}
		this.documentStore.removeDocument(document.uri)
	}

	private initializeIgnoreController() {
		if (!this.ignoreController) {
			this.ignoreController = (async () => {
				const ignoreController = new RooIgnoreController(this.cline.cwd)
				await ignoreController.initialize()
				return ignoreController
			})()
		}
		return this.ignoreController
	}

	private async disposeIgnoreController() {
		if (this.ignoreController) {
			const ignoreController = this.ignoreController
			delete this.ignoreController
			;(await ignoreController).dispose()
		}
	}

	private onDidChangeWorkspaceFolders() {
		this.disposeIgnoreController()
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

		// Filter out undo/redo operations
		if (event.reason !== undefined) {
			return
		}

		if (event.contentChanges.length === 0) {
			return
		}

		// Heuristic to filter out bulk changes (git operations, external edits)
		const isBulkChange = event.contentChanges.some((change) => change.rangeLength > 100 || change.text.length > 100)
		if (isBulkChange) {
			return
		}

		// Heuristic to filter out changes far from cursor (likely external or LLM edits)
		const editor = vscode.window.activeTextEditor
		if (!editor || editor.document !== event.document) {
			return
		}

		const cursorPos = editor.selection.active
		const isNearCursor = event.contentChanges.some((change) => {
			const distance = Math.abs(cursorPos.line - change.range.start.line)
			return distance <= 2
		})
		if (!isNearCursor) {
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
		this.cursorAnimation.update()
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

	private async hasAccess(document: vscode.TextDocument) {
		return document.isUntitled || (await this.initializeIgnoreController()).validateAccess(document.fileName)
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
		if (!(await this.hasAccess(document))) {
			return
		}

		const range = editor.selection.isEmpty ? undefined : editor.selection

		await this.provideCodeSuggestions({ document, range })
	}

	private async provideCodeSuggestions(initialContext: GhostSuggestionContext): Promise<void> {
		// Cancel any ongoing suggestions
		await this.cancelSuggestions()
		this.startRequesting()
		this.isRequestCancelled = false

		const context = await this.ghostContext.generate(initialContext)

		const autocompleteInput = contextToAutocompleteInput(context)

		const position = context.range?.start ?? context.document.positionAt(0)
		const { prefix, suffix } = extractPrefixSuffix(context.document, position)
		const languageId = context.document.languageId

		// Check cache before making API call
		if (this.inlineCompletionProvider.cachedSuggestionAvailable(prefix, suffix)) {
			return
		}

		const { systemPrompt, userPrompt } = this.autoTriggerStrategy.getPrompts(
			autocompleteInput,
			prefix,
			suffix,
			languageId,
		)
		if (this.isRequestCancelled) {
			return
		}

		if (!this.model.loaded) {
			this.stopProcessing()
			await this.load()
		}

		let hasShownFirstSuggestion = false
		let cost = 0
		let inputTokens = 0
		let outputTokens = 0
		let cacheWriteTokens = 0
		let cacheReadTokens = 0
		let response = ""

		// Create streaming callback
		const onChunk = (chunk: any) => {
			if (this.isRequestCancelled) {
				return
			}

			if (chunk.type === "text") {
				response += chunk.text
			}
		}

		try {
			// Start streaming generation
			const usageInfo = await this.model.generateResponse(systemPrompt, userPrompt, onChunk)

			console.log("response", response)

			// Update cost tracking
			cost = usageInfo.cost
			inputTokens = usageInfo.inputTokens
			outputTokens = usageInfo.outputTokens
			cacheWriteTokens = usageInfo.cacheWriteTokens
			cacheReadTokens = usageInfo.cacheReadTokens

			this.updateCostTracking(cost)

			// Send telemetry
			TelemetryService.instance.captureEvent(TelemetryEventName.LLM_COMPLETION, {
				taskId: this.taskId,
				inputTokens: inputTokens,
				outputTokens: outputTokens,
				cacheWriteTokens: cacheWriteTokens,
				cacheReadTokens: cacheReadTokens,
				cost: cost,
				service: "INLINE_ASSIST",
			})

			if (this.isRequestCancelled) {
				this.suggestions.clear()
				await this.render()
				return
			}

			// Finish the streaming parser to apply sanitization if needed
			const finalParseResult = parseGhostResponse(response, prefix, suffix, context.document, context.range)

			if (finalParseResult.suggestions.getFillInAtCursor()) {
				console.info("Final suggestion:", finalParseResult.suggestions.getFillInAtCursor())
			}

			if (finalParseResult.hasNewSuggestions && !hasShownFirstSuggestion) {
				// Handle case where sanitization produced suggestions
				this.suggestions = finalParseResult.suggestions
				hasShownFirstSuggestion = true
				this.stopProcessing()
				await this.render()
			} else if (finalParseResult.hasNewSuggestions && hasShownFirstSuggestion) {
				// Update existing suggestions with sanitized results
				this.suggestions = finalParseResult.suggestions
				await this.render()
			}

			// If we never showed any suggestions, there might have been an issue
			if (!hasShownFirstSuggestion) {
				console.warn("No suggestions were generated during streaming")
				this.stopProcessing()
			}
		} catch (error) {
			console.error("Error in streaming generation:", error)
			this.stopProcessing()
			throw error
		}
	}

	private async render() {
		await this.updateGlobalContext()

		this.inlineCompletionProvider.updateSuggestions(this.suggestions)

		await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
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
		if (!this.hasPendingSuggestions()) {
			return
		}
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_REJECT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.suggestions.clear()

		this.clearAutoTriggerTimer()
		await this.render()
	}

	private initializeStatusBar() {
		if (!this.enabled) {
			return
		}
		this.statusBar = new GhostStatusBar({
			enabled: false,
			model: "loading...",
			provider: "loading...",
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

	private getCurrentProviderName(): string {
		if (!this.model.loaded) {
			return "loading..."
		}
		return this.model.getProviderDisplayName() ?? "unknown"
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
			enabled: this.settings?.enableAutoTrigger,
			model: this.getCurrentModelName(),
			provider: this.getCurrentProviderName(),
			hasValidToken: this.hasValidApiToken(),
			totalSessionCost: this.sessionCost,
			lastCompletionCost: this.lastCompletionCost,
		})
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
		this.cursorAnimation.active()
		this.isProcessing = true
		this.updateGlobalContext()
	}

	private startProcessing() {
		this.isProcessing = true
		this.updateGlobalContext()
	}

	private stopProcessing() {
		this.cursorAnimation.hide()
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
		const delay = normalizeAutoTriggerDelayToMs(this.settings?.autoTriggerDelay)
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

	/**
	 * Dispose of all resources used by the GhostProvider
	 */
	public dispose(): void {
		this.clearAutoTriggerTimer()
		this.cancelRequest()

		this.suggestions.clear()

		this.statusBar?.dispose()
		this.cursorAnimation.dispose()

		this.disposeIgnoreController()

		GhostProvider.instance = null // Reset singleton
	}
}
