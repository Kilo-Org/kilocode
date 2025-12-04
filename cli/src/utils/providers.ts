import type { ProviderName } from "../types/messages.js"
import { getModelFieldForProvider } from "../constants/providers/models.js"

/**
 * Get the selected model ID for a given provider from the API configuration
 * This handles the different field names used by different providers
 *
 * @param provider - The provider name
 * @param apiConfiguration - The API configuration object
 * @returns The selected model ID or "unknown" if not found
 */
export const getSelectedModelId = (
	provider: ProviderName | string,
	apiConfiguration: Record<string, unknown> | undefined,
): string => {
	if (!apiConfiguration || !provider || provider === "unknown") {
		return "unknown"
	}

	const modelField = getModelFieldForProvider(provider as ProviderName)

	if (!modelField) {
		// Provider doesn't have a model selection field (e.g., anthropic, bedrock)
		// These providers typically have fixed models
		return "default"
	}

	// Special handling for vscode-lm provider
	if (provider === "vscode-lm") {
		const selector = apiConfiguration.vsCodeLmModelSelector as { vendor?: string; family?: string } | undefined
		if (selector && selector.vendor && selector.family) {
			return `${selector.vendor}/${selector.family}`
		}
		return "unknown"
	}

	// Get the model ID from the appropriate field
	const modelId = apiConfiguration[modelField]

	// Return the model ID or "unknown" if not set
	return typeof modelId === "string" ? modelId : "unknown"
}
