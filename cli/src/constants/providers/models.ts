import type { ProviderName, ProviderSettings } from "../../types/messages.js"
import type { ProviderConfig } from "../../config/types.js"

// Import model definitions from @roo-code/types
import {
	anthropicModels,
	anthropicDefaultModelId,
	bedrockModels,
	bedrockDefaultModelId,
	vertexModels,
	vertexDefaultModelId,
	openAiNativeModels,
	openAiNativeDefaultModelId,
	geminiModels,
	geminiDefaultModelId,
	mistralModels,
	mistralDefaultModelId,
	moonshotModels,
	moonshotDefaultModelId,
	deepSeekModels,
	deepSeekDefaultModelId,
	doubaoModels,
	doubaoDefaultModelId,
	qwenCodeModels,
	qwenCodeDefaultModelId,
	xaiModels,
	xaiDefaultModelId,
	groqModels,
	groqDefaultModelId,
	chutesModels,
	chutesDefaultModelId,
	cerebrasModels,
	cerebrasDefaultModelId,
	sambaNovaModels,
	sambaNovaDefaultModelId,
	internationalZAiModels,
	internationalZAiDefaultModelId,
	fireworksModels,
	fireworksDefaultModelId,
	featherlessModels,
	featherlessDefaultModelId,
	rooModels,
	rooDefaultModelId,
	claudeCodeModels,
	claudeCodeDefaultModelId,
	geminiCliModels,
	geminiCliDefaultModelId,
	minimaxModels,
	minimaxDefaultModelId,
	ovhCloudAiEndpointsDefaultModelId,
	zenmuxDefaultModelId,
} from "@roo-code/types"

/**
 * RouterName type - mirrors the one from src/shared/api.ts
 */
export type RouterName =
	| "openrouter"
	| "requesty"
	| "glama"
	| "unbound"
	| "litellm"
	| "kilocode"
	| "ollama"
	| "lmstudio"
	| "io-intelligence"
	| "deepinfra"
	| "vercel-ai-gateway"
	| "ovhcloud"
	| "zenmux"

/**
 * ModelInfo interface - mirrors the one from packages/types/src/model.ts
 */
export interface ModelInfo {
	maxTokens?: number | null
	maxThinkingTokens?: number | null
	contextWindow: number
	supportsImages?: boolean
	supportsComputerUse?: boolean
	supportsPromptCache: boolean
	promptCacheRetention?: "in_memory" | "24h"
	supportsVerbosity?: boolean
	supportsReasoningBudget?: boolean
	supportsReasoningBinary?: boolean
	supportsTemperature?: boolean
	defaultTemperature?: number
	requiredReasoningBudget?: boolean
	supportsReasoningEffort?: boolean | ("disable" | "none" | "minimal" | "low" | "medium" | "high")[]
	requiredReasoningEffort?: boolean
	preserveReasoning?: boolean
	supportedParameters?: ("max_tokens" | "temperature" | "reasoning" | "include_reasoning")[]
	inputPrice?: number
	outputPrice?: number
	cacheWritesPrice?: number
	cacheReadsPrice?: number
	description?: string
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
	minTokensPerCachePoint?: number
	maxCachePoints?: number
	cachableFields?: string[]
	displayName?: string | null
	preferredIndex?: number | null
	deprecated?: boolean
	isFree?: boolean
	supportsNativeTools?: boolean
	tiers?: Array<{
		name?: "default" | "flex" | "priority"
		contextWindow: number
		inputPrice?: number
		outputPrice?: number
		cacheWritesPrice?: number
		cacheReadsPrice?: number
	}>
}

export type ModelRecord = Record<string, ModelInfo>
export type RouterModels = Record<RouterName, ModelRecord>

/**
 * Mapping from ProviderName to RouterName for model fetching
 */
export const PROVIDER_TO_ROUTER_NAME: Record<ProviderName, RouterName | null> = {
	kilocode: "kilocode",
	openrouter: "openrouter",
	zenmux: "zenmux", // kilocode_change
	ollama: "ollama",
	lmstudio: "lmstudio",
	litellm: "litellm",
	glama: "glama",
	"nano-gpt": null,
	unbound: "unbound",
	requesty: "requesty",
	deepinfra: "deepinfra",
	"io-intelligence": "io-intelligence",
	"vercel-ai-gateway": "vercel-ai-gateway",
	ovhcloud: "ovhcloud",
	// Providers without dynamic model support
	anthropic: null,
	bedrock: null,
	vertex: null,
	openai: null,
	"vscode-lm": null,
	gemini: null,
	"openai-native": null,
	mistral: null,
	moonshot: null,
	deepseek: null,
	doubao: null,
	minimax: null,
	"qwen-code": null,
	"human-relay": null,
	"fake-ai": null,
	xai: null,
	groq: null,
	chutes: null,
	cerebras: null,
	sambanova: null,
	zai: null,
	fireworks: null,
	featherless: null,
	roo: null,
	"claude-code": null,
	"gemini-cli": null,
	"virtual-quota-fallback": null,
	huggingface: null,
	inception: null,
	synthetic: null,
	"sap-ai-core": null,
	baseten: null,
}

