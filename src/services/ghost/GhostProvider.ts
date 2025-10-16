import crypto from "crypto"
import * as vscode from "vscode"
import { t } from "../../i18n"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostStreamingParser } from "./GhostStreamingParser"
import { AutoTriggerStrategy } from "./strategies/AutoTriggerStrategy"
import { GhostModel } from "./GhostModel"
import { GhostWorkspaceEdit } from "./GhostWorkspaceEdit"
import { GhostDecorations } from "./GhostDecorations"
import { GhostInlineCompletionProvider } from "./GhostInlineCompletionProvider"
import { GhostSuggestionContext, GhostSuggestionEditOperation } from "./types"
import { GhostStatusBar } from "./GhostStatusBar"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"
import { GhostCodeLensProvider } from "./GhostCodeLensProvider"
import { GhostServiceSettings, TelemetryEventName } from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { GhostContext } from "./GhostContext"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { GhostGutterAnimation } from "./GhostGutterAnimation"
import { GhostCursor } from "./GhostCursor"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"
import { normalizeAutoTriggerDelayToMs } from "./utils/autocompleteDelayUtils"

export class GhostProvider {
	private static instance: GhostProvider | null = null
	private decorations: GhostDecorations
	private inlineCompletionProvider: GhostInlineCompletionProvider
	private inlineCompletionDisposable: vscode.Disposable | null = null
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private streamingParser: GhostStreamingParser
	private autoTriggerStrategy: AutoTriggerStrategy
	private workspaceEdit: GhostWorkspaceEdit
	private suggestions: GhostSuggestionsState = new GhostSuggestionsState()
	private cline: ClineProvider
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null
	private ghostContext: GhostContext
	private cursor: GhostCursor
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
	public codeLensProvider: GhostCodeLensProvider

	private ignoreController?: Promise<RooIgnoreController>

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.cline = cline

		// Register Internal Components
		this.decorations = new GhostDecorations()
		this.inlineCompletionProvider = new GhostInlineCompletionProvider(this.suggestions)
		this.documentStore = new GhostDocumentStore()
		this.streamingParser = new GhostStreamingParser()
		this.autoTriggerStrategy = new AutoTriggerStrategy()
		this.workspaceEdit = new GhostWorkspaceEdit()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new GhostModel()
		this.ghostContext = new GhostContext(this.documentStore)
		this.cursor = new GhostCursor()
		this.cursorAnimation = new GhostGutterAnimation(context)

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.codeLensProvider = new GhostCodeLensProvider()

