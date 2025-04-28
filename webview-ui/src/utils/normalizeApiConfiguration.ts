import {
	ApiConfiguration,
	ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	deepSeekDefaultModelId,
	deepSeekModels,
	geminiDefaultModelId,
	geminiModels,
	glamaDefaultModelId,
	glamaDefaultModelInfo,
	mistralDefaultModelId,
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	openRouterDefaultModelId,
	openRouterDefaultModelInfo,
	vertexDefaultModelId,
	vertexModels,
	unboundDefaultModelId,
	unboundDefaultModelInfo,
	requestyDefaultModelId,
	requestyDefaultModelInfo,
	xaiDefaultModelId,
	xaiModels,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	fireworksDefaultModelId, // kilocode_change
	fireworksModels, // kilocode_change
} from "@roo/shared/api"

import { kilocodeOpenrouterModels } from "@roo/shared/kilocode/api"

export function normalizeApiConfiguration(apiConfiguration?: ApiConfiguration) {
	const provider = apiConfiguration?.apiProvider || "kilocode"
	const modelId = apiConfiguration?.apiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: string) => {
		let selectedModelId: string
		let selectedModelInfo: ModelInfo

		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}

		return { selectedProvider: provider, selectedModelId, selectedModelInfo }
	}

	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "xai":
			return getProviderData(xaiModels, xaiDefaultModelId)
		case "bedrock":
			// Special case for custom ARN
			if (modelId === "custom-arn") {
				return {
					selectedProvider: provider,
					selectedModelId: "custom-arn",
					selectedModelInfo: {
						maxTokens: 5000,
						contextWindow: 128_000,
						supportsPromptCache: false,
						supportsImages: true,
					},
				}
			}
			return getProviderData(bedrockModels, bedrockDefaultModelId)
		case "vertex":
			return getProviderData(vertexModels, vertexDefaultModelId)
		case "gemini":
			return getProviderData(geminiModels, geminiDefaultModelId)
		case "deepseek":
			return getProviderData(deepSeekModels, deepSeekDefaultModelId)
		case "openai-native":
			return getProviderData(openAiNativeModels, openAiNativeDefaultModelId)
		case "mistral":
			return getProviderData(mistralModels, mistralDefaultModelId)
		case "openrouter":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
				selectedModelInfo: apiConfiguration?.openRouterModelInfo || openRouterDefaultModelInfo,
			}
		case "glama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.glamaModelId || glamaDefaultModelId,
				selectedModelInfo: apiConfiguration?.glamaModelInfo || glamaDefaultModelInfo,
			}
		case "unbound":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.unboundModelId || unboundDefaultModelId,
				selectedModelInfo: apiConfiguration?.unboundModelInfo || unboundDefaultModelInfo,
			}
		case "requesty":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
				selectedModelInfo: apiConfiguration?.requestyModelInfo || requestyDefaultModelInfo,
			}
		case "openai":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.openAiModelId || "",
				selectedModelInfo: apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults,
			}
		case "ollama":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.ollamaModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "lmstudio":
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.lmStudioModelId || "",
				selectedModelInfo: openAiModelInfoSaneDefaults,
			}
		case "vscode-lm":
			const modelFamily = apiConfiguration?.vsCodeLmModelSelector?.family ?? vscodeLlmDefaultModelId
			const modelInfo = {
				...openAiModelInfoSaneDefaults,
				...vscodeLlmModels[modelFamily as keyof typeof vscodeLlmModels],
				supportsImages: false, // VSCode LM API currently doesn't support images.
			}
			return {
				selectedProvider: provider,
				selectedModelId: apiConfiguration?.vsCodeLmModelSelector
					? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
					: "",
				selectedModelInfo: modelInfo,
			}

		// kilocode_change begin
		case "fireworks":
			return getProviderData(fireworksModels, fireworksDefaultModelId)
		case "kilocode":
			// TODO: in line with kilocode-openrouter provider use hardcoded for now but info needs to be fetched later
			const displayModelId = {
				gemini25: "Gemini 2.5 Pro",
				gemini25flashpreview: "Gemini 2.5 Flash Preview",
				claude37: "Claude 3.7 Sonnet",
				gpt41: "GPT 4.1",
			}

			const displayConfigs = {
				gemini25: kilocodeOpenrouterModels["google/gemini-2.5-pro-preview-03-25"],
				gemini25flashpreview: kilocodeOpenrouterModels["google/gemini-2.5-flash-preview"],
				claude37: anthropicModels["claude-3-7-sonnet-20250219"],
				gpt41: kilocodeOpenrouterModels["openai/gpt-4.1"],
			}
			return {
				selectedProvider: provider,
				selectedModelId: displayModelId[apiConfiguration?.kilocodeModel ?? "claude37"],
				selectedModelInfo: displayConfigs[apiConfiguration?.kilocodeModel ?? "claude37"],
			}

		// kilocode_change end
		default:
			return getProviderData(anthropicModels, anthropicDefaultModelId)
	}
}
