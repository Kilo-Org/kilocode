import { RooCodeSettings } from "@roo-code/types"

import type { SupportedProvider } from "@/types/index.js"

const envVarMap: Record<SupportedProvider, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	"openai-native": "OPENAI_API_KEY",
	gemini: "GOOGLE_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "VERCEL_AI_GATEWAY_API_KEY",
	roo: "ROO_API_KEY",
}

export function getEnvVarName(provider: SupportedProvider): string {
	return envVarMap[provider]
}

export function getApiKeyFromEnv(provider: SupportedProvider): string | undefined {
	const envVar = getEnvVarName(provider)
	return process.env[envVar]
}

export function getProviderSettings(
	provider: SupportedProvider,
	apiKey: string | undefined,
	model: string | undefined,
): RooCodeSettings {
	const config: RooCodeSettings = { apiProvider: provider }

	switch (provider) {
		case "anthropic":
			if (apiKey) config.apiKey = apiKey
			if (model) config.apiModelId = model
			break
		case "openai-native":
			if (apiKey) config.openAiNativeApiKey = apiKey
			if (model) config.apiModelId = model
			break
		case "gemini":
			if (apiKey) config.geminiApiKey = apiKey
			if (model) config.apiModelId = model
			break
		case "openrouter":
			if (apiKey) config.openRouterApiKey = apiKey
			if (model) config.openRouterModelId = model
			break
		case "vercel-ai-gateway":
			if (apiKey) config.vercelAiGatewayApiKey = apiKey
			if (model) config.vercelAiGatewayModelId = model
			break
		case "roo":
			if (apiKey) config.rooApiKey = apiKey
			if (model) config.apiModelId = model
			break
		default:
			if (apiKey) config.apiKey = apiKey
			if (model) config.apiModelId = model
	}

	return config
}
