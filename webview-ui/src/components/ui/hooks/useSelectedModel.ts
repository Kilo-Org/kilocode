import {
	type ProviderName,
	type ProviderSettings,
	type ModelInfo,
	anthropicModels,
	bedrockModels,
	cerebrasModels,
	deepSeekModels,
	moonshotModels,
	minimaxModels,
	geminiModels,
	geminiDefaultModelId,
	// kilocode_change start
	geminiCliDefaultModelId,
	geminiCliModels,
	syntheticDefaultModelId,
	ovhCloudAiEndpointsDefaultModelId,
	inceptionDefaultModelId,
	// kilocode_change end
	mistralModels,
	openAiModelInfoSaneDefaults,
	openAiNativeModels,
	vertexModels,
	xaiModels,
	groqModels,
	vscodeLlmModels,
	vscodeLlmDefaultModelId,
	openRouterDefaultModelId,
	claudeCodeModels,
	normalizeClaudeCodeModelId,
	openAiCodexModels,
	sambaNovaModels,
	doubaoModels,
	internationalZAiModels,
	mainlandZAiModels,
	fireworksModels,
	featherlessModels,
	ioIntelligenceModels,
	basetenModels,
	qwenCodeModels,
	litellmDefaultModelInfo,
	lMStudioDefaultModelInfo,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	isDynamicProvider,
	getProviderDefaultModelId,
	NATIVE_TOOL_DEFAULTS,
} from "@roo-code/types"

import type { ModelRecord, RouterModels } from "@roo/api"

import { useRouterModels } from "./useRouterModels"
import { useOpenRouterModelProviders } from "./useOpenRouterModelProviders"
import { useLmStudioModels } from "./useLmStudioModels"
import { useExtensionState } from "@/context/ExtensionStateContext" // kilocode_change

// kilocode_change start
export const useModelProviders = (kilocodeDefaultModel: string, apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider
	return useOpenRouterModelProviders(
		provider === "kilocode"
			? (apiConfiguration?.kilocodeModel ?? kilocodeDefaultModel)
			: provider === "openrouter"
				? (apiConfiguration?.openRouterModelId ?? openRouterDefaultModelId)
				: undefined,
		provider === "openrouter" ? apiConfiguration?.openRouterBaseUrl : undefined,
		apiConfiguration?.apiKey,
		apiConfiguration?.kilocodeOrganizationId ?? "personal",
	)
}
// kilocode_change end
import { useOllamaModels } from "./useOllamaModels"

/**
 * Helper to get a validated model ID for dynamic providers.
 * Returns the configured model ID if it exists in the available models, otherwise returns the default.
 */
function getValidatedModelId(
	configuredId: string | undefined,
	availableModels: ModelRecord | undefined,
	defaultModelId: string,
): string {
	return configuredId && availableModels?.[configuredId] ? configuredId : defaultModelId
}

