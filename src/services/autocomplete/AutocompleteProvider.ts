import * as vscode from "vscode"
import { KiloCodeIDEAdapter } from "./KiloCodeIDEAdapter"
import { KiloCodeConfigAdapter } from "./KiloCodeConfigAdapter"
import { ApiHandler, buildApiHandler } from "../../api"
import { ProviderSettings } from "../../shared/api"
import { CompletionCache } from "./CompletionCache"
import { ContextGatherer } from "./ContextGatherer"
import { PromptRenderer } from "./PromptRenderer"
import { CompletionStreamer } from "./CompletionStreamer"

/**
 * Provider for autocomplete functionality
 */
export class AutocompleteProvider {
	private apiHandler: ApiHandler | null = null
	private enabled: boolean = true
	private cache: CompletionCache
	private contextGatherer: ContextGatherer
	private promptRenderer: PromptRenderer
	private completionStreamer: CompletionStreamer | null = null
	private ide: KiloCodeIDEAdapter
	private config: KiloCodeConfigAdapter
	private activeCompletionId: string | null = null
	private debounceTimeout: NodeJS.Timeout | null = null
	private debounceDelay: number = 150

	constructor() {
		this.ide = new KiloCodeIDEAdapter()
		this.config = new KiloCodeConfigAdapter()
		this.cache = new CompletionCache()
		this.contextGatherer = new ContextGatherer(this.ide)
		this.promptRenderer = new PromptRenderer()
	}

