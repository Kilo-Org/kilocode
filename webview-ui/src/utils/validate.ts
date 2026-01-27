import i18next from "i18next"

import {
	type ProviderSettings,
	type OrganizationAllowList,
	type ProviderName,
	type RouterModels,
	modelIdKeysByProvider,
	isProviderName,
	isDynamicProvider,
	isFauxProvider,
	isCustomProvider,
} from "@roo-code/types"

export function validateApiConfiguration(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const keysAndIdsPresentErrorMessage = validateModelsAndKeysProvided(apiConfiguration)

	if (keysAndIdsPresentErrorMessage) {
		return keysAndIdsPresentErrorMessage
	}

	const organizationAllowListError = validateProviderAgainstOrganizationSettings(
		apiConfiguration,
		organizationAllowList,
	)

	if (organizationAllowListError) {
		return organizationAllowListError.message
	}

	return validateDynamicProviderModelId(apiConfiguration, routerModels)
}

function validateModelsAndKeysProvided(apiConfiguration: ProviderSettings): string | undefined {
	switch (apiConfiguration.apiProvider) {
		case "openrouter":
			if (!apiConfiguration.openRouterApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		// kilocode_change start
		case "glama":
			if (!apiConfiguration.glamaApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		// kilocode_change end
		case "unbound":
			if (!apiConfiguration.unboundApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "requesty":
			if (!apiConfiguration.requestyApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "deepinfra":
			if (!apiConfiguration.deepInfraApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "litellm":
			if (!apiConfiguration.litellmApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "anthropic":
			if (!apiConfiguration.apiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "bedrock":
			if (!apiConfiguration.awsRegion) {
				return i18next.t("settings:validation.awsRegion")
			}
			break
		case "vertex":
			if (!apiConfiguration.vertexProjectId || !apiConfiguration.vertexRegion) {
				return i18next.t("settings:validation.googleCloud")
			}
			break
		case "gemini":
			if (!apiConfiguration.geminiApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "openai-native":
			if (!apiConfiguration.openAiNativeApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "mistral":
			if (!apiConfiguration.mistralApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "openai":
			if (!apiConfiguration.openAiBaseUrl || !apiConfiguration.openAiApiKey || !apiConfiguration.openAiModelId) {
				return i18next.t("settings:validation.openAi")
			}
			break
		case "ollama":
			if (!apiConfiguration.ollamaModelId) {
				return i18next.t("settings:validation.modelId")
			}
			break
		case "lmstudio":
			if (!apiConfiguration.lmStudioModelId) {
				return i18next.t("settings:validation.modelId")
			}
			break
		case "vscode-lm":
			if (!apiConfiguration.vsCodeLmModelSelector) {
				return i18next.t("settings:validation.modelSelector")
			}
			break
		// kilocode_change start
		case "kilocode":
			if (!apiConfiguration.kilocodeToken) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		// kilocode_change end
		case "huggingface":
			if (!apiConfiguration.huggingFaceApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			if (!apiConfiguration.huggingFaceModelId) {
				return i18next.t("settings:validation.modelId")
			}
			break
		case "cerebras":
			if (!apiConfiguration.cerebrasApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "fireworks":
			if (!apiConfiguration.fireworksApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		// kilocode_change start
		case "synthetic":
			if (!apiConfiguration.syntheticApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		// kilocode_change end
		case "io-intelligence":
			if (!apiConfiguration.ioIntelligenceApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "featherless":
			if (!apiConfiguration.featherlessApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "qwen-code":
			if (!apiConfiguration.qwenCodeOauthPath) {
				return i18next.t("settings:validation.qwenCodeOauthPath")
			}
			break
		case "vercel-ai-gateway":
			if (!apiConfiguration.vercelAiGatewayApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		// kilocode_change start
		case "ovhcloud":
			if (!apiConfiguration.ovhCloudAiEndpointsApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
		case "sap-ai-core":
			if (!apiConfiguration.sapAiCoreServiceKey) {
				return i18next.t("settings:validation.sapAiCore")
			}
			if (!apiConfiguration.sapAiCoreModelId) {
				return i18next.t("settings:validation.modelId")
			}
			if (!apiConfiguration.sapAiCoreUseOrchestration && !apiConfiguration.sapAiCoreDeploymentId) {
				return i18next.t("settings:validation.sapAiCoreDeploymentId", {
					model: apiConfiguration.sapAiCoreModelId,
				})
			}
			break
		// kilocode_change end
		case "baseten":
			if (!apiConfiguration.basetenApiKey) {
				return i18next.t("settings:validation.apiKey")
			}
			break
	}

	return undefined
}

type ValidationError = {
	message: string
	code: "PROVIDER_NOT_ALLOWED" | "MODEL_NOT_ALLOWED"
}

function validateProviderAgainstOrganizationSettings(
	apiConfiguration: ProviderSettings,
	organizationAllowList?: OrganizationAllowList,
): ValidationError | undefined {
	if (organizationAllowList && !organizationAllowList.allowAll) {
		const provider = apiConfiguration.apiProvider

		if (!provider) {
			return undefined
		}

		const providerConfig = organizationAllowList.providers[provider]

		if (!providerConfig) {
			return {
				message: i18next.t("settings:validation.providerNotAllowed", { provider }),
				code: "PROVIDER_NOT_ALLOWED",
			}
		}

		if (!providerConfig.allowAll) {
			const modelId = getModelIdForProvider(apiConfiguration, provider)
			const allowedModels = providerConfig.models || []

			if (modelId && !allowedModels.includes(modelId)) {
				return {
					message: i18next.t("settings:validation.modelNotAllowed", {
						model: modelId,
						provider,
					}),
					code: "MODEL_NOT_ALLOWED",
				}
			}
		}
	}
}

function getModelIdForProvider(apiConfiguration: ProviderSettings, provider: ProviderName): string | undefined {
	if (provider === "vscode-lm") {
		return apiConfiguration.vsCodeLmModelSelector?.id
	}

	if (isCustomProvider(provider) || isFauxProvider(provider)) {
		return apiConfiguration.apiModelId
	}

	return apiConfiguration[modelIdKeysByProvider[provider]]
}

/**
 * Validates an Amazon Bedrock ARN and optionally checks if the region in
 * the ARN matches the provided region.
 *
 * Note: This function does not perform strict format validation on the ARN.
 * Users entering custom ARNs are advanced users who should be trusted to
 * provide valid ARNs without restriction. See issue #10108.
 *
 * @param arn The ARN string to validate
 * @param region Optional region to check against the ARN's region
 * @returns An object with validation results: { isValid, arnRegion, errorMessage }
 */
export function validateBedrockArn(arn: string, region?: string) {
	// Try to extract region from ARN for region mismatch warning.
	// This is a permissive regex that attempts to find the region component
	// without enforcing strict ARN format validation.
	const regionMatch = arn.match(/^arn:[^:]+:[^:]+:([^:]+):/)
	const arnRegion = regionMatch?.[1]

	// Check if region in ARN matches provided region (if specified).
	if (region && arnRegion && arnRegion !== region) {
		return {
			isValid: true,
			arnRegion,
			errorMessage: i18next.t("settings:validation.arn.regionMismatch", { arnRegion, region }),
		}
	}

	// ARN is always considered valid - trust the user to enter valid ARNs.
	return { isValid: true, arnRegion, errorMessage: undefined }
}

function validateDynamicProviderModelId(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
): string | undefined {
	const provider = apiConfiguration.apiProvider ?? ""

	// We only validate model ids from dynamic providers.
	if (!isDynamicProvider(provider)) {
		return undefined
	}

	const modelId = getModelIdForProvider(apiConfiguration, provider)

	if (!modelId) {
		return i18next.t("settings:validation.modelId")
	}

	const models = routerModels?.[provider]

	if (models && Object.keys(models).length > 1 && !Object.keys(models).includes(modelId)) {
		return i18next.t("settings:validation.modelAvailability", { modelId })
	}

	return undefined
}

/**
 * Extracts model-specific validation errors from the API configuration.
 * This is used to show model errors specifically in the model selector components.
 */
export function getModelValidationError(
	apiConfiguration: ProviderSettings,
	routerModels?: RouterModels,
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const modelId = isProviderName(apiConfiguration.apiProvider)
		? getModelIdForProvider(apiConfiguration, apiConfiguration.apiProvider)
		: apiConfiguration.apiModelId

	const configWithModelId = {
		...apiConfiguration,
		apiModelId: modelId || "",
	}

	const orgError = validateProviderAgainstOrganizationSettings(configWithModelId, organizationAllowList)

	if (orgError && orgError.code === "MODEL_NOT_ALLOWED") {
		return orgError.message
	}

	return validateDynamicProviderModelId(configWithModelId, routerModels)
}

/**
 * Validates API configuration but excludes model-specific errors.
 * This is used for the general API error display to prevent duplication
 * when model errors are shown in the model selector.
 */
export function validateApiConfigurationExcludingModelErrors(
	apiConfiguration: ProviderSettings,
	_routerModels?: RouterModels, // Keeping this for compatibility with the old function.
	organizationAllowList?: OrganizationAllowList,
): string | undefined {
	const keysAndIdsPresentErrorMessage = validateModelsAndKeysProvided(apiConfiguration)

	if (keysAndIdsPresentErrorMessage) {
		return keysAndIdsPresentErrorMessage
	}

	const organizationAllowListError = validateProviderAgainstOrganizationSettings(
		apiConfiguration,
		organizationAllowList,
	)

	// Inly return organization errors if they're not model-specific.
	if (organizationAllowListError && organizationAllowListError.code === "PROVIDER_NOT_ALLOWED") {
		return organizationAllowListError.message
	}

	// Skip model validation errors as they'll be shown in the model selector.
	return undefined
}
