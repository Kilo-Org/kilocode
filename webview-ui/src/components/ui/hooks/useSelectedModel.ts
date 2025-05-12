import {
	ApiConfiguration,
	RouterModels,
	ModelInfo,
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
	openAiModelInfoSaneDefaults,
	openAiNativeDefaultModelId,
	openAiNativeModels,
	vertexDefaultModelId,
	vertexModels,
	xaiDefaultModelId,
	xaiModels,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openRouterDefaultModelId,
	requestyDefaultModelId,
	glamaDefaultModelId,
	unboundDefaultModelId,
} from "@roo/shared/api"
import { useRouterModels } from "./useRouterModels"

export const useSelectedModel = (apiConfiguration?: ApiConfiguration) => {
	const { data: routerModels, isLoading, isError } = useRouterModels()
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const id = apiConfiguration ? getSelectedModelId({ provider, apiConfiguration }) : anthropicDefaultModelId
	const info = routerModels ? getSelectedModelInfo({ provider, id, apiConfiguration, routerModels }) : undefined
	return { provider, id, info, isLoading, isError }
}

function getSelectedModelId({ provider, apiConfiguration }: { provider: string; apiConfiguration: ApiConfiguration }) {
	switch (provider) {
		case "openrouter":
			return apiConfiguration.openRouterModelId ?? openRouterDefaultModelId
		case "requesty":
			return apiConfiguration.requestyModelId ?? requestyDefaultModelId
		case "glama":
			return apiConfiguration.glamaModelId ?? glamaDefaultModelId
		case "unbound":
			return apiConfiguration.unboundModelId ?? unboundDefaultModelId
		case "openai":
			return apiConfiguration.openAiModelId || ""
		case "ollama":
			return apiConfiguration.ollamaModelId || ""
		case "lmstudio":
			return apiConfiguration.lmStudioModelId || ""
		case "vscode-lm":
			return apiConfiguration?.vsCodeLmModelSelector
				? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
				: ""
		// kilocode_change begin
		case "kilocode":
			// backwards compatibility
			const displayModelId = {
				gemini25: "Gemini 2.5 Pro",
				gemini25flashpreview: "Gemini 2.5 Flash Preview",
				claude37: "Claude 3.7 Sonnet",
				gpt41: "GPT 4.1",
			}
			// if the kilocodeModel is not in the displayModelId use as is
			if (
				apiConfiguration.kilocodeModel &&
				Object.keys(displayModelId).includes(apiConfiguration.kilocodeModel)
			) {
				return displayModelId[apiConfiguration.kilocodeModel as keyof typeof displayModelId]
			}
			return apiConfiguration.kilocodeModel || ""

		// kilocode_change end
		default:
			return apiConfiguration.apiModelId ?? anthropicDefaultModelId
	}
}

function getSelectedModelInfo({
	provider,
	id,
	apiConfiguration,
	routerModels,
}: {
	provider: string
	id: string
	apiConfiguration?: ApiConfiguration
	routerModels: RouterModels
}): ModelInfo {
	switch (provider) {
		case "openrouter":
			return routerModels.openrouter[id] ?? routerModels.openrouter[openRouterDefaultModelId]
		case "requesty":
			return routerModels.requesty[id] ?? routerModels.requesty[requestyDefaultModelId]
		case "glama":
			return routerModels.glama[id] ?? routerModels.glama[glamaDefaultModelId]
		case "unbound":
			return routerModels.unbound[id] ?? routerModels.unbound[unboundDefaultModelId]
		case "xai":
			return xaiModels[id as keyof typeof xaiModels] ?? xaiModels[xaiDefaultModelId]
		case "bedrock":
			// Special case for custom ARN.
			if (id === "custom-arn") {
				return { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: false, supportsImages: true }
			}

			return bedrockModels[id as keyof typeof bedrockModels] ?? bedrockModels[bedrockDefaultModelId]
		case "vertex":
			return vertexModels[id as keyof typeof vertexModels] ?? vertexModels[vertexDefaultModelId]
		case "gemini":
			return geminiModels[id as keyof typeof geminiModels] ?? geminiModels[geminiDefaultModelId]
		case "deepseek":
			return deepSeekModels[id as keyof typeof deepSeekModels] ?? deepSeekModels[deepSeekDefaultModelId]
		case "openai-native":
			return (
				openAiNativeModels[id as keyof typeof openAiNativeModels] ??
				openAiNativeModels[openAiNativeDefaultModelId]
			)
		case "mistral":
			return mistralModels[id as keyof typeof mistralModels] ?? mistralModels[mistralDefaultModelId]
		case "openai":
			return apiConfiguration?.openAiCustomModelInfo || openAiModelInfoSaneDefaults
		case "ollama":
			return openAiModelInfoSaneDefaults
		case "lmstudio":
			return openAiModelInfoSaneDefaults
		case "vscode-lm":
			const modelFamily = apiConfiguration?.vsCodeLmModelSelector?.family ?? vscodeLlmDefaultModelId

			return {
				...openAiModelInfoSaneDefaults,
				...vscodeLlmModels[modelFamily as keyof typeof vscodeLlmModels],
				supportsImages: false, // VSCode LM API currently doesn't support images.
			}

		// kilocode_change begin
		case "kilocode":
			// Use the fetched models from routerModels
			if (routerModels?.["kilocode-openrouter"] && apiConfiguration?.kilocodeModel) {
				// Find the model in the fetched models
				const modelEntries = Object.entries(routerModels["kilocode-openrouter"])

				// Try to find a model with a matching ID or name
				for (const [modelId, modelInfo] of modelEntries) {
					if (modelId.toLowerCase().includes(apiConfiguration.kilocodeModel.toLowerCase())) {
						return modelInfo
					}
				}
			}

			// Fallback to anthropic model if no match found
			return anthropicModels["claude-3-7-sonnet-20250219"]
		// kilocode_change end
		default:
			return anthropicModels[id as keyof typeof anthropicModels] ?? anthropicModels[anthropicDefaultModelId]
	}
}
