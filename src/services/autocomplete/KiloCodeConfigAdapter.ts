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
					debounceDelay: config.get<number>("autocomplete.debounceDelay") || 150,
					useCache: config.get<boolean>("autocomplete.useCache") || true,
					useImports: config.get<boolean>("autocomplete.useImports") || true,
					useRecentlyEdited: config.get<boolean>("autocomplete.useRecentlyEdited") || true,
					onlyMyCode: config.get<boolean>("autocomplete.onlyMyCode") || true,
					multilineCompletions: config.get<string>("autocomplete.multilineCompletions") || "auto",
				},
				selectedModelByRole: {
					autocomplete: {
						model: config.get<string>("autocomplete.model") || "ollama/qwen2.5-coder:1.5b",
						apiKey: config.get<string>("autocomplete.apiKey") || "",
						providerName: config.get<string>("autocomplete.providerName") || "ollama",
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
