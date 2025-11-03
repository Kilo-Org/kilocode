import * as vscode from "vscode"
import { AutocompleteModel } from "./AutocompleteModel"
import {
	AUTOCOMPLETE_PROVIDER_MODELS,
	AutocompleteProviderKey,
	GhostServiceSettings,
	modelIdKeysByProvider,
	ProviderSettingsEntry,
} from "@roo-code/types"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { MinimalConfigProvider } from "../continuedev/core/autocomplete/MinimalConfig"
import { VsCodeIde } from "../continuedev/core/vscode-test-harness/src/VSCodeIde"
import { ContinueCompletionProvider } from "../continuedev/core/vscode-test-harness/src/autocomplete/completionProvider"
import OpenRouter from "../continuedev/core/llm/llms/OpenRouter"

export class AutocompleteProvider {
	private static instance: AutocompleteProvider | null = null
	private model: AutocompleteModel
	private providerSettingsManager: ProviderSettingsManager
	private settings: GhostServiceSettings | null = null

	private enabled: boolean = true
	private taskId: string | null = null
	private isProcessing: boolean = false
	private isRequestCancelled: boolean = false

	// VSCode Providers
	public inlineCompletionProvider: any

	private constructor(
		private context: vscode.ExtensionContext,
		private cline: ClineProvider,
	) {
		// Register Internal Components
		this.providerSettingsManager = new ProviderSettingsManager(context)
		this.model = new AutocompleteModel()

		void this.load()
	}

	// Singleton Management
	public static initialize(context: vscode.ExtensionContext, cline: ClineProvider): AutocompleteProvider {
		if (AutocompleteProvider.instance) {
			throw new Error("AutocompleteProvider is already initialized. Use getInstance() instead.")
		}
		AutocompleteProvider.instance = new AutocompleteProvider(context, cline)
		return AutocompleteProvider.instance
	}

	public static getInstance(): AutocompleteProvider {
		if (!AutocompleteProvider.instance) {
			throw new Error("AutocompleteProvider is not initialized. Call initialize() first.")
		}
		return AutocompleteProvider.instance
	}

	// Settings Management
	private loadSettings() {
		const state = ContextProxy.instance.getValues()
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
		await ContextProxy.instance.setValues({ ghostServiceSettings: settingsWithModelInfo })
		await this.cline.postStateToWebview()
	}

	private async loadCodeCompletion() {
		try {
			// The model.reload() has already loaded the profile, so we can get the ILLM
			const llm = this.model.getILLM()

			if (!llm) {
				console.warn("[AutocompleteProvider] No valid autocomplete provider found")
				return
			}

			// Register the Continue completion provider with the selected LLM
			const minimalConfigProvider = new MinimalConfigProvider({
				selectedModelByRole: {
					autocomplete: llm,
				},
			})
			const ide = new VsCodeIde(this.context)
			const usingFullFileDiff = false
			const continueProvider = new ContinueCompletionProvider(minimalConfigProvider, ide, usingFullFileDiff)
			this.context.subscriptions.push(
				vscode.languages.registerInlineCompletionItemProvider([{ pattern: "**" }], continueProvider),
			)

			console.log("[AutocompleteProvider] Successfully registered autocomplete")
		} catch (error) {
			console.error("[AutocompleteProvider] Error loading code completion:", error)
		}
	}

	public async load() {
		this.settings = this.loadSettings()
		await this.model.reload(this.providerSettingsManager)
		await this.saveSettings()
		this.loadCodeCompletion()
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

	/**
	 * Dispose of all resources used by the GhostProvider
	 */
	public dispose(): void {
		AutocompleteProvider.instance = null // Reset singleton
	}
}