/**
 * Mapping from ProviderName to the field name that stores the model ID
 */
export const PROVIDER_MODEL_FIELD: Record<ProviderName, string | null> = {
	kilocode: "kilocodeModel",
	openrouter: "openRouterModelId",
	zenmux: "zenmuxModelId", // kilocode_change
	ollama: "ollamaModelId",
	lmstudio: "lmStudioModelId",
	litellm: "litellmModelId",
	glama: "glamaModelId",
	"nano-gpt": "nanoGptModelId",
	unbound: "unboundModelId",
	requesty: "requestyModelId",
	deepinfra: "deepInfraModelId",
	"io-intelligence": "ioIntelligenceModelId",
	"vercel-ai-gateway": "vercelAiGatewayModelId",
	ovhcloud: "ovhCloudAiEndpointsModelId",
	// Providers without dynamic model support
	anthropic: null,
	bedrock: null,
	vertex: null,
	openai: null,
	"vscode-lm": "vsCodeLmModelSelector",
	gemini: null,
	"openai-native": null,
	mistral: null,
	moonshot: null,
	deepseek: null,
	doubao: null,
	minimax: null,
	"qwen-code": null,
	"human-relay": null,
	"fake-ai": null,
	xai: null,
	groq: null,
	chutes: null,
	cerebras: null,
	sambanova: null,
	zai: null,
	fireworks: null,
	featherless: null,
	roo: null,
	"claude-code": null,
	"gemini-cli": null,
	"virtual-quota-fallback": null,
	huggingface: null,
	inception: "inceptionLabsModelId",
	synthetic: null,
	"sap-ai-core": "sapAiCoreModelId",
	baseten: null,
}

/**
 * Check if a provider supports dynamic model lists
 */
export const providerSupportsModelList = (provider: ProviderName): boolean => {
	return PROVIDER_TO_ROUTER_NAME[provider] !== null
}

/**
 * Check if a field is a model selection field
 */
export const isModelField = (field: string): boolean => {
	return Object.values(PROVIDER_MODEL_FIELD).includes(field)
}

/**
 * Get the RouterName for a provider
 */
export const getRouterNameForProvider = (provider: ProviderName): RouterName | null => {
	return PROVIDER_TO_ROUTER_NAME[provider]
}

/**
 * Get the model field name for a provider
 */
export const getModelFieldForProvider = (provider: ProviderName): string | null => {
	return PROVIDER_MODEL_FIELD[provider]
}

/**
 * Default model IDs for each provider
 * For providers without router support, these are fallback defaults
 */
export const DEFAULT_MODEL_IDS: Partial<Record<ProviderName, string>> = {
	anthropic: anthropicDefaultModelId,
	bedrock: bedrockDefaultModelId,
	vertex: vertexDefaultModelId,
	gemini: geminiDefaultModelId,
	deepseek: deepSeekDefaultModelId,
	"openai-native": openAiNativeDefaultModelId,
	mistral: mistralDefaultModelId,
	xai: xaiDefaultModelId,
	groq: groqDefaultModelId,
	chutes: chutesDefaultModelId,
	cerebras: cerebrasDefaultModelId,
	"vscode-lm": "gpt-3.5-turbo",
	openrouter: "anthropic/claude-sonnet-4.5",
	requesty: "anthropic/claude-sonnet-4.5",
	glama: "anthropic/claude-sonnet-4.5",
	unbound: "anthropic/claude-sonnet-4.5",
	litellm: "gpt-4",
	"qwen-code": qwenCodeDefaultModelId,
	"claude-code": claudeCodeDefaultModelId,
	doubao: doubaoDefaultModelId,
	fireworks: fireworksDefaultModelId,
	"io-intelligence": "deepseek-ai/DeepSeek-R1-0528",
	moonshot: moonshotDefaultModelId,
	sambanova: sambaNovaDefaultModelId,
	featherless: featherlessDefaultModelId,
	deepinfra: "deepseek-ai/DeepSeek-R1-0528",
	minimax: "MiniMax-M2",
	zai: internationalZAiDefaultModelId,
	roo: rooDefaultModelId,
	"gemini-cli": geminiCliDefaultModelId,
	ovhcloud: ovhCloudAiEndpointsDefaultModelId,
	zenmux: zenmuxDefaultModelId,
}

/**
 * Get models for a specific provider
 * Mirrors the logic from webview-ui/src/components/kilocode/hooks/useProviderModels.ts
 */
