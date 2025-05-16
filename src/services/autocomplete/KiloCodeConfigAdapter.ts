import * as vscode from "vscode"

/**
 * Adapter that provides configuration options for Continue's autocomplete
 */
export class KiloCodeConfigAdapter {
	/**
	 * Load configuration for autocomplete
	 */
	async loadConfig() {
		const config = vscode.workspace.getConfiguration("kilo-code")

		return {
			config: {
				tabAutocompleteOptions: {
					debounceDelay: config.get("autocomplete.debounceDelay") || 150,
					useCache: config.get("autocomplete.useCache") || true,
					useImports: config.get("autocomplete.useImports") || true,
					useRecentlyEdited: config.get("autocomplete.useRecentlyEdited") || true,
					onlyMyCode: config.get("autocomplete.onlyMyCode") || true,
					multilineCompletions: config.get("autocomplete.multilineCompletions") || "auto",
				},
				selectedModelByRole: {
					autocomplete: {
						model: config.get("autocomplete.model") || "ollama/qwen2.5-coder:1.5b",
						apiKey: config.get("autocomplete.apiKey") || "",
						providerName: config.get("autocomplete.providerName") || "ollama",
					},
				},
			},
		}
	}

	/**
	 * Reload configuration
	 */
	async reloadConfig() {
		// No-op for now
	}
}
