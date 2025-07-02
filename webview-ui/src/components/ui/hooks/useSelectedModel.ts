import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	geminiCliDefaultModelId,
	geminiCliModels,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
	groqModels,
	groqDefaultModelId,
	chutesModels,
	chutesDefaultModelId,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
	litellmDefaultModelId,
	claudeCodeDefaultModelId,
	claudeCodeModels,
} from "@roo-code/types"

import { cerebrasModels, cerebrasDefaultModelId } from "@roo/api" // kilocode_change

import type { RouterModels } from "@roo/api"

import { useRouterModels } from "./useRouterModels"
import { useOpenRouterModelProviders } from "./useOpenRouterModelProviders"

export const useSelectedModel = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const openRouterModelId = provider === "openrouter" ? apiConfiguration?.openRouterModelId : undefined

	// kilocode_change start openRouterBaseUrl, apiKey
	const routerModels = useRouterModels({
		openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
		openRouterApiKey: apiConfiguration?.apiKey,
	})
	const openRouterModelProviders = useOpenRouterModelProviders(
		openRouterModelId,
		apiConfiguration?.openRouterBaseUrl,
		apiConfiguration?.apiKey,
	)
	// kilocode_change end

	const { id, info } =
		apiConfiguration &&
		typeof routerModels.data !== "undefined" &&
		typeof openRouterModelProviders.data !== "undefined"
			? getSelectedModel({
					provider,
					apiConfiguration,
					routerModels: routerModels.data,
					openRouterModelProviders: openRouterModelProviders.data,
				})
			: { id: anthropicDefaultModelId, info: undefined }

	return {
		provider,
		id,
		info,
		isLoading: routerModels.isLoading || openRouterModelProviders.isLoading,
		isError: routerModels.isError || openRouterModelProviders.isError,
	}
}

