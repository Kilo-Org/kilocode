import {
	type ProviderName,
	type ProviderSettings,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	mistralDefaultModelId,
	mistralModels,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
	// kilocode_change start
	bigModelDefaultModelId,
	bigModelModels,
	// kilocode_change end
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
	kilocodeDefaultModelId,
} from "@roo-code/types"
import { cerebrasModels, cerebrasDefaultModelId } from "@roo/api"
import type { ModelRecord, RouterModels } from "@roo/api"
import { useRouterModels } from "../../ui/hooks/useRouterModels"

const FALLBACK_MODELS = {
	models: anthropicModels,
	defaultModel: anthropicDefaultModelId,
}

const getModelsByProvider = ({
	provider,
	routerModels,
}: {
	provider: ProviderName
	routerModels: RouterModels
}): { models: ModelRecord; defaultModel: string } => {
	switch (provider) {
		case "openrouter": {
			return {
				models: routerModels.openrouter,
				defaultModel: openRouterDefaultModelId,
			}
		}
		case "requesty": {
			return {
				models: routerModels.requesty,
				defaultModel: requestyDefaultModelId,
			}
		}
		case "glama": {
			return {
				models: routerModels.glama,
				defaultModel: glamaDefaultModelId,
			}
		}
		case "unbound": {
			return {
				models: routerModels.unbound,
				defaultModel: unboundDefaultModelId,
			}
		}
		case "litellm": {
			return {
				models: routerModels.litellm,
				defaultModel: litellmDefaultModelId,
			}
		}
		case "xai": {
			return {
				models: xaiModels,
				defaultModel: xaiDefaultModelId,
			}
		}
		case "bigmodel": {
			return {
				models: bigModelModels,
				defaultModel: bigModelDefaultModelId,
			}
		}
		case "groq": {
			return {
				models: groqModels,
				defaultModel: groqDefaultModelId,
			}
		}
		case "chutes": {
			return {
				models: chutesModels,
				defaultModel: chutesDefaultModelId,
			}
		}
		case "cerebras": {
			return {
				models: cerebrasModels,
				defaultModel: cerebrasDefaultModelId,
			}
		}
		case "bedrock": {
			return {
				models: bedrockModels,
				defaultModel: bedrockDefaultModelId,
			}
		}
		case "vertex": {
			return {
				models: vertexModels,
				defaultModel: vertexDefaultModelId,
			}
		}
		case "gemini": {
			return {
				models: geminiModels,
				defaultModel: geminiDefaultModelId,
			}
		}
		case "deepseek": {
			return {
				models: deepSeekModels,
				defaultModel: deepSeekDefaultModelId,
			}
		}
		case "openai-native": {
			return {
				models: openAiNativeModels,
				defaultModel: openAiNativeDefaultModelId,
			}
		}
		case "mistral": {
			return {
				models: mistralModels,
				defaultModel: mistralDefaultModelId,
			}
		}
		case "openai": {
			// TODO(catrielmuller): Support the fetch here
			return {
				models: {},
				defaultModel: "",
			}
		}
		case "ollama": {
			// Only custom models
			return {
				models: {},
				defaultModel: "",
			}
		}
		case "lmstudio": {
			// Only custom models
			return {
				models: {},
				defaultModel: "",
			}
		}
		case "vscode-lm": {
			return {
				models: vscodeLlmModels,
				defaultModel: vscodeLlmDefaultModelId,
			}
		}
		case "kilocode": {
			return {
				models: routerModels["kilocode-openrouter"],
				defaultModel: kilocodeDefaultModelId,
			}
		}
		default: {
			return FALLBACK_MODELS
		}
	}
}

export const useProviderModels = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"

	const routerModels = useRouterModels({
		openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
		openRouterApiKey: apiConfiguration?.apiKey,
	})

	const { models, defaultModel } =
		apiConfiguration && typeof routerModels.data !== "undefined"
			? getModelsByProvider({
					provider,
					routerModels: routerModels.data,
				})
			: FALLBACK_MODELS

	return {
		provider,
		providerModels: models,
		providerDefaultModel: defaultModel,
		isLoading: routerModels.isLoading,
		isError: routerModels.isError,
	}
}
