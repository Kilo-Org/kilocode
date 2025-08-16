import { type ProviderName, type ProviderSettings } from "@roo-code/types"

export const getModelIdKey = ({
	provider,
}: {
	provider: ProviderName
}): keyof Pick<
	ProviderSettings,
	| "glamaModelId"
	| "openRouterModelId"
	| "unboundModelId"
	| "requestyModelId"
	| "openAiModelId"
	| "litellmModelId"
	| "kilocodeModel"
	| "cometApiModelId"
	| "ollamaModelId"
	| "lmStudioModelId"
	| "vsCodeLmModelSelector"
	| "apiModelId"
> => {
	switch (provider) {
		case "openrouter": {
			return "openRouterModelId"
		}
		case "requesty": {
			return "requestyModelId"
		}
		case "glama": {
			return "glamaModelId"
		}
		case "unbound": {
			return "unboundModelId"
		}
		case "litellm": {
			return "litellmModelId"
		}
		case "openai": {
			return "openAiModelId"
		}
		case "cometapi": {
			return "cometApiModelId"
		}
		case "ollama": {
			return "ollamaModelId"
		}
		case "lmstudio": {
			return "lmStudioModelId"
		}
		case "vscode-lm": {
			return "vsCodeLmModelSelector"
		}
		case "kilocode": {
			return "kilocodeModel"
		}
		default: {
			return "apiModelId"
		}
	}
}

export const getSelectedModelId = ({
	provider,
	apiConfiguration,
	defaultModelId,
}: {
	provider: ProviderName
	apiConfiguration: ProviderSettings
	defaultModelId: string
}): string => {
	const modelIdKey = getModelIdKey({ provider })
	switch (provider) {
		case "vscode-lm": {
			return apiConfiguration?.vsCodeLmModelSelector
				? `${apiConfiguration.vsCodeLmModelSelector.vendor}/${apiConfiguration.vsCodeLmModelSelector.family}`
				: defaultModelId
		}
		default: {
			return (apiConfiguration?.[modelIdKey] as string) ?? defaultModelId
		}
	}
}
