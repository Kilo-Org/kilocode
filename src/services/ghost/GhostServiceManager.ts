import * as vscode from "vscode"
import { t } from "../../i18n"
import { GhostDocumentStore } from "./GhostDocumentStore"
import { GhostModel } from "./GhostModel"
import { GhostStatusBar } from "./GhostStatusBar"
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

export class GhostServiceManager {
	private static instance: GhostServiceManager | null = null
	private documentStore: GhostDocumentStore
	private model: GhostModel
	private cline: ClineProvider
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null
	private ghostContext: GhostContext
	private cursorAnimation: GhostGutterAnimation

	private enabled: boolean = true
	private isProcessing: boolean = false

	// Status bar integration
	private statusBar: GhostStatusBar | null = null
	private sessionCost: number = 0
	private lastCompletionCost: number = 0

	// VSCode Providers
	public codeActionProvider: GhostCodeActionProvider
	public inlineCompletionProvider: GhostInlineCompletionProvider

	private ignoreController?: Promise<RooIgnoreController>

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.cline = cline

		// Register Internal Components
		this.documentStore = new GhostDocumentStore()
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new GhostModel()
		this.ghostContext = new GhostContext(this.documentStore)
		this.cursorAnimation = new GhostGutterAnimation(context)

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.inlineCompletionProvider = new GhostInlineCompletionProvider(
			this.model,
			this.updateCostTracking.bind(this),
			this.ghostContext,
			this.cursorAnimation,
		)

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
	public static initialize(context: vscode.ExtensionContext, cline: ClineProvider): GhostServiceManager {
		if (GhostServiceManager.instance) {
			throw new Error("GhostServiceManager is already initialized. Use getInstance() instead.")
		}
		GhostServiceManager.instance = new GhostServiceManager(context, cline)
		return GhostServiceManager.instance
	}

	public static getInstance(): GhostServiceManager {
		if (!GhostServiceManager.instance) {
			throw new Error("GhostServiceManager is not initialized. Call initialize() first.")
		}
		return GhostServiceManager.instance
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
	}

	private async onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): Promise<void> {
		if (!this.enabled) {
			return
		}
		this.cursorAnimation.update()
	}

	private async onDidChangeActiveTextEditor(editor: vscode.TextEditor | undefined) {
		if (!this.enabled || !editor) {
			return
		}
		// Update global context when switching editors
		await this.updateGlobalContext()
	}

	private async updateGlobalContext() {
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

	private updateCostTracking(
		cost: number,
		inputTokens: number,
		outputTokens: number,
		cacheWriteTokens: number,
		cacheReadTokens: number,
	): void {
		this.lastCompletionCost = cost
		this.sessionCost += cost
		this.updateStatusBar()

		// Send telemetry
		TelemetryService.instance.captureEvent(TelemetryEventName.LLM_COMPLETION, {
			inputTokens,
			outputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			cost,
			service: "INLINE_ASSIST",
		})
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

	private stopProcessing() {
		this.cursorAnimation.hide()
		this.isProcessing = false
		this.updateGlobalContext()
	}

	public cancelRequest() {
		this.stopProcessing()
		this.inlineCompletionProvider.cancelRequest()
	}

	/**
	 * Dispose of all resources used by the GhostServiceManager
	 */
	public dispose(): void {
		this.cancelRequest()

		this.statusBar?.dispose()
		this.cursorAnimation.dispose()

		this.disposeIgnoreController()

		GhostServiceManager.instance = null // Reset singleton
	}
}
