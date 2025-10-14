import type { CLIConfig, ProviderConfig } from "./types.js"
import type { ExtensionState, ProviderSettings, ProviderSettingsEntry } from "../types/messages.js"
import { logs } from "../services/logs.js"

export function mapConfigToExtensionState(
	config: CLIConfig,
	currentState?: Partial<ExtensionState>,
): Partial<ExtensionState> {
	try {
		// Find selected provider
		let provider = config.providers.find((p) => p.id === config.provider)

		if (!provider) {
			logs.warn("Selected provider not found, using first provider", "ConfigMapper")
			provider = config.providers[0]
			if (!provider) {
				throw new Error("No providers configured")
			}
		}

		// Map provider config to API configuration
		const apiConfiguration = mapProviderToApiConfig(provider)

		// Create list of provider metadata
		const listApiConfigMeta: ProviderSettingsEntry[] = config.providers.map((p) => ({
			id: p.id,
			name: p.id,
			apiProvider: p.provider,
			modelId: getModelIdForProvider(p),
		}))

		return {
			...currentState,
			apiConfiguration,
			currentApiConfigName: provider.id,
			listApiConfigMeta,
			telemetrySetting: config.telemetry ? "enabled" : "disabled",
			mode: config.mode,
		}
	} catch (error) {
		logs.error("Failed to map config to extension state", "ConfigMapper", { error })
		throw error
	}
}

function mapProviderToApiConfig(provider: ProviderConfig): ProviderSettings {
	const config: ProviderSettings = {
		apiProvider: provider.provider,
	}

	// Copy all provider-specific fields
	Object.keys(provider).forEach((key) => {
		if (key !== "id" && key !== "provider") {
			config[key] = provider[key]
		}
	})

	return config
}

function getModelIdForProvider(provider: ProviderConfig): string {
	switch (provider.provider) {
		case "kilocode":
			return provider.kilocodeModel || ""
		case "anthropic":
			return provider.apiModelId || ""
		case "openai-native":
			return provider.apiModelId || ""
		case "openrouter":
			return provider.openRouterModelId || ""
		case "ollama":
			return provider.ollamaModelId || ""
		case "lmstudio":
			return provider.lmStudioModelId || ""
		case "openai":
			return provider.apiModelId || ""
		case "glama":
			return provider.glamaModelId || ""
		case "litellm":
			return provider.litellmModelId || ""
		case "deepinfra":
			return provider.deepInfraModelId || ""
		case "unbound":
			return provider.unboundModelId || ""
		case "requesty":
			return provider.requestyModelId || ""
		case "vercel-ai-gateway":
			return provider.vercelAiGatewayModelId || ""
		case "io-intelligence":
			return provider.ioIntelligenceModelId || ""
		default:
			return provider.apiModelId || provider.modelId || ""
	}
}

export function mapExtensionStateToConfig(state: ExtensionState, currentConfig?: CLIConfig): CLIConfig {
	// This is for future bi-directional sync if needed
	const config: CLIConfig = currentConfig || {
		version: "1.0.0",
		mode: state.mode || "code",
		telemetry: state.telemetrySetting === "enabled",
		provider: state.currentApiConfigName || "default",
		providers: [],
	}

	// Map current API configuration to provider
	if (state.apiConfiguration) {
		const providerId = state.currentApiConfigName || "current"
		const existingProvider = config.providers.find((p) => p.id === providerId)

		if (!existingProvider) {
			const newProvider: ProviderConfig = {
				id: providerId,
				provider: state.apiConfiguration.apiProvider || "kilocode",
				...state.apiConfiguration,
			}
			config.providers.push(newProvider)
		} else {
			// Update existing provider
			Object.assign(existingProvider, state.apiConfiguration)
		}

		config.provider = providerId
	}

	return config
}
