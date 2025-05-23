//PLANREF: continue/core/autocomplete/CompletionProvider.ts
import * as vscode from "vscode"

/**
 * Adapter that provides configuration options for Continue's autocomplete
 */
export class AutocompleteConfig {
	/**
	 * Load configuration for autocomplete
	 */
	async loadConfig() {
		const config = vscode.workspace.getConfiguration("kilo-code")

		return {
			useCache: config.get<boolean>("autocomplete.useCache") || true,
			useImports: config.get<boolean>("autocomplete.useImports") || true,
			useRecentlyEdited: config.get<boolean>("autocomplete.useRecentlyEdited") || true,
			onlyMyCode: config.get<boolean>("autocomplete.onlyMyCode") || true,
			multilineCompletions: config.get<string>("autocomplete.multilineCompletions") || "auto",
			// AIDIFF: Add ollama specific settings to the config object type
			ollamaModelId: config.get<string>("autocomplete.ollamaModelId"), // Allow undefined if not set
			ollamaBaseUrl: config.get<string>("autocomplete.ollamaBaseUrl"), // Allow undefined if not set
			ollamaParameters: config.get<object>("autocomplete.ollamaParameters") || {},
		}
	}

	/**
	 * Reload configuration
	 */
	async reloadConfig() {
		// No-op for now
	}
}
