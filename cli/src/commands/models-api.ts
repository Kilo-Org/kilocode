/**
 * Models API command - Exposes available models as JSON for programmatic use
 *
 * This command provides a lightweight way to query available models without
 * starting the full TUI. It's designed for integration with external tools
 * that need to offer model selection.
 *
 * Usage:
 *   kilocode models [--provider <id>] [--json]
 *
 * Output format:
 *   {
 *     "provider": "kilocode",
 *     "currentModel": "claude-sonnet-4",
 *     "models": [
 *       {
 *         "id": "claude-sonnet-4",
 *         "displayName": "Claude Sonnet 4",
 *         "contextWindow": 200000,
 *         "supportsImages": true,
 *         "inputPrice": 3,
 *         "outputPrice": 15
 *       }
 *     ]
 *   }
 *
 * For router-based providers (kilocode, openrouter, ollama, etc.), this command
 * initializes the extension to fetch models dynamically from the provider's API.
 */

import { createStore } from "jotai"
import { loadConfigAtom } from "../state/atoms/config.js"
import { logs } from "../services/logs.js"
import {
	getModelsByProvider,
	getCurrentModelId,
	sortModelsByPreference,
	providerSupportsModelList,
	type ModelInfo,
	type RouterModels,
} from "../constants/providers/models.js"
import type { ProviderName } from "../types/messages.js"
import type { CLIConfig, ProviderConfig } from "../config/types.js"
import { fetchRouterModels } from "../services/models/fetcher.js"

/**
 * Output format for the models API command
 */
export interface ModelsApiOutput {
	provider: string
	currentModel: string
	models: Array<{
		id: string
		displayName: string | null
		contextWindow: number
		supportsImages?: boolean
		inputPrice?: number
		outputPrice?: number
	}>
}

/**
 * Error output format
 */
export interface ModelsApiError {
	error: string
	code: string
}

/**
 * Options for the models API command
 */
export interface ModelsApiOptions {
	provider?: string
	json?: boolean
}

/**
 * Get the active provider configuration
 */
function getActiveProvider(config: CLIConfig, providerIdOverride?: string): ProviderConfig | null {
	const providerId = providerIdOverride || config.provider
	const provider = config.providers.find((p) => p.id === providerId)

	if (!provider) {
		logs.error(`Provider not found: ${providerId}`, "ModelsAPI")
		return null
	}

	return provider
}

/**
 * Transform models to API output format
 * @exported for testing
 */
export function transformModelsToOutput(
	models: Record<string, ModelInfo>,
	currentModelId: string,
	providerName: string,
): ModelsApiOutput {
	// Sort models by preference
	const sortedModelIds = sortModelsByPreference(models)

	// Transform to output format
	const outputModels = sortedModelIds
		.map((id) => {
			const model = models[id]
			if (!model) {
				return null
			}

			return {
				id,
				displayName: model.displayName || null,
				contextWindow: model.contextWindow,
				...(model.supportsImages !== undefined && { supportsImages: model.supportsImages }),
				...(model.inputPrice !== undefined && { inputPrice: model.inputPrice }),
				...(model.outputPrice !== undefined && { outputPrice: model.outputPrice }),
			}
		})
		.filter((m): m is NonNullable<typeof m> => m !== null)

	return {
		provider: providerName,
		currentModel: currentModelId,
		models: outputModels,
	}
}

/**
 * Output result as JSON to stdout
 */
function outputJson(data: ModelsApiOutput | ModelsApiError): void {
	console.log(JSON.stringify(data, null, 2))
}

/**
 * Output error and exit
 */
function outputError(message: string, code: string): never {
	outputJson({ error: message, code })
	process.exit(1)
}

/**
 * Main models API command handler
 *
 * This function:
 * 1. Loads CLI configuration
 * 2. For static providers, uses built-in model definitions
 * 3. For router-based providers, initializes extension to fetch models dynamically
 * 4. Outputs JSON to stdout
 * 5. Exits cleanly
 */
export async function modelsApiCommand(options: ModelsApiOptions = {}): Promise<void> {
	try {
		logs.info("Starting models API command", "ModelsAPI", { options })

		// Create Jotai store
		const store = createStore()

		// Load configuration
		const config = await store.set(loadConfigAtom)
		logs.debug("Configuration loaded", "ModelsAPI")

		// Get the active provider - use override if specified, otherwise use default
		let activeProvider: ProviderConfig | null = null
		let providerName: ProviderName

		if (options.provider) {
			// User specified a provider ID - find it
			activeProvider = getActiveProvider(config, options.provider)
			if (!activeProvider) {
				outputError(
					`Provider "${options.provider}" not found. Available providers: ${config.providers.map((p) => p.id).join(", ")}`,
					"PROVIDER_NOT_FOUND",
				)
			}
			providerName = activeProvider.provider as ProviderName
		} else {
			// Use default provider
			activeProvider = getActiveProvider(config)
			if (!activeProvider) {
				outputError(
					"No provider configured. Run 'kilocode auth' to configure a provider.",
					"PROVIDER_NOT_FOUND",
				)
			}
			providerName = activeProvider.provider as ProviderName
		}
		logs.debug(`Using provider: ${providerName}`, "ModelsAPI")

		// Check if this provider needs router models (uses PROVIDER_TO_ROUTER_NAME mapping)
		const needsRouterModels = providerSupportsModelList(providerName)

		// Get kilocode default model from config (for kilocode provider)
		const kilocodeProvider = config.providers.find((p) => p.provider === "kilocode")
		const kilocodeDefaultModel =
			kilocodeProvider && "kilocodeModel" in kilocodeProvider
				? (kilocodeProvider.kilocodeModel as string) || ""
				: ""

		let routerModels: RouterModels | null = null

		// For router-based providers, fetch models from the extension
		if (needsRouterModels) {
			logs.info(`Provider "${providerName}" requires router models, initializing extension...`, "ModelsAPI")
			routerModels = await fetchRouterModels(activeProvider)

			if (!routerModels) {
				outputError(
					`Failed to fetch models for provider "${providerName}". The provider may require authentication or the API may be unavailable.`,
					"ROUTER_MODELS_FETCH_FAILED",
				)
			}
		}

		// Get models for the provider
		const { models } = getModelsByProvider({
			provider: providerName,
			routerModels,
			kilocodeDefaultModel,
		})

		// Get current model ID
		const currentModelId = getCurrentModelId({
			providerConfig: activeProvider,
			routerModels,
			kilocodeDefaultModel,
		})

		// Check if we have any models
		if (Object.keys(models).length === 0) {
			outputError(
				`No models available for provider "${providerName}". The provider may require authentication or the model list could not be fetched.`,
				"NO_MODELS_AVAILABLE",
			)
		}

		// Transform and output
		const output = transformModelsToOutput(models, currentModelId, providerName)
		outputJson(output)

		logs.info("Models API command completed successfully", "ModelsAPI", {
			provider: providerName,
			modelCount: output.models.length,
		})
	} catch (error) {
		logs.error("Models API command failed", "ModelsAPI", { error })
		outputError(error instanceof Error ? error.message : "An unexpected error occurred", "INTERNAL_ERROR")
	}

	// Exit cleanly
	process.exit(0)
}
