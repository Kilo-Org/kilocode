import type { ProviderSettings } from "@roo-code/types"

import type { RouterModels } from "@/ui/store.js"

const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Looks up the context window size for the current model from routerModels.
 *
 * @param routerModels - The router models data containing model info per provider
 * @param apiConfiguration - The current API configuration with provider and model ID
 * @returns The context window size, or DEFAULT_CONTEXT_WINDOW (200K) if not found
 */
export function getContextWindow(routerModels: RouterModels | null, apiConfiguration: ProviderSettings | null): number {
	if (!routerModels || !apiConfiguration) {
		return DEFAULT_CONTEXT_WINDOW
	}

	const provider = apiConfiguration.apiProvider
	const modelId = getModelIdForProvider(apiConfiguration)

	if (!provider || !modelId) {
		return DEFAULT_CONTEXT_WINDOW
	}

	const providerModels = routerModels[provider]
	const modelInfo = providerModels?.[modelId]

	return modelInfo?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}

/**
 * Gets the model ID from the API configuration based on the provider type.
 *
 * Different providers store their model ID in different fields of ProviderSettings.
 */
function getModelIdForProvider(config: ProviderSettings): string | undefined {
	switch (config.apiProvider) {
		case "openrouter":
			return config.openRouterModelId
		case "ollama":
			return config.ollamaModelId
		case "lmstudio":
			return config.lmStudioModelId
		case "openai":
			return config.openAiModelId
		case "requesty":
			return config.requestyModelId
		case "litellm":
			return config.litellmModelId
		case "deepinfra":
			return config.deepInfraModelId
		case "huggingface":
			return config.huggingFaceModelId
		case "unbound":
			return config.unboundModelId
		case "vercel-ai-gateway":
			return config.vercelAiGatewayModelId
		case "io-intelligence":
			return config.ioIntelligenceModelId
		default:
			// For anthropic, bedrock, vertex, gemini, xai, groq, etc.
			return config.apiModelId
	}
}

export { DEFAULT_CONTEXT_WINDOW }