function getSelectedModel({
	provider,
	apiConfiguration,
	routerModels,
	openRouterModelProviders,
}: {
	provider: ProviderName
	apiConfiguration: ProviderSettings
	routerModels: RouterModels
	openRouterModelProviders: Record<string, ModelInfo>
}): { id: string; info: ModelInfo | undefined } {
	// the `undefined` case are used to show the invalid selection to prevent
	// users from seeing the default model if their selection is invalid
	// this gives a better UX than showing the default model
	switch (provider) {
		case "openrouter": {
			const id = apiConfiguration.openRouterModelId ?? openRouterDefaultModelId
			let info = routerModels.openrouter[id]
			const specificProvider = apiConfiguration.openRouterSpecificProvider

			if (specificProvider && openRouterModelProviders[specificProvider]) {
				// Overwrite the info with the specific provider info. Some
				// fields are missing the model info for `openRouterModelProviders`
				// so we need to merge the two.
				info = info
					? { ...info, ...openRouterModelProviders[specificProvider] }
					: openRouterModelProviders[specificProvider]
			}

			return { id, info }
		}
		case "requesty": {
			const id = apiConfiguration.requestyModelId ?? requestyDefaultModelId
			const info = routerModels.requesty[id]
			return { id, info }
		}
		case "glama": {
			const id = apiConfiguration.glamaModelId ?? glamaDefaultModelId
			const info = routerModels.glama[id]
			return { id, info }
		}
		case "unbound": {
			const id = apiConfiguration.unboundModelId ?? unboundDefaultModelId
			const info = routerModels.unbound[id]
			return { id, info }
		}
		case "litellm": {
			const id = apiConfiguration.litellmModelId ?? litellmDefaultModelId
			const info = routerModels.litellm[id]
			return { id, info }
		}
		case "xai": {
			const id = apiConfiguration.apiModelId ?? xaiDefaultModelId
			const info = xaiModels[id as keyof typeof xaiModels]
			return info ? { id, info } : { id, info: undefined }
		}
		case "groq": {
			const id = apiConfiguration.apiModelId ?? groqDefaultModelId
			const info = groqModels[id as keyof typeof groqModels]
			return { id, info }
		}
		case "chutes": {
			const id = apiConfiguration.apiModelId ?? chutesDefaultModelId
			const info = chutesModels[id as keyof typeof chutesModels]
			return { id, info }
		}
		// kilocode_change start
		case "cerebras": {
			const id = apiConfiguration.apiModelId ?? cerebrasDefaultModelId
			const info = cerebrasModels[id as keyof typeof cerebrasModels]
			return info ? { id, info } : { id: cerebrasDefaultModelId, info: cerebrasModels[cerebrasDefaultModelId] }
		} // kilocode_change end
		case "bedrock": {
			const id = apiConfiguration.apiModelId ?? bedrockDefaultModelId
			const info = bedrockModels[id as keyof typeof bedrockModels]

			// Special case for custom ARN.
			if (id === "custom-arn") {
				return {
					id,
					info: { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: false, supportsImages: true },
				}
			}

			return { id, info }
		}
		case "vertex": {
			const id = apiConfiguration.apiModelId ?? vertexDefaultModelId
			const info = vertexModels[id as keyof typeof vertexModels]
			return { id, info }
		}
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? geminiDefaultModelId
			const info = geminiModels[id as keyof typeof geminiModels]
			return { id, info }
		}
		case "gemini-cli": {
			const id = apiConfiguration.apiModelId ?? geminiCliDefaultModelId
			const info = geminiCliModels[id as keyof typeof geminiCliModels]
			return { id, info }
		}
		case "deepseek": {
			const id = apiConfiguration.apiModelId ?? deepSeekDefaultModelId
			const info = deepSeekModels[id as keyof typeof deepSeekModels]
			return { id, info }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? openAiNativeDefaultModelId
			const info = openAiNativeModels[id as keyof typeof openAiNativeModels]
			return { id, info }
		}
		case "mistral": {
			const id = apiConfiguration.apiModelId ?? mistralDefaultModelId
			const info = mistralModels[id as keyof typeof mistralModels]
			return { id, info }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const info = apiConfiguration?.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults
			return { id, info }
		}
		case "ollama": {
			const id = apiConfiguration.ollamaModelId ?? ""
			const info = routerModels.ollama && routerModels.ollama[id]
			return {
				id,
				info: info || undefined,
			}
		}
		case "lmstudio": {
			const id = apiConfiguration.lmStudioModelId ?? ""
			const info = routerModels.lmstudio && routerModels.lmstudio[id]
			return {
				id,
				info: info || undefined,
			}
		}
		case "vscode-lm": {
			const id = apiConfiguration?.vsCodeLmModelSelector
				? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
				: vscodeLlmDefaultModelId
			const modelFamily = apiConfiguration?.vsCodeLmModelSelector?.family ?? vscodeLlmDefaultModelId
			const info = vscodeLlmModels[modelFamily as keyof typeof vscodeLlmModels]
			return { id, info: { ...openAiModelInfoSaneDefaults, ...info, supportsImages: false } } // VSCode LM API currently doesn't support images.
		}
		// kilocode_change begin
		case "kilocode": {
			// Use the fetched models from routerModels
			if (routerModels["kilocode-openrouter"] && apiConfiguration.kilocodeModel) {
				// Find the model in the fetched models
				const modelEntries = Object.entries(routerModels["kilocode-openrouter"])

				const selectedModelId = apiConfiguration.kilocodeModel.toLowerCase()

				// Prefer exact match
				const selectedModel =
					modelEntries.find((model) => model[0].toLowerCase() === selectedModelId) ??
					modelEntries.find((model) => model[0].toLowerCase().includes(selectedModelId))

				if (selectedModel) {
					return { id: selectedModel[0], info: selectedModel[1] }
				}
			}

			// Fallback to anthropic model if no match found
			return { id: "Claude 3.7 Sonnet", info: anthropicModels["claude-3-7-sonnet-20250219"] }
		}
		// kilocode_change end

		case "claude-code": {
			// Claude Code models extend anthropic models but with images and prompt caching disabled
			const id = apiConfiguration.apiModelId ?? claudeCodeDefaultModelId
			const info = claudeCodeModels[id as keyof typeof claudeCodeModels]
			return { id, info: { ...openAiModelInfoSaneDefaults, ...info } }
		}
		// case "anthropic":
		// case "human-relay":
		// case "fake-ai":
		default: {
			const id = apiConfiguration.apiModelId ?? anthropicDefaultModelId
			const info = anthropicModels[id as keyof typeof anthropicModels]
			return { id, info }
		}
	}
}