export const useSelectedModel = (apiConfiguration?: ProviderSettings) => {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	// kilocode_change start
	const { kilocodeDefaultModel, virtualQuotaActiveModel } = useExtensionState()
	const lmStudioModelId = provider === "lmstudio" ? apiConfiguration?.lmStudioModelId : undefined
	const ollamaModelId = provider === "ollama" ? apiConfiguration?.ollamaModelId : undefined
	// kilocode_change end

	// Only fetch router models for dynamic providers
	const shouldFetchRouterModels = isDynamicProvider(provider)
	const routerModels = useRouterModels(
		//kilocode_change start
		{
			openRouterBaseUrl: apiConfiguration?.openRouterBaseUrl,
			openRouterApiKey: apiConfiguration?.apiKey,
			kilocodeOrganizationId: apiConfiguration?.kilocodeOrganizationId,
			geminiApiKey: apiConfiguration?.geminiApiKey,
			googleGeminiBaseUrl: apiConfiguration?.googleGeminiBaseUrl,
			syntheticApiKey: apiConfiguration?.syntheticApiKey,
		},
		// kilocode_change end
		{
			provider: shouldFetchRouterModels ? provider : undefined,
			enabled: shouldFetchRouterModels,
		},
	)

	const openRouterModelProviders = useModelProviders(kilocodeDefaultModel, apiConfiguration) // kilocode_change
	const lmStudioModels = useLmStudioModels(lmStudioModelId)
	const ollamaModels = useOllamaModels(ollamaModelId)

	// Compute readiness only for the data actually needed for the selected provider
	const needRouterModels = shouldFetchRouterModels
	const needOpenRouterProviders = provider === "openrouter"
	const needLmStudio = typeof lmStudioModelId !== "undefined"
	const needOllama = typeof ollamaModelId !== "undefined"

	const hasValidRouterData = needRouterModels
		? routerModels.data &&
			routerModels.data[provider] !== undefined &&
			typeof routerModels.data[provider] === "object" &&
			!routerModels.isLoading
		: true

	const isReady =
		(!needLmStudio || typeof lmStudioModels.data !== "undefined") &&
		(!needOllama || typeof ollamaModels.data !== "undefined") &&
		hasValidRouterData &&
		(!needOpenRouterProviders || typeof openRouterModelProviders.data !== "undefined")

	const { id, info } =
		apiConfiguration && isReady
			? getSelectedModel({
					provider,
					apiConfiguration,
					routerModels: (routerModels.data || {}) as RouterModels,
					openRouterModelProviders: (openRouterModelProviders.data || {}) as Record<string, ModelInfo>,
					lmStudioModels: (lmStudioModels.data || undefined) as ModelRecord | undefined,
					kilocodeDefaultModel,
					ollamaModels: (ollamaModels.data || undefined) as ModelRecord | undefined,
					virtualQuotaActiveModel, // kilocode_change: Pass virtual quota active model
				})
			: { id: getProviderDefaultModelId(provider), info: undefined }

	return {
		provider,
		id,
		info,
		isLoading:
			(needRouterModels && routerModels.isLoading) ||
			(needOpenRouterProviders && openRouterModelProviders.isLoading) ||
			(needLmStudio && lmStudioModels!.isLoading) ||
			(needOllama && ollamaModels!.isLoading),
		isError:
			(needRouterModels && routerModels.isError) ||
			(needOpenRouterProviders && openRouterModelProviders.isError) ||
			(needLmStudio && lmStudioModels!.isError) ||
			(needOllama && ollamaModels!.isError),
	}
}

