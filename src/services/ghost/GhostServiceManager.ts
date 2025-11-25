import crypto from "crypto"
import * as vscode from "vscode"
import { t } from "../../i18n"
import { GhostModel } from "./GhostModel"
import { GhostStatusBar } from "./GhostStatusBar"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"
import { GhostInlineCompletionProvider } from "./classic-auto-complete/GhostInlineCompletionProvider"
import { GhostContextProvider } from "./classic-auto-complete/GhostContextProvider"
import { NewAutocompleteProvider } from "./new-auto-complete/NewAutocompleteProvider"
import { GhostServiceSettings, TelemetryEventName } from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { RooIgnoreController } from "../../core/ignore/RooIgnoreController"

export class GhostServiceManager {
	private static instance: GhostServiceManager | null = null
	private readonly model: GhostModel
	private readonly cline: ClineProvider
	private readonly context: vscode.ExtensionContext
	private settings: GhostServiceSettings | null = null
	private readonly ghostContextProvider: GhostContextProvider

	private taskId: string | null = null

	// Status bar integration
	private statusBar: GhostStatusBar | null = null
	private sessionCost: number = 0
	private lastCompletionCost: number = 0

	// VSCode Providers
	public readonly codeActionProvider: GhostCodeActionProvider
	public readonly inlineCompletionProvider: GhostInlineCompletionProvider
	private newAutocompleteProvider: NewAutocompleteProvider | null = null
	private inlineCompletionProviderDisposable: vscode.Disposable | null = null

	private ignoreController?: Promise<RooIgnoreController>

	private constructor(context: vscode.ExtensionContext, cline: ClineProvider) {
		this.context = context
		this.cline = cline

		// Register Internal Components
		this.model = new GhostModel()

		this.ignoreController = (async () => {
			const ignoreController = new RooIgnoreController(cline.cwd)
			await ignoreController.initialize()
			return ignoreController
		})()

		this.ghostContextProvider = new GhostContextProvider(this.context, this.model, this.ignoreController)

		// Register the providers
		this.codeActionProvider = new GhostCodeActionProvider()
		this.inlineCompletionProvider = new GhostInlineCompletionProvider(
			this.model,
			this.updateCostTracking.bind(this),
			() => this.settings,
			this.ghostContextProvider,
			this.ignoreController,
		)

		void this.load()
	}

	// Singleton Management
	public static initialize(context: vscode.ExtensionContext, cline: ClineProvider): GhostServiceManager {
		if (GhostServiceManager.instance) {
			throw new Error(
				"GhostServiceManager is already initialized. Restart VS code, or change this to return the cached instance.",
			)
		}
		GhostServiceManager.instance = new GhostServiceManager(context, cline)
		return GhostServiceManager.instance
	}

	public async load() {
		await this.cline.providerSettingsManager.initialize() // avoid race condition with settings migrations
		await this.model.reload(this.cline.providerSettingsManager)

		this.settings = ContextProxy.instance.getGlobalState("ghostServiceSettings") ?? {
			enableQuickInlineTaskKeybinding: true,
			enableSmartInlineTaskKeybinding: true,
		}
		// 1% rollout: auto-enable autocomplete for a small subset of logged-in KiloCode users
		// who have never explicitly toggled enableAutoTrigger.
		if (this.settings.enableAutoTrigger == undefined) {
			this.settings.enableAutoTrigger = true
		}

		await this.updateGlobalContext()
		this.updateStatusBar()
		await this.updateInlineCompletionProviderRegistration()
		const settingsWithModelInfo = {
			...this.settings,
			provider: this.getCurrentProviderName(),
			model: this.getCurrentModelName(),
		}
		await ContextProxy.instance.setValues({ ghostServiceSettings: settingsWithModelInfo })
		await this.cline.postStateToWebview()
	}

