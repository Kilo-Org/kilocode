import {
	type ProviderName,
	type ProviderSettings,
	anthropicDefaultModelId,
	anthropicModels,
	basetenModels,
	basetenDefaultModelId,
	corethinkModels,
	corethinkDefaultModelId,
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
	openAiCodexDefaultModelId,
	openAiCodexModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
	groqModels,
	groqDefaultModelId,
	chutesDefaultModelId,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
	litellmDefaultModelId,
	qwenCodeModels,
	qwenCodeDefaultModelId,
	claudeCodeModels,
	claudeCodeDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	fireworksModels,
	fireworksDefaultModelId,
	syntheticDefaultModelId,
	ioIntelligenceDefaultModelId,
	moonshotModels,
	moonshotDefaultModelId,
	sambaNovaModels,
	sambaNovaDefaultModelId,
	featherlessModels,
	featherlessDefaultModelId,
	deepInfraDefaultModelId,
	cerebrasModels,
	cerebrasDefaultModelId,
	nanoGptDefaultModelId, //kilocode_change
	ovhCloudAiEndpointsDefaultModelId,
	inceptionDefaultModelId,
	minimaxModels,
	minimaxDefaultModelId,
	internationalZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiModels,
	mainlandZAiDefaultModelId,
	zenmuxDefaultModelId,
} from "@roo-code/types"
import type { ModelRecord, RouterModels } from "@roo/api"
import { useRouterModels } from "../../ui/hooks/useRouterModels"
import { useExtensionState } from "@/context/ExtensionStateContext"

const FALLBACK_MODELS = {
	models: anthropicModels,
	defaultModel: anthropicDefaultModelId,
}

export const getModelsByProvider = ({
	provider,
	routerModels,
	kilocodeDefaultModel,
	options = { isChina: false },
}: {
	provider: ProviderName
	routerModels: RouterModels
	kilocodeDefaultModel: string
	options: { isChina?: boolean }
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
		case "groq": {
			return {
				models: groqModels,
				defaultModel: groqDefaultModelId,
			}
		}
		case "chutes": {
			return {
				models: routerModels.chutes, // kilocode_change
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
				models:
					routerModels.gemini && Object.keys(routerModels.gemini).length > 0
						? routerModels.gemini
						: geminiModels,
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
		case "openai-codex": {
			return {
				models: openAiCodexModels,
				defaultModel: openAiCodexDefaultModelId,
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
			return {
				models: routerModels.ollama,
				defaultModel: "",
			}
		}
		case "lmstudio": {
			return {
				models: routerModels.lmstudio,
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
				models: routerModels.kilocode,
				defaultModel: kilocodeDefaultModel,
			}
		}
		case "claude-code": {
			return {
				models: claudeCodeModels,
				defaultModel: claudeCodeDefaultModelId,
			}
		}
		case "qwen-code": {
			return {
				models: qwenCodeModels,
				defaultModel: qwenCodeDefaultModelId,
			}
		}
		case "anthropic": {
			return {
				models: anthropicModels,
				defaultModel: anthropicDefaultModelId,
			}
		}
		case "doubao": {
			return {
				models: doubaoModels,
				defaultModel: doubaoDefaultModelId,
			}
		}
		case "fireworks": {
			return {
				models: fireworksModels,
				defaultModel: fireworksDefaultModelId,
			}
		}
		// kilocode_change start
		case "synthetic": {
			return {
				models: routerModels.synthetic,
				defaultModel: syntheticDefaultModelId,
			}
		}
		case "ovhcloud": {
			return {
				models: routerModels.ovhcloud,
				defaultModel: ovhCloudAiEndpointsDefaultModelId,
			}
		}
		case "inception": {
			return {
				models: routerModels.inception,
				defaultModel: inceptionDefaultModelId,
			}
		}
		case "sap-ai-core": {
			return {
				models: routerModels["sap-ai-core"],
				defaultModel: "",
			}
		}
		// kilocode_change end
		case "io-intelligence": {
			return {
				models: routerModels["io-intelligence"],
				defaultModel: ioIntelligenceDefaultModelId,
			}
		}
		case "moonshot": {
			return {
				models: moonshotModels,
				defaultModel: moonshotDefaultModelId,
			}
		}
		case "sambanova": {
			return {
				models: sambaNovaModels,
				defaultModel: sambaNovaDefaultModelId,
			}
		}
		case "featherless": {
			return {
				models: featherlessModels,
				defaultModel: featherlessDefaultModelId,
			}
		}
		case "deepinfra": {
			return {
				models: routerModels.deepinfra,
				defaultModel: deepInfraDefaultModelId,
			}
		}
		//kilocode_change start
		case "nano-gpt": {
			return {
				models: routerModels["nano-gpt"],
				defaultModel: nanoGptDefaultModelId,
			}
		}
		//kilocode_change end
		case "minimax": {
			return {
				models: minimaxModels,
				defaultModel: minimaxDefaultModelId,
			}
		}
		case "baseten": {
			return {
				models: basetenModels,
				defaultModel: basetenDefaultModelId,
			}
		}
		case "corethink": {
			return {
				models: corethinkModels,
				defaultModel: corethinkDefaultModelId,
			}
		}
		case "zai": {
			if (options.isChina) {
				return {
					models: mainlandZAiModels,
					defaultModel: mainlandZAiDefaultModelId,
				}
			} else {
				return {
					models: internationalZAiModels,
					defaultModel: internationalZAiDefaultModelId,
				}
			}
		}
		case "zenmux": {
			return {
				models: routerModels.zenmux,
				defaultModel: zenmuxDefaultModelId,
			}
		}
		default:
			return {
				models: {},
				defaultModel: "",
			}
	}
}

export const getOptionsForProvider = (provider: ProviderName, apiConfiguration?: ProviderSettings) => {
	switch (provider) {
		case "zai":
			// Determine which Z.AI model set to use based on the API line configuration
			// kilocode_change start
			return {
				isChina:
					apiConfiguration?.zaiApiLine === "china_coding" || apiConfiguration?.zaiApiLine === "china_api",
			}
			// kilocode_change end
		default:
			return {}
	}
}

export const useProviderModels = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"

	const { kilocodeDefaultModel } = useExtensionState()

	const routerModels = useRouterModels({
		openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
		openRouterApiKey: apiConfiguration?.apiKey,
		kilocodeOrganizationId: apiConfiguration?.kilocodeOrganizationId ?? "personal",
		chutesApiKey: apiConfiguration?.chutesApiKey,
		geminiApiKey: apiConfiguration?.geminiApiKey,
		googleGeminiBaseUrl: apiConfiguration?.googleGeminiBaseUrl,
		//kilocode_change start
		nanoGptApiKey: apiConfiguration?.nanoGptApiKey,
		nanoGptModelList: apiConfiguration?.nanoGptModelList,
		//kilocode_change end
		syntheticApiKey: apiConfiguration?.syntheticApiKey, // kilocode_change
	})

	const options = getOptionsForProvider(provider, apiConfiguration)

	const { models, defaultModel } =
		apiConfiguration && typeof routerModels.data !== "undefined"
			? getModelsByProvider({
					provider,
					routerModels: routerModels.data,
					kilocodeDefaultModel,
					options,
				})
			: FALLBACK_MODELS

	return {
		provider,
		providerModels: models as ModelRecord,
		providerDefaultModel: defaultModel,
		isLoading: routerModels.isLoading,
		isError: routerModels.isError,
	}
}