function getSelectedModel({
	provider,
	apiConfiguration,
	routerModels,
	openRouterModelProviders,
	lmStudioModels,
	kilocodeDefaultModel,
	ollamaModels,
	virtualQuotaActiveModel, //kilocode_change
}: {
	provider: ProviderName
	apiConfiguration: ProviderSettings
	routerModels: RouterModels
	openRouterModelProviders: Record<string, ModelInfo>
	lmStudioModels: ModelRecord | undefined
	kilocodeDefaultModel: string
	ollamaModels: ModelRecord | undefined
	virtualQuotaActiveModel?: { id: string; info: ModelInfo } //kilocode_change
}): { id: string; info: ModelInfo | undefined } {
	// the `undefined` case are used to show the invalid selection to prevent
	// users from seeing the default model if their selection is invalid
	// this gives a better UX than showing the default model
	const defaultModelId = getProviderDefaultModelId(provider)
	switch (provider) {
		case "openrouter": {
			const id = getValidatedModelId(apiConfiguration.openRouterModelId, routerModels.openrouter, defaultModelId)
			let info = routerModels.openrouter?.[id]
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
			const id = getValidatedModelId(apiConfiguration.requestyModelId, routerModels.requesty, defaultModelId)
			const routerInfo = routerModels.requesty?.[id]
			// Merge native tool defaults for cached models that may lack these fields
			const info = routerInfo ? { ...NATIVE_TOOL_DEFAULTS, ...routerInfo } : undefined
			return { id, info }
		}
		// kilocode_change start
		case "glama": {
			const id = getValidatedModelId(apiConfiguration.glamaModelId, routerModels.glama, defaultModelId)
			const info = routerModels.glama?.[id]
			return { id, info }
		}
		// kilocode_change end
		case "unbound": {
			const id = getValidatedModelId(apiConfiguration.unboundModelId, routerModels.unbound, defaultModelId)
			const routerInfo = routerModels.unbound?.[id]
			// Merge native tool defaults for cached models that may lack these fields
			const info = routerInfo ? { ...NATIVE_TOOL_DEFAULTS, ...routerInfo } : undefined
			return { id, info }
		}
		case "litellm": {
			const id = getValidatedModelId(apiConfiguration.litellmModelId, routerModels.litellm, defaultModelId)
			const routerInfo = routerModels.litellm?.[id]
			// Merge native tool defaults for cached models that may lack these fields
			const info = routerInfo ? { ...NATIVE_TOOL_DEFAULTS, ...routerInfo } : litellmDefaultModelInfo
			return { id, info }
		}
		case "xai": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = xaiModels[id as keyof typeof xaiModels]
			return info ? { id, info } : { id, info: undefined }
		}
		case "groq": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = groqModels[id as keyof typeof groqModels]
			return { id, info }
		}
		case "huggingface": {
			const id = apiConfiguration.huggingFaceModelId ?? "meta-llama/Llama-3.3-70B-Instruct"
			const info = {
				maxTokens: 8192,
				contextWindow: 131072,
				supportsImages: false,
				supportsPromptCache: false,
			}
			return { id, info }
		}
		case "chutes": {
			const id = getValidatedModelId(apiConfiguration.apiModelId, routerModels.chutes, defaultModelId)
			const info = routerModels.chutes?.[id]
			return { id, info }
		}
		case "baseten": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = basetenModels[id as keyof typeof basetenModels]
			return { id, info }
		}
		case "bedrock": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = bedrockModels[id as keyof typeof bedrockModels]

			// Special case for custom ARN.
			if (id === "custom-arn") {
				return {
					id,
					info: { maxTokens: 5000, contextWindow: 128_000, supportsPromptCache: false, supportsImages: true },
				}
			}

			// Apply 1M context for Claude Sonnet 4 / 4.5 when enabled
			if (BEDROCK_1M_CONTEXT_MODEL_IDS.includes(id as any) && apiConfiguration.awsBedrock1MContext && baseInfo) {
				// Create a new ModelInfo object with updated context window
				const info: ModelInfo = {
					...baseInfo,
					contextWindow: 1_000_000,
				}
				return { id, info }
			}

			return { id, info: baseInfo }
		}
		case "vertex": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = vertexModels[id as keyof typeof vertexModels]
			return { id, info }
		}
		// kilocode_change start
		case "gemini": {
			const id = apiConfiguration.apiModelId ?? geminiDefaultModelId
			const remoteInfo = routerModels.gemini?.[id]
			const staticInfo = geminiModels[id as keyof typeof geminiModels]
			return { id, info: remoteInfo ?? staticInfo }
		}
		// kilocode_change end
		case "deepseek": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = deepSeekModels[id as keyof typeof deepSeekModels]
			return { id, info }
		}
		case "doubao": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = doubaoModels[id as keyof typeof doubaoModels]
			return { id, info }
		}
		case "moonshot": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = moonshotModels[id as keyof typeof moonshotModels]
			return { id, info }
		}
		case "minimax": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = minimaxModels[id as keyof typeof minimaxModels]
			return { id, info }
		}
		case "zai": {
			const isChina = apiConfiguration.zaiApiLine === "china_coding"
			const models = isChina ? mainlandZAiModels : internationalZAiModels
			const defaultModelId = getProviderDefaultModelId(provider, { isChina })
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = models[id as keyof typeof models]
			return { id, info }
		}
		case "openai-native": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = openAiNativeModels[id as keyof typeof openAiNativeModels]
			return { id, info }
		}
		case "mistral": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = mistralModels[id as keyof typeof mistralModels]
			return { id, info }
		}
		case "openai": {
			const id = apiConfiguration.openAiModelId ?? ""
			const customInfo = apiConfiguration?.openAiCustomModelInfo
			// Only merge native tool call defaults, not prices or other model-specific info
			const nativeToolDefaults = {
				supportsNativeTools: openAiModelInfoSaneDefaults.supportsNativeTools,
				defaultToolProtocol: openAiModelInfoSaneDefaults.defaultToolProtocol,
			}
			const info = customInfo ? { ...nativeToolDefaults, ...customInfo } : openAiModelInfoSaneDefaults
			return { id, info }
		}
		// kilocode_change start
		case "openai-responses": {
			const id = apiConfiguration.openAiModelId ?? ""
			const customInfo = apiConfiguration?.openAiCustomModelInfo
			const nativeToolDefaults = {
				supportsNativeTools: openAiModelInfoSaneDefaults.supportsNativeTools,
				defaultToolProtocol: openAiModelInfoSaneDefaults.defaultToolProtocol,
			}
			const info = customInfo ? { ...nativeToolDefaults, ...customInfo } : openAiModelInfoSaneDefaults
			return { id, info }
		}
		// kilocode_change end
		// kilocode_change start - improved context window handling
		case "ollama": {
			const id = apiConfiguration.ollamaModelId ?? ""
			const info = ollamaModels && ollamaModels[apiConfiguration.ollamaModelId!]
			const userContextWindow = apiConfiguration?.ollamaNumCtx

			// If user has set ollamaNumCtx, always use it as the context window (user's explicit setting takes precedence)
			// If no user setting, use the fetched model info's context window
			// If neither, provide a sensible default so UI doesn't show undefined
			let adjustedInfo: ModelInfo | undefined
			if (info) {
				adjustedInfo = userContextWindow ? { ...info, contextWindow: userContextWindow } : info
			} else if (userContextWindow) {
				// No fetched model info but user has set context window - provide default model info with user's setting
				adjustedInfo = {
					maxTokens: userContextWindow,
					contextWindow: userContextWindow,
					supportsImages: true,
					supportsPromptCache: true,
				}
			}

			return {
				id,
				info: adjustedInfo || undefined,
			}
		}
		// kilocode_change end
		case "lmstudio": {
			const id = apiConfiguration.lmStudioModelId ?? ""
			const modelInfo = lmStudioModels && lmStudioModels[apiConfiguration.lmStudioModelId!]
			// Only merge native tool call defaults, not prices or other model-specific info
			const nativeToolDefaults = {
				supportsNativeTools: lMStudioDefaultModelInfo.supportsNativeTools,
				defaultToolProtocol: lMStudioDefaultModelInfo.defaultToolProtocol,
			}
			const info = modelInfo ? { ...nativeToolDefaults, ...modelInfo } : undefined
			return {
				id,
				info,
			}
		}
		case "deepinfra": {
			const id = getValidatedModelId(apiConfiguration.deepInfraModelId, routerModels.deepinfra, defaultModelId)
			const info = routerModels.deepinfra?.[id]
			return { id, info }
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
			if (routerModels["kilocode"] && apiConfiguration.kilocodeModel) {
				// Find the model in the fetched models
				const modelEntries = Object.entries(routerModels["kilocode"])

				const selectedModelId = apiConfiguration.kilocodeModel.toLowerCase()

				// Prefer exact match
				const selectedModel =
					modelEntries.find((model) => model[0].toLowerCase() === selectedModelId) ??
					modelEntries.find((model) => model[0].toLowerCase().includes(selectedModelId))

				if (selectedModel) {
					const id = selectedModel[0]
					let info = selectedModel[1]

					const specificProvider = apiConfiguration.openRouterSpecificProvider
					if (specificProvider && openRouterModelProviders[specificProvider]) {
						info = info
							? { ...info, ...openRouterModelProviders[specificProvider] }
							: openRouterModelProviders[specificProvider]
					}
					return { id, info }
				}
			}

			const invalidOrDefaultModel = apiConfiguration.kilocodeModel ?? kilocodeDefaultModel
			return {
				id: invalidOrDefaultModel,
				info: routerModels["kilocode"][invalidOrDefaultModel],
			}
		}
		case "gemini-cli": {
			const id = apiConfiguration.apiModelId ?? geminiCliDefaultModelId
			const info = geminiCliModels[id as keyof typeof geminiCliModels]
			return { id, info }
		}
		case "virtual-quota-fallback": {
			if (virtualQuotaActiveModel) {
				return virtualQuotaActiveModel
			}
			// Fallback if no profiles or settings found
			return {
				id: "",
				info: {
					maxTokens: 1,
					contextWindow: 1,
					supportsPromptCache: false,
				},
			}
		}
		// kilocode_change end

		case "claude-code": {
			// Claude Code models extend anthropic models but with images and prompt caching disabled
			// Normalize legacy model IDs to current canonical model IDs for backward compatibility
			const rawId = apiConfiguration.apiModelId ?? defaultModelId
			const normalizedId = normalizeClaudeCodeModelId(rawId)
			const info = claudeCodeModels[normalizedId]
			return { id: normalizedId, info: { ...openAiModelInfoSaneDefaults, ...info } }
		}
		case "cerebras": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = cerebrasModels[id as keyof typeof cerebrasModels]
			return { id, info }
		}
		case "sambanova": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = sambaNovaModels[id as keyof typeof sambaNovaModels]
			return { id, info }
		}
		case "fireworks": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = fireworksModels[id as keyof typeof fireworksModels]
			return { id, info }
		}
		// kilocode_change start
		case "synthetic": {
			const id = apiConfiguration.apiModelId ?? syntheticDefaultModelId
			const info = routerModels.synthetic[id]
			return { id, info }
		}
		// kilocode_change end
		case "featherless": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = featherlessModels[id as keyof typeof featherlessModels]
			return { id, info }
		}
		case "io-intelligence": {
			const id = getValidatedModelId(
				apiConfiguration.ioIntelligenceModelId,
				routerModels["io-intelligence"],
				defaultModelId,
			)
			const info =
				routerModels["io-intelligence"]?.[id] ?? ioIntelligenceModels[id as keyof typeof ioIntelligenceModels]
			return { id, info }
		}
		case "roo": {
			const id = getValidatedModelId(apiConfiguration.apiModelId, routerModels.roo, defaultModelId)
			const info = routerModels.roo?.[id]
			return { id, info }
		}
		case "qwen-code": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = qwenCodeModels[id as keyof typeof qwenCodeModels]
			return { id, info }
		}
		case "openai-codex": {
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const info = openAiCodexModels[id as keyof typeof openAiCodexModels]
			return { id, info }
		}
		case "vercel-ai-gateway": {
			const id = getValidatedModelId(
				apiConfiguration.vercelAiGatewayModelId,
				routerModels["vercel-ai-gateway"],
				defaultModelId,
			)
			const info = routerModels["vercel-ai-gateway"]?.[id]
			return { id, info }
		}
		//kilocode_change start
		case "nano-gpt": {
			const id = apiConfiguration.nanoGptModelId ?? "chatgpt-4o-latest"
			const info = routerModels["nano-gpt"]?.[id]
			return { id, info }
		}
		case "ovhcloud": {
			const id = apiConfiguration.ovhCloudAiEndpointsModelId ?? ovhCloudAiEndpointsDefaultModelId
			const info = routerModels.ovhcloud[id]
			return { id, info }
		}
		case "inception": {
			const id = apiConfiguration.inceptionLabsModelId ?? inceptionDefaultModelId
			const info = routerModels.inception[id]
			return { id, info }
		}
		case "sap-ai-core": {
			const id = apiConfiguration.sapAiCoreModelId ?? "gpt-5"
			const info = {
				maxTokens: 128000,
				contextWindow: 400000,
				supportsImages: true,
				supportsPromptCache: true,
				description: "GPT-5: The best model for coding and agentic tasks across domains",
			}
			return { id, info }
		}
		// kilocode_change end
		// case "anthropic":
		// case "human-relay":
		// case "fake-ai":
		default: {
			provider satisfies "anthropic" | "gemini-cli" | "qwen-code" | "fake-ai" | "human-relay" | "kilocode"
			const id = apiConfiguration.apiModelId ?? defaultModelId
			const baseInfo = anthropicModels[id as keyof typeof anthropicModels]

			// Apply 1M context beta tier pricing for Claude Sonnet 4
			if (
				provider === "anthropic" &&
				(id === "claude-sonnet-4-20250514" || id === "claude-sonnet-4-5") &&
				apiConfiguration.anthropicBeta1MContext &&
				baseInfo
			) {
				// Type assertion since we know claude-sonnet-4-20250514 and claude-sonnet-4-5 have tiers
				const modelWithTiers = baseInfo as typeof baseInfo & {
					tiers?: Array<{
						contextWindow: number
						inputPrice?: number
						outputPrice?: number
						cacheWritesPrice?: number
						cacheReadsPrice?: number
					}>
				}
				const tier = modelWithTiers.tiers?.[0]
				if (tier) {
					// Create a new ModelInfo object with updated values
					const info: ModelInfo = {
						...baseInfo,
						contextWindow: tier.contextWindow,
						inputPrice: tier.inputPrice ?? baseInfo.inputPrice,
						outputPrice: tier.outputPrice ?? baseInfo.outputPrice,
						cacheWritesPrice: tier.cacheWritesPrice ?? baseInfo.cacheWritesPrice,
						cacheReadsPrice: tier.cacheReadsPrice ?? baseInfo.cacheReadsPrice,
					}
					return { id, info }
				}
			}

			return { id, info: baseInfo }
		}
	}
}