	private async updateInlineCompletionProviderRegistration() {
		const shouldBeRegistered = this.settings?.enableAutoTrigger ?? false

		// First, dispose any existing registration
		if (this.inlineCompletionProviderDisposable) {
			this.inlineCompletionProviderDisposable.dispose()
			this.inlineCompletionProviderDisposable = null
		}
		if (this.newAutocompleteProvider && (!shouldBeRegistered || !this.settings?.useNewAutocomplete)) {
			// Dispose new autocomplete provider if registration is disabled
			this.newAutocompleteProvider.dispose()
			this.newAutocompleteProvider = null
		}

		if (!shouldBeRegistered) return

		if (this.settings?.useNewAutocomplete) {
			// Initialize new autocomplete provider if not already created, otherwise reload
			this.newAutocompleteProvider ??= new NewAutocompleteProvider(this.context, this.cline)
			await this.newAutocompleteProvider.load()
			// New autocomplete provider registers itself internally
		} else {
			// Register classic provider
			this.inlineCompletionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
				{ scheme: "file" },
				this.inlineCompletionProvider,
			)
			this.context.subscriptions.push(this.inlineCompletionProviderDisposable)
		}
	}

	public async disable() {
		const settings = ContextProxy.instance.getGlobalState("ghostServiceSettings") ?? {}
		await ContextProxy.instance.setValues({
			ghostServiceSettings: {
				...settings,
				enableAutoTrigger: false,
				enableSmartInlineTaskKeybinding: false,
				enableQuickInlineTaskKeybinding: false,
			},
		})

		TelemetryService.instance.captureEvent(TelemetryEventName.GHOST_SERVICE_DISABLED)

		await this.load()
	}

	private async disposeIgnoreController() {
		if (this.ignoreController) {
			const ignoreController = this.ignoreController
			delete this.ignoreController
			;(await ignoreController).dispose()
		}
	}

	public async codeSuggestion() {
		const editor = vscode.window.activeTextEditor
		if (!editor) {
			return
		}

		this.taskId = crypto.randomUUID()
		TelemetryService.instance.captureEvent(TelemetryEventName.INLINE_ASSIST_AUTO_TASK, {
			taskId: this.taskId,
		})

		const document = editor.document

		// Check if using new autocomplete
		if (this.settings?.useNewAutocomplete) {
			// New autocomplete doesn't support manual code suggestion yet
			// Just return for now
			return
		}

		// Ensure model is loaded
		if (!this.model.loaded) {
			await this.load()
		}

		// Call the inline completion provider directly with manual trigger context
		const position = editor.selection.active
		const context: vscode.InlineCompletionContext = {
			triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
			selectedCompletionInfo: undefined,
		}
		const tokenSource = new vscode.CancellationTokenSource()

		try {
			const completions = await this.inlineCompletionProvider.provideInlineCompletionItems_Internal(
				document,
				position,
				context,
				tokenSource.token,
			)

			// If we got completions, directly insert the first one
			if (completions && (Array.isArray(completions) ? completions.length > 0 : completions.items.length > 0)) {
				const items = Array.isArray(completions) ? completions : completions.items
				const firstCompletion = items[0]

				if (firstCompletion && firstCompletion.insertText) {
					const insertText =
						typeof firstCompletion.insertText === "string"
							? firstCompletion.insertText
							: firstCompletion.insertText.value

					await editor.edit((editBuilder) => {
						editBuilder.insert(position, insertText)
					})
				}
			}
		} finally {
			tokenSource.dispose()
		}
	}

	private async updateGlobalContext() {
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
		this.statusBar = new GhostStatusBar({
			enabled: false,
			model: "loading...",
			provider: "loading...",
			hasValidToken: false,
			totalSessionCost: 0,
			lastCompletionCost: 0,
		})
	}

	private getCurrentModelName(): string | undefined {
		if (!this.model.loaded) {
			return
		}
		return this.model.getModelName()
	}

	private getCurrentProviderName(): string | undefined {
		if (!this.model.loaded) {
			return
		}
		return this.model.getProviderDisplayName()
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
			taskId: this.taskId,
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
			profileName: this.model.profileName,
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

	/**
	 * Dispose of all resources used by the GhostServiceManager
	 */
	public dispose(): void {
		this.statusBar?.dispose()

		// Dispose inline completion provider registration
		if (this.inlineCompletionProviderDisposable) {
			this.inlineCompletionProviderDisposable.dispose()
			this.inlineCompletionProviderDisposable = null
		}

		// Dispose inline completion provider resources
		this.inlineCompletionProvider.dispose()

		// Dispose new autocomplete provider if it exists
		if (this.newAutocompleteProvider) {
			this.newAutocompleteProvider.dispose()
			this.newAutocompleteProvider = null
		}

		void this.disposeIgnoreController()

		GhostServiceManager.instance = null // Reset singleton
	}
}