	/**
	 * Register the autocomplete provider with VSCode
	 */
	register(context: vscode.ExtensionContext) {
		// Register configuration for autocomplete
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("kilo-code.autocomplete")) {
					// Reset API handler to pick up new configuration
					this.apiHandler = null
					this.completionStreamer = null

					// Update debounce delay
					const config = vscode.workspace.getConfiguration("kilo-code")
					this.debounceDelay = config.get("autocomplete.debounceDelay") || 150
				}
			}),
		)

		// Register status bar item to show autocomplete status
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
		statusBarItem.text = "$(sparkle) Autocomplete"
		statusBarItem.tooltip = "Kilo Code Autocomplete"
		statusBarItem.command = "kilo-code.toggleAutocomplete"
		statusBarItem.show()
		context.subscriptions.push(statusBarItem)

		// Register command to toggle autocomplete
		context.subscriptions.push(
			vscode.commands.registerCommand("kilo-code.toggleAutocomplete", () => {
				this.enabled = !this.enabled
				statusBarItem.text = this.enabled ? "$(sparkle) Autocomplete" : "$(circle-slash) Autocomplete"
				vscode.window.showInformationMessage(`Autocomplete ${this.enabled ? "enabled" : "disabled"}`)
			}),
		)

		// Register as VSCode completion provider
		const disposable = vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: "**" },
			{
				provideInlineCompletionItems: async (document, position, context, token) => {
					// Check if autocomplete is enabled
					if (!this.enabled) {
						return null
					}

					// Check if autocomplete is disabled for this file
					const config = vscode.workspace.getConfiguration("kilo-code")
					const disabledPatterns = config.get<string>("autocomplete.disableInFiles") || ""
					const patterns = disabledPatterns
						.split(",")
						.map((p) => p.trim())
						.filter(Boolean)

					if (
						patterns.some((pattern) => {
							const glob = new vscode.RelativePattern(
								vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
								pattern,
							)
							return vscode.languages.match({ pattern: glob }, document)
						})
					) {
						return null
					}

					// Cancel any active completion
					if (this.activeCompletionId) {
						this.completionStreamer?.cancelCompletion(this.activeCompletionId)
						this.activeCompletionId = null
					}

					// Clear any existing debounce timeout
					if (this.debounceTimeout) {
						clearTimeout(this.debounceTimeout)
					}

					// Create a new completion with debounce
					return new Promise((resolve) => {
						this.debounceTimeout = setTimeout(async () => {
							try {
								// Initialize API handler if needed
								if (!this.apiHandler) {
									await this.initializeApiHandler()

									if (!this.apiHandler) {
										resolve(null)
										return
									}

									// Initialize completion streamer
									this.completionStreamer = new CompletionStreamer(
										this.apiHandler,
										this.promptRenderer,
									)
								}

								// Check if we have a cached completion
								const cursorIndex = document.offsetAt(position)
								const cachedCompletion = this.cache.get(
									document.uri.toString(),
									document.getText(),
									cursorIndex,
								)

								if (cachedCompletion) {
									const completionItem = new vscode.InlineCompletionItem(
										cachedCompletion,
										new vscode.Range(position, position),
									)
									resolve([completionItem])
									return
								}

								// Generate a unique ID for this completion
								const completionId = crypto.randomUUID()
								this.activeCompletionId = completionId

								// Get configuration
								const { config: conf } = await this.config.loadConfig()
								const useImports = conf?.tabAutocompleteOptions?.useImports || false
								const useDefinitions = conf?.tabAutocompleteOptions?.onlyMyCode || false
								const multilineCompletions =
									conf?.tabAutocompleteOptions?.multilineCompletions || "auto"

								// Gather context
								const codeContext = await this.contextGatherer.gatherContext(
									document,
									position,
									useImports,
									useDefinitions,
								)

								// Render prompt
								const prompt = this.promptRenderer.renderPrompt(codeContext, {
									language: document.languageId,
									includeImports: useImports,
									includeDefinitions: useDefinitions,
									multilineCompletions: multilineCompletions as any,
								})

								const systemPrompt = this.promptRenderer.renderSystemPrompt()

								// Create an abort controller that will be cancelled if the token is cancelled
								const abortController = new AbortController()
								token.onCancellationRequested(() => {
									abortController.abort()
									if (this.activeCompletionId === completionId) {
										this.activeCompletionId = null
									}

									// Also cancel the completion in the streamer
									this.completionStreamer?.cancelCompletion(completionId)
								})

								// Stream the completion
								let latestCompletion = ""

								// Safety check - this should never happen since we initialize it above
								if (!this.completionStreamer) {
									resolve(null)
									return
								}

								const result = await this.completionStreamer.streamCompletion(
									{
										prompt,
										systemPrompt,
										maxTokens: 256,
										temperature: 0.2,
									},
									completionId,
									(partialResult) => {
										latestCompletion = partialResult.completion

										// Update the completion item
										const completionItem = new vscode.InlineCompletionItem(
											latestCompletion,
											new vscode.Range(position, position),
										)

										resolve([completionItem])
									},
									abortController.signal,
								)

								// Cache the completion if successful
								if (result.isComplete && result.completion) {
									this.cache.set(
										document.uri.toString(),
										document.getText(),
										cursorIndex,
										result.completion,
									)
								}

								// Clear active completion ID
								if (this.activeCompletionId === completionId) {
									this.activeCompletionId = null
								}

								// If we haven't resolved yet, resolve with the final completion
								if (result.completion) {
									const completionItem = new vscode.InlineCompletionItem(
										result.completion,
										new vscode.Range(position, position),
									)
									resolve([completionItem])
								} else {
									resolve(null)
								}
							} catch (error) {
								console.error("Error providing autocomplete:", error)
								resolve(null)
							}
						}, this.debounceDelay)
					})
				},
			},
		)

		context.subscriptions.push(disposable)

		return disposable
	}

	/**
	 * Initialize the API handler
	 */
	private async initializeApiHandler(): Promise<void> {
		try {
			const { config: conf } = await this.config.loadConfig()

			if (!conf?.selectedModelByRole?.autocomplete) {
				return
			}

			const modelConfig = conf.selectedModelByRole.autocomplete
			const providerSettings: ProviderSettings = {
				apiProvider: (modelConfig.providerName as any) || "ollama",
				apiModelId: (modelConfig.model as string) || "qwen2.5-coder:1.5b",
				apiKey: (modelConfig.apiKey as string) || "",
			}

			this.apiHandler = buildApiHandler(providerSettings)
		} catch (error) {
			console.error("Error initializing API handler:", error)
			vscode.window.showErrorMessage(
				`Failed to initialize autocomplete: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