export function getModelsByProvider(params: {
	provider: ProviderName
	routerModels: RouterModels | null
	kilocodeDefaultModel: string
}): { models: ModelRecord; defaultModel: string } {
	const { provider, routerModels, kilocodeDefaultModel } = params

	// Handle router-based providers
	const routerName = PROVIDER_TO_ROUTER_NAME[provider]
	if (routerName && routerModels && routerModels[routerName]) {
		const defaultModelId = DEFAULT_MODEL_IDS[provider] || ""
		return {
			models: routerModels[routerName],
			defaultModel: provider === "kilocode" ? kilocodeDefaultModel : defaultModelId,
		}
	}

	// Handle non-router providers with static model definitions
	switch (provider) {
		case "anthropic":
			return {
				models: anthropicModels as ModelRecord,
				defaultModel: anthropicDefaultModelId,
			}
		case "bedrock":
			return {
				models: bedrockModels as ModelRecord,
				defaultModel: bedrockDefaultModelId,
			}
		case "vertex":
			return {
				models: vertexModels as ModelRecord,
				defaultModel: vertexDefaultModelId,
			}
		case "openai-native":
			return {
				models: openAiNativeModels as ModelRecord,
				defaultModel: openAiNativeDefaultModelId,
			}
		case "gemini":
			return {
				models: geminiModels as ModelRecord,
				defaultModel: geminiDefaultModelId,
			}
		case "mistral":
			return {
				models: mistralModels as ModelRecord,
				defaultModel: mistralDefaultModelId,
			}
		case "moonshot":
			return {
				models: moonshotModels as ModelRecord,
				defaultModel: moonshotDefaultModelId,
			}
		case "minimax":
			return {
				models: minimaxModels as ModelRecord,
				defaultModel: minimaxDefaultModelId,
			}
		case "deepseek":
			return {
				models: deepSeekModels as ModelRecord,
				defaultModel: deepSeekDefaultModelId,
			}
		case "doubao":
			return {
				models: doubaoModels as ModelRecord,
				defaultModel: doubaoDefaultModelId,
			}
		case "qwen-code":
			return {
				models: qwenCodeModels as ModelRecord,
				defaultModel: qwenCodeDefaultModelId,
			}
		case "xai":
			return {
				models: xaiModels as ModelRecord,
				defaultModel: xaiDefaultModelId,
			}
		case "groq":
			return {
				models: groqModels as ModelRecord,
				defaultModel: groqDefaultModelId,
			}
		case "chutes":
			return {
				models: chutesModels as ModelRecord,
				defaultModel: chutesDefaultModelId,
			}
		case "cerebras":
			return {
				models: cerebrasModels as ModelRecord,
				defaultModel: cerebrasDefaultModelId,
			}
		case "sambanova":
			return {
				models: sambaNovaModels as ModelRecord,
				defaultModel: sambaNovaDefaultModelId,
			}
		case "zai":
			return {
				models: internationalZAiModels as ModelRecord,
				defaultModel: internationalZAiDefaultModelId,
			}
		case "fireworks":
			return {
				models: fireworksModels as ModelRecord,
				defaultModel: fireworksDefaultModelId,
			}
		case "featherless":
			return {
				models: featherlessModels as ModelRecord,
				defaultModel: featherlessDefaultModelId,
			}
		case "roo":
			return {
				models: rooModels as ModelRecord,
				defaultModel: rooDefaultModelId,
			}
		case "claude-code":
			return {
				models: claudeCodeModels as ModelRecord,
				defaultModel: claudeCodeDefaultModelId,
			}
		case "gemini-cli":
			return {
				models: geminiCliModels as ModelRecord,
				defaultModel: geminiCliDefaultModelId,
			}
		default:
			// For providers without static models (e.g., vscode-lm, human-relay, fake-ai, virtual-quota-fallback)
			return {
				models: {},
				defaultModel: DEFAULT_MODEL_IDS[provider] || "",
			}
	}
}

/**
 * Get the model ID key for a provider
 * Mirrors the logic from webview-ui/src/components/kilocode/hooks/useSelectedModel.ts
 */
export function getModelIdKey(provider: ProviderName): string {
	switch (provider) {
		case "openrouter":
			return "openRouterModelId"
		case "requesty":
			return "requestyModelId"
		case "glama":
			return "glamaModelId"
		case "unbound":
			return "unboundModelId"
		case "litellm":
			return "litellmModelId"
		case "openai":
			return "openAiModelId"
		case "ollama":
			return "ollamaModelId"
		case "lmstudio":
			return "lmStudioModelId"
		case "vscode-lm":
			return "vsCodeLmModelSelector"
		case "kilocode":
			return "kilocodeModel"
		case "deepinfra":
			return "deepInfraModelId"
		case "io-intelligence":
			return "ioIntelligenceModelId"
		case "vercel-ai-gateway":
			return "vercelAiGatewayModelId"
		case "ovhcloud":
			return "ovhCloudAiEndpointsModelId"
		case "zenmux":
			return "zenmuxModelId"
		default:
			return "apiModelId"
	}
}

