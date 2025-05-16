// import { CompletionProvider } from "@continuedev/core/autocomplete/CompletionProvider"
import * as vscode from "vscode"
import { KiloCodeIDEAdapter } from "./KiloCodeIDEAdapter"
import { KiloCodeConfigAdapter } from "./KiloCodeConfigAdapter"
import { ApiHandler, buildApiHandler } from "../../api"
import { ProviderSettings } from "../../shared/api"
import { AutocompleteCodeSnippet, RecentlyEditedRange } from "continue-wrapper/types"

class CompletionProvider {
	constructor(
		_config: any,
		_ide: any,
		_getAutocompleteModel: any,
		_onError: (_e: any) => void,
		_getDefinitionsFromLsp: any,
	) {}

	async provideInlineCompletionItems(_input: any, _signal: AbortSignal): Promise<{ completion: string } | null> {
		return {
			completion: " // Kilcode autocompete is active!",
		}
	}
}

/**
 * Provider for autocomplete functionality using Continue's implementation
 */
export class AutocompleteProvider {
	private coreProvider: CompletionProvider
	private apiHandler: ApiHandler | null = null
	private enabled: boolean = true

	constructor() {
		const ide = new KiloCodeIDEAdapter()
		const config = new KiloCodeConfigAdapter()

		// Function to get the autocomplete model
		const getAutocompleteModel = async () => {
			const { config: conf } = await config.loadConfig()

			if (!conf?.selectedModelByRole?.autocomplete) {
				return null
			}

			// Initialize API handler if needed
			if (!this.apiHandler) {
				const modelConfig = conf.selectedModelByRole.autocomplete
				const providerSettings: ProviderSettings = {
					apiProvider: (modelConfig.providerName as any) || "ollama",
					apiModelId: (modelConfig.model as string) || "qwen2.5-coder:1.5b",
					apiKey: (modelConfig.apiKey as string) || "",
				}

				try {
					this.apiHandler = buildApiHandler(providerSettings)
				} catch (error) {
					console.error("Error initializing API handler:", error)
					return null
				}
			}

			return conf.selectedModelByRole.autocomplete
		}

		// Simple error handler
		const onError = (e: any) => {
			vscode.window.showErrorMessage(`Autocomplete error: ${e.message}`)
		}

		// LSP definitions function (simplified for now)
		const getDefinitionsFromLsp = async (
			_filepath: string,
			_contents: string,
			_cursorIndex: number,
			_ide: any,
			_lang: any,
		): Promise<any[]> => {
			return []
		}

		// Create the core provider
		this.coreProvider = new CompletionProvider(
			config as any,
			ide as any,
			getAutocompleteModel as any,
			onError,
			getDefinitionsFromLsp,
		)
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

					try {
						// Format the input for Continue
						const input = {
							filepath: document.uri.toString(),
							pos: { line: position.line, character: position.character },
							completionId: crypto.randomUUID(),
							isUntitledFile: document.isUntitled,
							recentlyVisitedRanges: [] as AutocompleteCodeSnippet[],
							recentlyEditedRanges: [] as RecentlyEditedRange[],
						}

						// Get completions - convert VSCode's CancellationToken to AbortSignal
						const abortController = new AbortController()
						token.onCancellationRequested(() => abortController.abort())

						const outcome = await this.coreProvider.provideInlineCompletionItems(
							input,
							abortController.signal,
						)

						if (!outcome || !outcome.completion) {
							return null
						}

						// Convert to VSCode format
						const completionItem = new vscode.InlineCompletionItem(
							outcome.completion,
							new vscode.Range(position, position),
						)

						return [completionItem]
					} catch (error) {
						console.error("Error providing autocomplete:", error)
						return null
					}
				},
			},
		)

		context.subscriptions.push(disposable)

		return disposable
	}
}
