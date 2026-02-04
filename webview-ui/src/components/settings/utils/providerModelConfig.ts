import type { ProviderName, ModelInfo, ProviderSettings } from "@roo-code/types"
import {
	anthropicDefaultModelId,
	bedrockDefaultModelId,
	cerebrasDefaultModelId,
	deepSeekDefaultModelId,
	doubaoDefaultModelId,
	moonshotDefaultModelId,
	geminiDefaultModelId,
	mistralDefaultModelId,
	openAiNativeDefaultModelId,
	qwenCodeDefaultModelId,
	vertexDefaultModelId,
	xaiDefaultModelId,
	groqDefaultModelId,
	sambaNovaDefaultModelId,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	fireworksDefaultModelId,
	featherlessDefaultModelId,
	minimaxDefaultModelId,
	basetenDefaultModelId,
} from "@roo-code/types"

import { MODELS_BY_PROVIDER } from "../constants"

export interface ProviderServiceConfig {
	serviceName: string
	serviceUrl: string
}

export const PROVIDER_SERVICE_CONFIG: Partial<Record<ProviderName, ProviderServiceConfig>> = {
	anthropic: { serviceName: "Anthropic", serviceUrl: "https://console.anthropic.com" },
	bedrock: { serviceName: "Amazon Bedrock", serviceUrl: "https://aws.amazon.com/bedrock" },
	cerebras: { serviceName: "Cerebras", serviceUrl: "https://cerebras.ai" },
	deepseek: { serviceName: "DeepSeek", serviceUrl: "https://platform.deepseek.com" },
	doubao: { serviceName: "Doubao", serviceUrl: "https://www.volcengine.com/product/doubao" },
	moonshot: { serviceName: "Moonshot", serviceUrl: "https://platform.moonshot.cn" },
	gemini: { serviceName: "Google Gemini", serviceUrl: "https://ai.google.dev" },
	mistral: { serviceName: "Mistral", serviceUrl: "https://console.mistral.ai" },
	"openai-native": { serviceName: "OpenAI", serviceUrl: "https://platform.openai.com" },
	"qwen-code": { serviceName: "Qwen Code", serviceUrl: "https://dashscope.console.aliyun.com" },
	vertex: { serviceName: "GCP Vertex AI", serviceUrl: "https://console.cloud.google.com/vertex-ai" },
	xai: { serviceName: "xAI", serviceUrl: "https://x.ai" },
	groq: { serviceName: "Groq", serviceUrl: "https://console.groq.com" },
	sambanova: { serviceName: "SambaNova", serviceUrl: "https://sambanova.ai" },
	zai: { serviceName: "Z.ai", serviceUrl: "https://z.ai" },
	fireworks: { serviceName: "Fireworks AI", serviceUrl: "https://fireworks.ai" },
	featherless: { serviceName: "Featherless AI", serviceUrl: "https://featherless.ai" },
	minimax: { serviceName: "MiniMax", serviceUrl: "https://minimax.chat" },
	baseten: { serviceName: "Baseten", serviceUrl: "https://baseten.co" },
	ollama: { serviceName: "Ollama", serviceUrl: "https://ollama.ai" },
	lmstudio: { serviceName: "LM Studio", serviceUrl: "https://lmstudio.ai/docs" },
	"vscode-lm": {
		serviceName: "VS Code LM",
		serviceUrl: "https://code.visualstudio.com/api/extension-guides/language-model",
	},
}

export const PROVIDER_DEFAULT_MODEL_IDS: Partial<Record<ProviderName, string>> = {
	anthropic: anthropicDefaultModelId,
	bedrock: bedrockDefaultModelId,
	cerebras: cerebrasDefaultModelId,
	deepseek: deepSeekDefaultModelId,
	doubao: doubaoDefaultModelId,
	moonshot: moonshotDefaultModelId,
	gemini: geminiDefaultModelId,
	mistral: mistralDefaultModelId,
	"openai-native": openAiNativeDefaultModelId,
	"qwen-code": qwenCodeDefaultModelId,
	vertex: vertexDefaultModelId,
	xai: xaiDefaultModelId,
	groq: groqDefaultModelId,
	sambanova: sambaNovaDefaultModelId,
	zai: internationalZAiDefaultModelId,
	fireworks: fireworksDefaultModelId,
	featherless: featherlessDefaultModelId,
	minimax: minimaxDefaultModelId,
	baseten: basetenDefaultModelId,
}

export const getProviderServiceConfig = (provider: ProviderName): ProviderServiceConfig => {
	return PROVIDER_SERVICE_CONFIG[provider] ?? { serviceName: provider, serviceUrl: "" }
}

export const getDefaultModelIdForProvider = (provider: ProviderName, apiConfiguration?: ProviderSettings): string => {
	// Handle Z.ai's China/International entrypoint distinction
	if (provider === "zai" && apiConfiguration) {
		return apiConfiguration.zaiApiLine === "china_coding"
			? mainlandZAiDefaultModelId
			: internationalZAiDefaultModelId
	}

	return PROVIDER_DEFAULT_MODEL_IDS[provider] ?? ""
}

export const getStaticModelsForProvider = (
	provider: ProviderName,
	customArnLabel?: string,
): Record<string, ModelInfo> => {
	const models = MODELS_BY_PROVIDER[provider] ?? {}

	// Add custom-arn option for Bedrock
	if (provider === "bedrock") {
		return {
			...models,
			"custom-arn": {
				maxTokens: 0,
				contextWindow: 0,
				supportsPromptCache: false,
				description: customArnLabel ?? "Use Custom ARN",
			},
		}
	}

	return models
}

/**
 * Checks if a provider uses static models from MODELS_BY_PROVIDER
 */
export const isStaticModelProvider = (provider: ProviderName): boolean => {
	return provider in MODELS_BY_PROVIDER
}

/**
 * List of providers that have their own custom model selection UI
 * and should not use the generic ModelPicker in ApiOptions
 */
export const PROVIDERS_WITH_CUSTOM_MODEL_UI: ProviderName[] = [
	"openrouter",
	"requesty",
	"unbound",
	"deepinfra",
	"openai", // OpenAI Compatible
	"openai-codex", // OpenAI Codex has custom UI with auth and rate limits
	"litellm",
	"io-intelligence",
	"vercel-ai-gateway",
	"roo",
	"chutes",
	"ollama",
	"lmstudio",
	"vscode-lm",
	"huggingface",
]

/**
 * Checks if a provider should use the generic ModelPicker
 */
export const shouldUseGenericModelPicker = (provider: ProviderName): boolean => {
	return isStaticModelProvider(provider) && !PROVIDERS_WITH_CUSTOM_MODEL_UI.includes(provider)
}

/**
 * Handles provider-specific side effects when a model is changed.
 * Centralizes provider-specific logic to keep it out of the ApiOptions template.
 */
export const handleModelChangeSideEffects = <K extends keyof ProviderSettings>(
	provider: ProviderName,
	modelId: string,
	setApiConfigurationField: (field: K, value: ProviderSettings[K]) => void,
): void => {
	// Bedrock: Clear custom ARN if not using custom ARN option
	if (provider === "bedrock" && modelId !== "custom-arn") {
		setApiConfigurationField("awsCustomArn" as K, "" as ProviderSettings[K])
	}

	// All providers: Clear reasoning effort when switching models to allow
	// the new model's default to take effect. Different models within the
	// same provider can have different reasoning effort defaults/options.
	setApiConfigurationField("reasoningEffort" as K, undefined as ProviderSettings[K])
}