/**
 * Get the current model ID from provider config
 */
export function getCurrentModelId(params: {
	providerConfig: ProviderConfig
	routerModels: RouterModels | null
	kilocodeDefaultModel: string
}): string {
	const { providerConfig, routerModels, kilocodeDefaultModel } = params
	const provider = providerConfig.provider
	const modelIdKey = getModelIdKey(provider)

	// Special handling for vscode-lm
	if (provider === "vscode-lm" && providerConfig.vsCodeLmModelSelector) {
		const selector = providerConfig.vsCodeLmModelSelector as ProviderSettings["vsCodeLmModelSelector"]
		return `${selector?.vendor}/${selector?.family}`
	}

	// Get model ID from config
	const modelId = providerConfig[modelIdKey] as string | undefined

	// If model ID exists, return it
	if (modelId) {
		return modelId
	}

	// Otherwise, get default model
	const { defaultModel } = getModelsByProvider({
		provider,
		routerModels,
		kilocodeDefaultModel,
	})

	return defaultModel
}

/**
 * Sort models by preferred index
 * Mirrors the logic from webview-ui/src/components/ui/hooks/kilocode/usePreferredModels.ts
 */
export function sortModelsByPreference(models: ModelRecord): string[] {
	const preferredModelIds: string[] = []
	const restModelIds: string[] = []

	// First add the preferred models
	for (const [key, model] of Object.entries(models)) {
		if (Number.isInteger(model.preferredIndex)) {
			preferredModelIds.push(key)
		}
	}

	// Sort preferred by index
	preferredModelIds.sort((a, b) => {
		const modelA = models[a]
		const modelB = models[b]
		if (!modelA || !modelB) return 0
		return (modelA.preferredIndex ?? 0) - (modelB.preferredIndex ?? 0)
	})

	// Then add the rest
	for (const [key] of Object.entries(models)) {
		if (!preferredModelIds.includes(key)) {
			restModelIds.push(key)
		}
	}

	// Sort rest alphabetically
	restModelIds.sort((a, b) => a.localeCompare(b))

	return [...preferredModelIds, ...restModelIds]
}

/**
 * Format price for display
 */
export function formatPrice(price?: number): string {
	if (price === undefined || price === null) {
		return "N/A"
	}
	return `$${price.toFixed(2)}`
}

/**
 * Format model info for display
 */
export function formatModelInfo(modelId: string, model: ModelInfo): string {
	const parts: string[] = []

	// Context window
	if (model.contextWindow) {
		const contextK = Math.floor(model.contextWindow / 1000)
		parts.push(`${contextK}K context`)
	}

	// Pricing
	if (model.inputPrice !== undefined && model.outputPrice !== undefined) {
		parts.push(`${formatPrice(model.inputPrice)}/${formatPrice(model.outputPrice)} per 1M`)
	}

	// Capabilities
	const capabilities: string[] = []
	if (model.supportsImages) capabilities.push("Images")
	if (model.supportsComputerUse) capabilities.push("Computer Use")
	if (model.supportsPromptCache) capabilities.push("Cache")
	if (model.supportsVerbosity) capabilities.push("Verbosity")
	if (model.supportsReasoningEffort) capabilities.push("Reasoning")

	if (capabilities.length > 0) {
		parts.push(capabilities.join(", "))
	}

	return parts.join(" | ")
}

/**
 * Fuzzy filter models by name
 * Simple fuzzy matching: checks if all characters in filter appear in order in the model ID
 */
export function fuzzyFilterModels(models: ModelRecord, filter: string): string[] {
	if (!filter) {
		return Object.keys(models)
	}

	const lowerFilter = filter.toLowerCase()
	const filtered: string[] = []

	for (const modelId of Object.keys(models)) {
		const lowerModelId = modelId.toLowerCase()
		const model = models[modelId]
		const displayName = model?.displayName?.toLowerCase() || ""

		// Check if filter matches model ID or display name
		if (lowerModelId.includes(lowerFilter) || displayName.includes(lowerFilter)) {
			filtered.push(modelId)
		}
	}

	return filtered
}

/**
 * Get a pretty name for a model
 */
export function prettyModelName(modelId: string): string {
	// Remove common prefixes
	let name = modelId
		.replace(/^anthropic\./, "")
		.replace(/^accounts\/fireworks\/models\//, "")
		.replace(/^deepseek-ai\//, "")
		.replace(/^meta-llama\//, "")

	// Convert dashes and underscores to spaces
	name = name.replace(/[-_]/g, " ")

	// Capitalize words
	name = name
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")

	return name
}