		// Register inline completion provider
		this.registerInlineCompletionProvider()

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
		await ContextProxy.instance?.setValues?.({ ghostServiceSettings: this.settings })
		await this.cline.postStateToWebview()
	}

	public async load() {
		this.settings = this.loadSettings()
		await this.model.reload(this.settings, this.providerSettingsManager)
		this.cursorAnimation.updateSettings(this.settings || undefined)

		// Re-register inline completion provider if settings changed
		this.registerInlineCompletionProvider()

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
		if (this.workspaceEdit.isLocked()) {
			return
		}
		if (event.contentChanges.length === 0) {
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
		const { systemPrompt, userPrompt } = this.autoTriggerStrategy.getPrompts(context)
		if (this.isRequestCancelled) {
			return
		}

		if (!this.model.loaded) {
			this.stopProcessing()
			await this.load()
		}

		console.log("system", systemPrompt)
		console.log("userprompt", userPrompt)

		// Initialize the streaming parser
		this.streamingParser.initialize(context)

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

				// Process the text chunk through our streaming parser
				const parseResult = this.streamingParser.processChunk(chunk.text)

				if (parseResult.hasNewSuggestions) {
					// Update our suggestions with the new parsed results
					this.suggestions = parseResult.suggestions

					// Update inline completion provider with new suggestions
					this.inlineCompletionProvider.updateSuggestions(this.suggestions)

					// If this is the first suggestion, show it immediately
					if (!hasShownFirstSuggestion && this.suggestions.hasSuggestions()) {
						hasShownFirstSuggestion = true
						this.stopProcessing() // Stop the loading animation
						this.selectClosestSuggestion()
						void this.render() // Render asynchronously to not block streaming
					} else if (hasShownFirstSuggestion) {
						// Update existing suggestions
						this.selectClosestSuggestion()
						void this.render() // Update UI asynchronously
					}
				}

				// If the response appears complete, finalize
				if (parseResult.isComplete && hasShownFirstSuggestion) {
					this.selectClosestSuggestion()
					void this.render()
				}
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
			const finalParseResult = this.streamingParser.finishStream()
			if (finalParseResult.hasNewSuggestions && !hasShownFirstSuggestion) {
				// Handle case where sanitization produced suggestions
				this.suggestions = finalParseResult.suggestions
				hasShownFirstSuggestion = true
				this.stopProcessing()
				this.selectClosestSuggestion()
				await this.render()
			} else if (finalParseResult.hasNewSuggestions && hasShownFirstSuggestion) {
				// Update existing suggestions with sanitized results
				this.suggestions = finalParseResult.suggestions
				this.selectClosestSuggestion()
				await this.render()
			}

			// If we never showed any suggestions, there might have been an issue
			if (!hasShownFirstSuggestion) {
				console.warn("No suggestions were generated during streaming")
				this.stopProcessing()
			}

			// Final render to ensure everything is up to date
			this.selectClosestSuggestion()
			await this.render()
		} catch (error) {
			console.error("Error in streaming generation:", error)
			this.stopProcessing()
			throw error
		}
	}

	/**
	 * Find common prefix between two strings
	 */
	private findCommonPrefix(str1: string, str2: string): string {
		let i = 0
		while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
			i++
		}
		return str1.substring(0, i)
	}

	/**
	 * Check if this is a modification where the deletion is just to remove a placeholder
	 * This happens when LLM responds with search pattern of just <<<AUTOCOMPLETE_HERE>>>
	 * but the context included more content with the placeholder
	 */
	private shouldTreatAsAddition(
		deleteOps: GhostSuggestionEditOperation[],
		addOps: GhostSuggestionEditOperation[],
	): boolean {
		if (deleteOps.length === 0 || addOps.length === 0) return false

		const deletedContent = deleteOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")
		const addedContent = addOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")

		// Case 1: Added content starts with deleted content AND has meaningful extension
		if (addedContent.startsWith(deletedContent)) {
			// Always return false here - let the common prefix logic handle this
			// This ensures proper inline completion with suffix only
			return false
		}

		// Case 2: Added content starts with newline - indicates LLM wants to add content after current line
		// This is a universal indicator regardless of programming language
		return addedContent.startsWith("\n") || addedContent.startsWith("\r\n")
	}

	/**
	 * Check if a deletion group is placeholder-only and should be treated as addition
	 */
	private isPlaceholderOnlyDeletion(group: GhostSuggestionEditOperation[]): boolean {
		const deleteOps = group.filter((op) => op.type === "-")
		if (deleteOps.length === 0) return false

		const deletedContent = deleteOps
			.map((op) => op.content)
			.join("\n")
			.trim()
		return deletedContent === "<<<AUTOCOMPLETE_HERE>>>"
	}

	/**
	 * Get effective group for inline completion decision (handles placeholder-only deletions)
	 */
	private getEffectiveGroupForInline(
		file: any,
	): { group: GhostSuggestionEditOperation[]; type: "+" | "/" | "-" } | null {
		const groups = file.getGroupsOperations()
		const selectedGroupIndex = file.getSelectedGroup()

		if (selectedGroupIndex === null || selectedGroupIndex >= groups.length) {
			return null
		}

		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		// Check if this is a deletion that should be treated as addition
		if (selectedGroupType === "-") {
			// Case 1: Placeholder-only deletion
			if (this.isPlaceholderOnlyDeletion(selectedGroup)) {
				if (selectedGroupIndex + 1 < groups.length) {
					const nextGroup = groups[selectedGroupIndex + 1]
					const nextGroupType = file.getGroupType(nextGroup)

					if (nextGroupType === "+") {
						return { group: nextGroup, type: "+" }
					}
				}
				return null
			}

			// Case 2: Deletion followed by addition - check what type of handling it needs
			if (selectedGroupIndex + 1 < groups.length) {
				const nextGroup = groups[selectedGroupIndex + 1]
				const nextGroupType = file.getGroupType(nextGroup)

				if (nextGroupType === "+") {
					const deleteOps = selectedGroup.filter((op: GhostSuggestionEditOperation) => op.type === "-")
					const addOps = nextGroup.filter((op: GhostSuggestionEditOperation) => op.type === "+")

					const deletedContent = deleteOps
						.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
						.map((op: GhostSuggestionEditOperation) => op.content)
						.join("\n")
					const addedContent = addOps
						.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
						.map((op: GhostSuggestionEditOperation) => op.content)
						.join("\n")

					// Check if added content starts with deleted content (common prefix scenario)
					if (addedContent.startsWith(deletedContent)) {
						// Create synthetic modification group for proper common prefix handling
						const syntheticGroup = [...selectedGroup, ...nextGroup]
						return { group: syntheticGroup, type: "/" }
					}

					// Check if this should be treated as addition after existing content
					if (this.shouldTreatAsAddition(deleteOps, addOps)) {
						return { group: nextGroup, type: "+" }
					}
				}
			}
		}

		return { group: selectedGroup, type: selectedGroupType }
	}

	/**
	 * Determine if a group should use inline completion instead of SVG decoration
	 * Centralized logic to ensure consistency across render() and displaySuggestions()
	 */
	private shouldUseInlineCompletion(
		selectedGroup: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
		cursorLine: number,
		file: any,
	): boolean {
		// Deletions never use inline
		if (groupType === "-") {
			return false
		}

		// Calculate target line and distance
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		let targetLine: number

		if (groupType === "+") {
			const firstOp = selectedGroup[0]
			targetLine = firstOp.line + offset.removed
		} else {
			// groupType === "/"
			const deleteOp = selectedGroup.find((op: any) => op.type === "-")
			targetLine = deleteOp ? deleteOp.line + offset.added : selectedGroup[0].line
		}

		const distanceFromCursor = Math.abs(cursorLine - targetLine)

		// Must be within 5 lines
		if (distanceFromCursor > 5) {
			return false
		}

		// For pure additions, use inline
		if (groupType === "+") {
			return true
		}

		// For modifications, check if there's a common prefix or empty deleted content
		const deleteOps = selectedGroup.filter((op) => op.type === "-")
		const addOps = selectedGroup.filter((op) => op.type === "+")

		if (deleteOps.length === 0 || addOps.length === 0) {
			return false
		}

		const deletedContent = deleteOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")
		const addedContent = addOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")

		// If deleted content is empty or just the placeholder, treat as pure addition
		const trimmedDeleted = deletedContent.trim()
		if (trimmedDeleted.length === 0 || trimmedDeleted === "<<<AUTOCOMPLETE_HERE>>>") {
			return true
		}

		// Check if this should be treated as addition (LLM wants to add after existing content)
		if (this.shouldTreatAsAddition(deleteOps, addOps)) {
			return true
		}

		// Check for common prefix
		const commonPrefix = this.findCommonPrefix(deletedContent, addedContent)
		return commonPrefix.length > 0
	}

	private async render() {
		await this.updateGlobalContext()

		// Update inline completion provider with current suggestions
		this.inlineCompletionProvider.updateSuggestions(this.suggestions)

		// Determine if we should trigger inline suggestions using centralized logic
		let shouldTriggerInline = false
		const editor = vscode.window.activeTextEditor
		if (editor && this.suggestions.hasSuggestions()) {
			const file = this.suggestions.getFile(editor.document.uri)
			if (file) {
				const effectiveGroup = this.getEffectiveGroupForInline(file)
				if (effectiveGroup) {
					shouldTriggerInline = this.shouldUseInlineCompletion(
						effectiveGroup.group,
						effectiveGroup.type,
						editor.selection.active.line,
						file,
					)
				}
			}
		}

		// Only trigger inline suggestions if selected group should use them
		if (shouldTriggerInline) {
			try {
				await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger")
			} catch {
				// Silently fail if command is not available
			}
		}

		// Display decorations for appropriate groups
		await this.displaySuggestions()
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

		// If we selected a placeholder-only deletion, try to select next valid group
		const selectedGroupIndex = file.getSelectedGroup()
		if (selectedGroupIndex !== null) {
			const groups = file.getGroupsOperations()
			const selectedGroup = groups[selectedGroupIndex]
			const selectedGroupType = file.getGroupType(selectedGroup)

			if (selectedGroupType === "-" && this.isPlaceholderOnlyDeletion(selectedGroup)) {
				// Try to select a non-placeholder group
				const originalSelection = selectedGroupIndex
				let attempts = 0
				const maxAttempts = groups.length

				while (attempts < maxAttempts) {
					file.selectNextGroup()
					attempts++
					const currentSelection = file.getSelectedGroup()

					if (currentSelection !== null && currentSelection < groups.length) {
						const currentGroup = groups[currentSelection]
						const currentGroupType = file.getGroupType(currentGroup)

						// If it's not a placeholder-only deletion, we're done
						if (!(currentGroupType === "-" && this.isPlaceholderOnlyDeletion(currentGroup))) {
							break
						}
					}
				}
			}
		}
	}

	public async displaySuggestions() {
		if (!this.enabled) {
			return
		}
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		const file = this.suggestions.getFile(editor.document.uri)
		if (!file) {
			this.decorations.clearAll()
			return
		}

		const groups = file.getGroupsOperations()
		if (groups.length === 0) {
			this.decorations.clearAll()
			return
		}

		const selectedGroupIndex = file.getSelectedGroup()
		if (selectedGroupIndex === null) {
			this.decorations.clearAll()
			return
		}

		// Get the effective group for inline completion decision
		const effectiveGroup = this.getEffectiveGroupForInline(file)
		const selectedGroupUsesInlineCompletion = effectiveGroup
			? this.shouldUseInlineCompletion(
					effectiveGroup.group,
					effectiveGroup.type,
					editor.selection.active.line,
					file,
				)
			: false

		// Determine which group indices to skip
		const skipGroupIndices: number[] = []
		if (selectedGroupUsesInlineCompletion) {
			// Always skip the selected group
			skipGroupIndices.push(selectedGroupIndex)

			// If we're using a synthetic modification group (deletion + addition),
			// skip both the deletion group AND the addition group
			const selectedGroup = groups[selectedGroupIndex]
			const selectedGroupType = file.getGroupType(selectedGroup)

			if (selectedGroupType === "-" && selectedGroupIndex + 1 < groups.length) {
				const nextGroup = groups[selectedGroupIndex + 1]
				const nextGroupType = file.getGroupType(nextGroup)

				// If next group is addition and they should be combined, skip both
				if (nextGroupType === "+") {
					const deleteOps = selectedGroup.filter((op: GhostSuggestionEditOperation) => op.type === "-")
					const addOps = nextGroup.filter((op: GhostSuggestionEditOperation) => op.type === "+")

					const deletedContent = deleteOps.map((op: GhostSuggestionEditOperation) => op.content).join("\n")
					const addedContent = addOps.map((op: GhostSuggestionEditOperation) => op.content).join("\n")

					// If they have common prefix or other addition criteria, skip the addition group too
					if (
						addedContent.startsWith(deletedContent) ||
						deletedContent === "<<<AUTOCOMPLETE_HERE>>>" ||
						addedContent.startsWith("\n") ||
						addedContent.startsWith("\r\n")
					) {
						skipGroupIndices.push(selectedGroupIndex + 1)
					}
				}
			}
		}

		// Always show decorations, but skip groups that use inline completion
		await this.decorations.displaySuggestions(this.suggestions, skipGroupIndices)
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
		this.suggestions.clear()

		// Update inline completion provider
		this.inlineCompletionProvider.updateSuggestions(this.suggestions)

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
		const selectedGroupIndex = suggestionsFile.getSelectedGroup()
		if (selectedGroupIndex === null) {
			await this.cancelSuggestions()
			return
		}

		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_ACCEPT_SUGGESTION, {
			taskId: this.taskId,
		})
		this.decorations.clearAll()
		await this.workspaceEdit.applySelectedSuggestions(this.suggestions)
		this.cursor.moveToAppliedGroup(this.suggestions)

		// For placeholder-only deletions, we need to apply the associated addition instead
		const groups = suggestionsFile.getGroupsOperations()
		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = suggestionsFile.getGroupType(selectedGroup)

		// Simply delete the selected group - the workspace edit will handle the actual application
		suggestionsFile.deleteSelectedGroup()

		suggestionsFile.selectClosestGroup(editor.selection)
		this.suggestions.validateFiles()
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

		// Navigate to next valid group (skip placeholder-only deletions)
		const originalSelection = suggestionsFile.getSelectedGroup()
		let attempts = 0
		const maxAttempts = suggestionsFile.getGroupsOperations().length
		let foundValidGroup = false

		while (attempts < maxAttempts && !foundValidGroup) {
			suggestionsFile.selectNextGroup()
			attempts++
			const currentSelection = suggestionsFile.getSelectedGroup()

			// Check if current group is placeholder-only deletion
			if (currentSelection !== null) {
				const groups = suggestionsFile.getGroupsOperations()
				const currentGroup = groups[currentSelection]
				const currentGroupType = suggestionsFile.getGroupType(currentGroup)

				// If it's not a placeholder-only deletion, we found a valid group
				if (!(currentGroupType === "-" && this.isPlaceholderOnlyDeletion(currentGroup))) {
					foundValidGroup = true
				}
			}

			// Safety check to avoid infinite loop
			if (currentSelection === originalSelection) {
				break
			}
		}

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

		// Navigate to previous valid group (skip placeholder-only deletions)
		const originalSelection = suggestionsFile.getSelectedGroup()
		let attempts = 0
		const maxAttempts = suggestionsFile.getGroupsOperations().length
		let foundValidGroup = false

		while (attempts < maxAttempts && !foundValidGroup) {
			suggestionsFile.selectPreviousGroup()
			attempts++
			const currentSelection = suggestionsFile.getSelectedGroup()

			// Check if current group is placeholder-only deletion
			if (currentSelection !== null) {
				const groups = suggestionsFile.getGroupsOperations()
				const currentGroup = groups[currentSelection]
				const currentGroupType = suggestionsFile.getGroupType(currentGroup)

				// If it's not a placeholder-only deletion, we found a valid group
				if (!(currentGroupType === "-" && this.isPlaceholderOnlyDeletion(currentGroup))) {
					foundValidGroup = true
				}
			}

			// Safety check to avoid infinite loop
			if (currentSelection === originalSelection) {
				break
			}
		}

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
		// Reset streaming parser when cancelling
		this.streamingParser.reset()
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
	 * Register or re-register the inline completion provider
	 */
	private registerInlineCompletionProvider(): void {
		// Dispose existing registration
		if (this.inlineCompletionDisposable) {
			this.inlineCompletionDisposable.dispose()
			this.inlineCompletionDisposable = null
		}

		// Register inline completion provider for all languages
		this.inlineCompletionDisposable = vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: "**" },
			this.inlineCompletionProvider,
		)
	}

	/**
	 * Dispose of all resources used by the GhostProvider
	 */
	public dispose(): void {
		this.clearAutoTriggerTimer()
		this.cancelRequest()

		this.suggestions.clear()
		this.decorations.clearAll()

		// Dispose inline completion provider
		if (this.inlineCompletionDisposable) {
			this.inlineCompletionDisposable.dispose()
			this.inlineCompletionDisposable = null
		}
		this.inlineCompletionProvider.dispose()

		this.statusBar?.dispose()
		this.cursorAnimation.dispose()

		this.disposeIgnoreController()

		GhostProvider.instance = null // Reset singleton
	}
}
