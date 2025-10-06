import crypto from "crypto"
import * as vscode from "vscode"
import { t } from "../../i18n"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { VSCodeGhostApplicator } from "./applicators/VSCodeGhostApplicator"
import { GhostDecorations } from "./GhostDecorations"
import { GhostSuggestionContext, GroupRenderingDecision, GhostSuggestionEditOperation } from "./types"
import { GhostSuggestionFile } from "./GhostSuggestions"
import { GhostStatusBar } from "./GhostStatusBar"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"
import { GhostCodeLensProvider } from "./GhostCodeLensProvider"
import { GhostServiceSettings, TelemetryEventName } from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { GhostGutterAnimation } from "./GhostGutterAnimation"
import { GhostCursor } from "./GhostCursor"
import { GhostSuggestionPrefetchQueue } from "./GhostSuggestionPrefetchQueue"
import { GhostSuggestionOutcome, PromptMetadata, createGhostSuggestionOutcome } from "./types/GhostSuggestionOutcome"
import { calculateFinalCursorPosition } from "./utils/diffHelpers"
import { myersDiff } from "./utils/myers"
import { GhostInlineProvider } from "./GhostInlineProvider"
import { GhostEngine } from "./GhostEngine"
import { VSCodeGhostAdapter } from "./adapters/VSCodeGhostAdapter"
import { GhostCancellationError, GhostErrorUtils } from "./errors/GhostErrors"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private documentStore: GhostDocumentStore
	private applicator: VSCodeGhostApplicator
	private suggestions: GhostSuggestionsState = new GhostSuggestionsState()
	private context: vscode.ExtensionContext
	private cline: ClineProvider
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null
	private cursor: GhostCursor
	private cursorAnimation: GhostGutterAnimation

	// Core Ghost engine with all business logic
	private ghostEngine: GhostEngine

	private enabled: boolean = true
	private taskId: string | null = null
	private isProcessing: boolean = false
	private cancellationToken: AbortController | null = null

	// Status bar integration
	private statusBar: GhostStatusBar | null = null
	private sessionCost: number = 0
	private lastCompletionCost: number = 0

	// Ghost suggestion support
	private currentGhostSuggestionOutcome: GhostSuggestionOutcome | null = null
	private promptMetadata: PromptMetadata | null = null

	// Auto-trigger timer management
	private autoTriggerTimer: NodeJS.Timeout | null = null
	private lastTextChangeTime: number = 0

	// VSCode Providers
	public codeActionProvider: GhostCodeActionProvider
	public codeLensProvider: GhostCodeLensProvider
	public inlineProvider: GhostInlineProvider

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.context = context
		this.cline = cline

		// Register Internal Components
		this.decorations = new GhostDecorations()
		this.documentStore = new GhostDocumentStore()
		this.applicator = new VSCodeGhostApplicator()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.cursor = new GhostCursor()
		this.cursorAnimation = new GhostGutterAnimation(context)

		// Initialize the core Ghost engine
		this.ghostEngine = new GhostEngine(this.providerSettingsManager, this.documentStore)

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.codeLensProvider = new GhostCodeLensProvider()
		this.inlineProvider = GhostInlineProvider.getInstance()

		// Register document event handlers
		vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this, context.subscriptions)
		vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this, context.subscriptions)
		vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument, this, context.subscriptions)
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
		await ContextProxy.instance?.setValues?.({ ghostServiceSettings: this.settings })
		await this.cline.postStateToWebview()
	}

	public async load() {
		this.settings = this.loadSettings()
		await this.ghostEngine.load(this.settings)
		this.cursorAnimation.updateSettings(this.settings || undefined)
		await this.updateGlobalContext()
		this.updateStatusBar()
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
		if (this.applicator.isLocked()) {
			return
		}

		try {
			await this.documentStore.storeDocument({ document: event.document })
			this.lastTextChangeTime = Date.now()
			this.handleTypingEvent(event)
		} catch (error) {
			if (error instanceof GhostCancellationError) {
				// Cancellation is expected, don't log as error
				return
			}
			GhostErrorUtils.logError(GhostErrorUtils.toGhostError(error, "Failed to handle document change"))
		}
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
		this.cancellationToken = new AbortController()

		try {
			// Set task ID for telemetry
			if (this.taskId) {
				this.ghostEngine.setTaskId(this.taskId)
			}

			// Check if engine is loaded
			if (!this.ghostEngine.loaded) {
				this.stopProcessing()
				await this.load()
			}

			// Convert VSCode context to platform-independent context using adapter
			const engineContext = VSCodeGhostAdapter.toGhostEngineContext(initialContext)

			// Execute completion WITHOUT automatic application
			// Pass applicator but use 'none' mode (we'll apply manually after rendering)
			const result = await this.ghostEngine.executeCompletion(
				engineContext,
				this.applicator, // REQUIRED parameter
				"none", // Don't apply yet - we need to render first
			)

			// Check for cancellation after completion
			if (this.cancellationToken?.signal.aborted) {
				this.suggestions.clear()
				await this.render()
				return
			}

			// Use the suggestions from the engine
			this.suggestions = result.suggestions

			// Update cost tracking
			this.updateCostTracking(result.metadata.cost || 0)

			// Store the Ghost suggestion outcome and metadata
			if (result.ghostSuggestionOutcome) {
				this.currentGhostSuggestionOutcome = result.ghostSuggestionOutcome
			}
			if (result.promptMetadata) {
				this.promptMetadata = result.promptMetadata
			}

			// Final render to ensure everything is up to date
			this.selectClosestSuggestion()
			await this.render()
		} catch (error) {
			if (error instanceof GhostCancellationError) {
				// Cancellation is expected, clean up and return
				this.suggestions.clear()
				await this.render()
				return
			}

			GhostErrorUtils.logError(GhostErrorUtils.toGhostError(error, "Error in Ghost completion"))
			this.stopProcessing()
			throw error
		} finally {
			this.stopProcessing()
		}
	}

	/**
	 * Extract code completion from Mercury's markdown-formatted response
	 */
	private extractMercuryCompletion(response: string): string {
		// Mercury typically returns code within markdown code blocks
		const startMarker = "```"
		const endMarker = "```"

		const lines = response.split("\n")
		let inCodeBlock = false
		const codeLines: string[] = []

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim()

			if (line.startsWith(startMarker) && !inCodeBlock) {
				inCodeBlock = true
				continue
			}

			if (line === endMarker && inCodeBlock) {
				break
			}

			if (inCodeBlock) {
				codeLines.push(lines[i]) // Keep original indentation
			}
		}

		return codeLines.length > 0 ? codeLines.join("\n") : response
	}

	/**
	 * Show the first edit group from the prefetch queue
	 */
	private async showFirstEditGroupFromQueue(): Promise<void> {
		const queue = GhostSuggestionPrefetchQueue.getInstance()
		const firstItem = queue.peekProcessed()

		if (!firstItem) {
			console.log("No edit groups in prefetch queue to display")
			this.stopProcessing()
			return
		}

		// Convert the queue item to our GhostSuggestions format
		// This will need to be implemented based on how our existing system works
		// For now, just log that we have the item

		this.stopProcessing()
		// TODO: Integrate with GhostSuggestions to display the edit group
	}

	private async render() {
		await this.updateGlobalContext()

		const editor = vscode.window.activeTextEditor
		if (!editor || !this.suggestions.hasSuggestions()) {
			console.log("🚀 GhostProvider: No editor or suggestions")
			return
		}

		// Get the currently selected group (single group evaluation)
		const suggestionsFile = this.suggestions.getFile(editor.document.uri)
		if (!suggestionsFile) {
			console.log("🚀 GhostProvider: No suggestions file for current document")
			return
		}

		const groups = suggestionsFile.getGroupsOperations()
		if (groups.length === 0) {
			console.log("🚀 GhostProvider: No groups to display")
			return
		}

		const selectedGroupIndex = suggestionsFile.getSelectedGroup()
		if (selectedGroupIndex === null || selectedGroupIndex >= groups.length) {
			console.log("🚀 GhostProvider: No valid selected group")
			return
		}

		const selectedGroup = groups[selectedGroupIndex]

		// Move cursor to the selected group BEFORE evaluating inline suitability
		this.moveToSelectedGroup(editor, suggestionsFile)

		// Check if the selected group is suitable for inline completion
		// (now that cursor is positioned at the group)
		const isInlineSuitable = this.inlineProvider.isGroupSuitableForInline(
			selectedGroup,
			editor.selection.active,
			editor.document,
		)

		if (isInlineSuitable) {
			console.log(`🚀 GhostProvider: Displaying selected group ${selectedGroupIndex} as inline completion`)
			await this.displayInlineCompletion()
		} else {
			console.log(`🚀 GhostProvider: Displaying selected group ${selectedGroupIndex} as decorator`)
			await this.displaySuggestions()
		}
		// await this.displayCodeLens()
	}

	private selectClosestSuggestion() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		const file = this.suggestions.getFile(editor.document.uri)
		if (!file) {
			return
		}
		file.selectClosestGroup(editor.selection)
	}

	public async displaySuggestions() {
		if (!this.enabled) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}
		await this.decorations.displaySuggestions(this.suggestions)
	}

	/**
	 * Determine if current suggestions should use inline completion instead of decorators.
	 */
	private shouldUseInlineCompletion(): boolean {
		const editor = vscode.window.activeTextEditor
		if (!editor || !this.suggestions.hasSuggestions()) {
			return false
		}

		return this.inlineProvider.isSuitableForInlineCompletion(
			this.suggestions,
			editor.selection.active,
			editor.document,
		)
	}

	/**
	 * Display suggestions using VSCode's inline completion system.
	 */
	private async displayInlineCompletion(): Promise<void> {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		// Set the suggestions in the inline provider
		this.inlineProvider.setSuggestionsForInlineDisplay(this.suggestions, editor.selection.active)

		// Trigger VSCode's inline completion at the current cursor position
		await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
	}

	/**
	 * Display suggestions using hybrid rendering (some inline, some decorators)
	 */
	private async displayHybridSuggestions(renderingDecisions: GroupRenderingDecision[]): Promise<void> {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		// First, display decorator groups using the existing decorator system
		const decoratorDecisions = renderingDecisions.filter((d) => d.renderingMode === "decorator")
		if (decoratorDecisions.length > 0) {
			console.log(`🎨 GhostProvider: Displaying ${decoratorDecisions.length} groups as decorators`)
			await this.displaySuggestions() // This will show all decorator groups
		}

		// Then, handle inline groups
		const inlineDecisions = renderingDecisions.filter((d) => d.renderingMode === "inline")
		if (inlineDecisions.length > 0) {
			console.log(`⚡ GhostProvider: Displaying ${inlineDecisions.length} groups as inline completions`)

			// For now, use the first inline group for inline completion
			// TODO: Implement proper multi-group inline handling
			const firstInlineDecision = inlineDecisions[0]

			// Position cursor at the target position if specified
			if (firstInlineDecision.targetPosition) {
				editor.selection = new vscode.Selection(
					firstInlineDecision.targetPosition,
					firstInlineDecision.targetPosition,
				)
			}

			// Set the suggestions and trigger inline completion
			this.inlineProvider.setSuggestionsForInlineDisplay(this.suggestions, editor.selection.active)
			await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
		}
	}

	/**
	 * Get current suggestions for external access (used by inline provider)
	 */
	public getCurrentSuggestions(): GhostSuggestionsState {
		return this.suggestions
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
		if (!this.hasPendingSuggestions() || this.applicator.isLocked()) {
			return
		}
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_REJECT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.decorations.clearAll()
		this.suggestions.clear()

		this.clearAutoTriggerTimer()
		await this.render()
	}

	public async applySelectedSuggestions() {
		if (!this.enabled) {
			return
		}
		if (!this.hasPendingSuggestions() || this.applicator.isLocked()) {
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

		// Use GhostEngine to apply via applicator
		// Convert vscode.Uri to string for platform-independent interface
		await this.ghostEngine.apply(
			this.suggestions,
			editor.document.uri.toString(), // Convert to string
			this.applicator, // REQUIRED parameter
			"selected",
		)

		this.cursor.moveToAppliedGroup(this.suggestions)
		suggestionsFile.deleteSelectedGroup()
		suggestionsFile.selectClosestGroup(editor.selection)
		this.suggestions.validateFiles()
		this.clearAutoTriggerTimer()

		// Check if we have more edit groups in the prefetch queue
		const hasMoreGroups = await this.handleGhostSuggestionGroupFromQueue()

		if (!hasMoreGroups) {
			// No more groups, render normally
			await this.render()
		}
		// If we showed the next group, don't render again as it was already rendered
	}

	/**
	 * Handle cycling to next edit group from prefetch queue (Continue's approach)
	 * Returns true if next group was shown, false if no more groups
	 */
	private async handleGhostSuggestionGroupFromQueue(): Promise<boolean> {
		const queue = GhostSuggestionPrefetchQueue.getInstance()

		// Check if there are more processed items in the queue
		if (queue.processedCount === 0) {
			console.log("No more edit groups in prefetch queue")
			return false
		}

		// Get the next edit group
		const nextItem = queue.dequeueProcessed()
		if (!nextItem) {
			console.log("No next edit group available")
			return false
		}

		try {
			// Convert queue item to our GhostSuggestions format and display it
			await this.displayEditGroupFromQueue(nextItem)

			// Render the new suggestion
			await this.render()

			return true
		} catch (error) {
			console.error("Error showing next edit group from queue:", error)
			return false
		}
	}

	/**
	 * Display an edit group from the prefetch queue
	 * This converts a Continue-style ProcessedItem to our GhostSuggestions format
	 */
	private async displayEditGroupFromQueue(item: any): Promise<void> {
		// TODO: This needs to be implemented based on how our GhostSuggestions system works
		// For now, just log the details
		// The actual implementation would need to:
		// 1. Convert the queue item's diff lines to our suggestion format
		// 2. Create appropriate GhostSuggestionEditOperation objects
		// 3. Update this.suggestions with the new group
		// 4. Position cursor at the edit location
		// This is a placeholder - the full integration would require adapting
		// Continue's DiffGroup format to our GhostSuggestions system
	}

	public async applyAllSuggestions() {
		if (!this.enabled) {
			return
		}
		if (!this.hasPendingSuggestions() || this.applicator.isLocked()) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_ACCEPT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.decorations.clearAll()

		// Use GhostEngine to apply via applicator
		await this.ghostEngine.apply(
			this.suggestions,
			editor.document.uri.toString(), // Convert to string
			this.applicator, // REQUIRED parameter
			"all",
		)

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

		// Move cursor to the selected group's location
		this.moveToSelectedGroup(editor, suggestionsFile)

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

		// Move cursor to the selected group's location
		this.moveToSelectedGroup(editor, suggestionsFile)

		await this.render()
	}

	/**
	 * Move cursor to the currently selected group's location for proper inline completion evaluation
	 */
	private moveToSelectedGroup(editor: vscode.TextEditor, suggestionsFile: GhostSuggestionFile): void {
		const groups: GhostSuggestionEditOperation[][] = suggestionsFile.getGroupsOperations()
		if (groups.length === 0) {
			return
		}
		const selectedGroupIndex = suggestionsFile.getSelectedGroup()
		if (selectedGroupIndex === null || selectedGroupIndex >= groups.length) {
			return
		}
		const group: GhostSuggestionEditOperation[] = groups[selectedGroupIndex]
		if (group.length === 0) {
			return
		}

		// Find the first operation on the earliest line for cursor positioning
		const firstOperation = group.reduce(
			(earliest: GhostSuggestionEditOperation, op: GhostSuggestionEditOperation) =>
				op.line < earliest.line ? op : earliest,
		)

		// Position cursor at the beginning of the line containing the first operation
		const line = Math.max(0, Math.min(firstOperation.line, editor.document.lineCount - 1))
		const character = 0 // Start of line for now - can be enhanced later

		const position = new vscode.Position(line, character)
		editor.selection = new vscode.Selection(position, position)
		editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
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
		if (!this.ghostEngine.loaded) {
			return "loading..."
		}
		return "ghost-engine" // GhostEngine abstracts away the specific model
	}

	private hasValidApiToken(): boolean {
		return this.ghostEngine.loaded
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
		this.cursorAnimation.wait()
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
		if (this.cancellationToken) {
			this.cancellationToken.abort()
		}
		if (this.autoTriggerTimer) {
			this.clearAutoTriggerTimer()
		}
		// Cancel request in engine
		this.ghostEngine.cancelRequest()
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

	// Ghost Support: Generate GhostSuggestionOutcome for telemetry and chaining
	private async generateGhostSuggestionOutcome(
		context: GhostSuggestionContext,
		strategyInfo: any,
		strategy: any,
		response: string,
		usageInfo: any,
		startTime: number,
	): Promise<GhostSuggestionOutcome | undefined> {
		if (!context.document || !context.range) {
			return undefined
		}

		try {
			// Extract completion using strategy
			const completion = strategy.extractCompletion ? strategy.extractCompletion(response) : response

			if (!completion.trim()) {
				return undefined
			}

			// Get original file content
			const originalContent = context.document.getText()

			// Calculate editable region using strategy
			const { editableStart, editableEnd } = strategy.calculateEditableRegion
				? strategy.calculateEditableRegion(context.document, context.range)
				: { editableStart: 0, editableEnd: originalContent.split("\n").length - 1 }

			// Generate diff lines using Myers algorithm
			const originalRegion = originalContent
				.split("\n")
				.slice(editableStart, editableEnd + 1)
				.join("\n")
			const diffLines = myersDiff(originalRegion, completion)

			// Calculate final cursor position
			const finalCursorPos = calculateFinalCursorPosition(
				context.range.start,
				editableStart,
				originalRegion,
				completion,
			)

			// Build prompt metadata if strategy supports it
			if (strategy.buildPromptMetadata) {
				this.promptMetadata = await strategy.buildPromptMetadata(context)
			}

			// Create GhostSuggestionOutcome using Continue's structure
			const outcome = createGhostSuggestionOutcome({
				completionId: this.taskId || crypto.randomUUID(),
				fileUri: context.document.uri.toString(),
				completion,
				modelProvider: usageInfo.modelProvider || "unknown",
				modelName: usageInfo.modelName || "unknown",
				elapsed: Date.now() - startTime,
				cursorPosition: {
					line: context.range.start.line,
					character: context.range.start.character,
				},
				editableRegionStartLine: editableStart,
				editableRegionEndLine: editableEnd,
				diffLines,
				prompt: strategyInfo.userPrompt,
				originalEditableRange: originalRegion,
				userEdits: this.promptMetadata?.userEdits || "",
				userExcerpts: this.promptMetadata?.userExcerpts || originalContent,
			})

			// Update final cursor position
			outcome.finalCursorPosition = finalCursorPos

			this.currentGhostSuggestionOutcome = outcome
			return outcome
		} catch (error) {
			console.error("Error generating GhostSuggestionOutcome:", error)
			return undefined
		}
	}

	/**
	 * Get cache performance metrics for monitoring
	 */
	public getCacheMetrics() {
		return this.ghostEngine.getCacheMetrics()
	}

	/**
	 * Get cache debug information
	 */
	public getCacheDebugInfo() {
		return this.ghostEngine.getCacheMetrics() // Engine doesn't have debug info method
	}

	/**
	 * Dispose of all resources used by the GhostProvider
	 */
	public dispose(): void {
		this.clearAutoTriggerTimer()
		this.cancelRequest()

		this.suggestions.clear()
		this.decorations.clearAll()

		// Clear the cache
		this.ghostEngine.clearCache()

		this.statusBar?.dispose()
		this.cursorAnimation.dispose()

		GhostProvider.instance = null // Reset singleton
	}
}
